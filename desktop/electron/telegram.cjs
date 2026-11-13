// Telegram bridge: the user talks to the boss from their phone through their own bot.
// No server: Dispatch long-polls the Bot API while it runs. Config in ~/.dispatch/telegram.json.
// Linking: the user opens t.me/<bot>?start=<one-time code>; the chat that sends that code becomes the only allowed chat.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const TOKEN_RE = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;

function create({ dir, onMessage, onCommand = async () => null, log = () => {} }) {
  const file = path.join(dir, 'telegram.json');
  // Only one Dispatch may poll the bot (Telegram refuses two getUpdates at once and messages would land on either).
  // The poller holds telegram.lock (pid + heartbeat); another copy waits and takes over when it goes away.
  const lockFile = path.join(dir, 'telegram.lock');
  const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
  function takeLock() {
    try {
      const l = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
      if (l.pid !== process.pid && alive(l.pid) && Date.now() - l.beat < 90e3) return false;
    } catch {}
    fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, beat: Date.now() }));
    return true;
  }
  function dropLock() { try { const l = JSON.parse(fs.readFileSync(lockFile, 'utf8')); if (l.pid === process.pid) fs.unlinkSync(lockFile); } catch {} }
  let standby = false;
  const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };
  const write = v => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(v, null, 2)); };
  let cfg = read();
  let abort = null, running = false, lastError = '', listeners = new Set();
  const changed = () => { for (const fn of listeners) try { fn(status()); } catch {} };

  async function api(method, body, token = cfg.token, signal) {
    const isForm = body instanceof FormData;
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', body: isForm ? body : JSON.stringify(body || {}), headers: isForm ? undefined : { 'content-type': 'application/json' }, signal });
    const json = await res.json().catch(() => ({}));
    if (!json.ok) throw new Error(json.description || `Telegram answered ${res.status}`);
    return json.result;
  }

  function status() {
    return { configured: !!cfg.token, bot: cfg.bot || null, linked: !!cfg.chatId, chatName: cfg.chatName || '', polling: running && !standby, standby, error: lastError };
  }

  async function setToken(token) {
    token = String(token || '').trim();
    if (!TOKEN_RE.test(token)) throw new Error('That does not look like a bot token. BotFather sends one like 123456789:AAH…');
    const me = await api('getMe', {}, token);
    stop();
    cfg = { token, bot: { username: me.username, name: me.first_name }, code: crypto.randomBytes(6).toString('hex') };
    write(cfg); lastError = ''; start(); changed();
    return status();
  }

  /** Deep link that opens the bot and sends /start <code>. */
  function linkUrl() {
    if (!cfg.token) throw new Error('Add the bot token first.');
    if (!cfg.code) { cfg.code = crypto.randomBytes(6).toString('hex'); write(cfg); }
    return `https://t.me/${cfg.bot.username}?start=${cfg.code}`;
  }

  function disconnect() { stop(); cfg = {}; try { fs.unlinkSync(file); } catch {} lastError = ''; changed(); return status(); }
  function unlink() { delete cfg.chatId; delete cfg.chatName; cfg.code = crypto.randomBytes(6).toString('hex'); write(cfg); changed(); return status(); }

  async function send(text) {
    if (!cfg.chatId) throw new Error('Telegram is not connected. Connect it in Dispatch under Tools, Telegram.');
    const body = String(text || '').trim() || '(empty)';
    for (let i = 0; i < body.length; i += 4000) await api('sendMessage', { chat_id: cfg.chatId, text: body.slice(i, i + 4000), disable_web_page_preview: true });
    return true;
  }
  async function sendFile(filePath, caption = '') {
    if (!cfg.chatId) throw new Error('Telegram is not connected. Connect it in Dispatch under Tools, Telegram.');
    const data = fs.readFileSync(filePath);
    if (data.length > 50 * 1024 * 1024) throw new Error('Telegram bots can send files up to 50 MB.');
    const photo = IMAGE_EXT.test(filePath) && data.length < 10 * 1024 * 1024;
    const form = new FormData();
    form.append('chat_id', String(cfg.chatId));
    if (caption) form.append('caption', String(caption).slice(0, 1000));
    form.append(photo ? 'photo' : 'document', new Blob([data]), path.basename(filePath));
    await api(photo ? 'sendPhoto' : 'sendDocument', form);
    return true;
  }

  async function handle(update) {
    const m = update.message; if (!m?.chat) return;
    const text = String(m.text || m.caption || '').trim();
    const start = text.match(/^\/start(?:@\w+)?\s*(\S*)/);
    if (!cfg.chatId) {
      if (start && start[1] && cfg.code && start[1] === cfg.code) {
        cfg.chatId = m.chat.id; cfg.chatName = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(' ') || m.chat.title || ''; delete cfg.code; write(cfg); changed();
        await api('sendMessage', { chat_id: m.chat.id, text: 'Connected to Dispatch. Write here and the boss answers. Dispatch has to be running on your computer.' }).catch(() => {});
      } else await api('sendMessage', { chat_id: m.chat.id, text: 'Open this bot from Dispatch (Tools, Telegram, Link chat) to connect it.' }).catch(() => {});
      return;
    }
    if (m.chat.id !== cfg.chatId) { await api('sendMessage', { chat_id: m.chat.id, text: 'This bot is private.' }).catch(() => {}); return; }
    if (start) { await api('sendMessage', { chat_id: m.chat.id, text: 'Already connected. Write your message for the boss. /projects lists your projects, /use <number> switches.' }).catch(() => {}); return; }
    if (!text) { await api('sendMessage', { chat_id: m.chat.id, text: 'Only text messages reach the boss for now.' }).catch(() => {}); return; }
    const cmd = text.match(/^\/(\w+)(?:@\w+)?\s*([\s\S]*)$/);
    if (cmd) { try { const r = await onCommand(cmd[1].toLowerCase(), cmd[2].trim()); if (r) { await send(r); return; } } catch (e) { await send(e.message).catch(() => {}); return; } }
    try { await onMessage(text); } catch (e) { await send(`Could not reach the boss: ${e.message}`).catch(() => {}); }
  }

  async function loop() {
    let backoff = 1000;
    while (running) {
      if (!takeLock()) { if (!standby) { standby = true; changed(); } await new Promise(r => setTimeout(r, 15000)); continue; }
      // Taking over from another copy: it may have linked the chat or moved the offset meanwhile.
      if (standby) { standby = false; cfg = read(); if (!cfg.token) { running = false; dropLock(); changed(); break; } changed(); }
      abort = new AbortController();
      try {
        const updates = await api('getUpdates', { offset: cfg.offset || 0, timeout: 25, allowed_updates: ['message'] }, cfg.token, abort.signal);
        backoff = 1000; if (lastError) { lastError = ''; changed(); }
        for (const u of updates) { cfg.offset = u.update_id + 1; write(cfg); await handle(u).catch(e => log(`telegram: ${e.message}`)); }
      } catch (e) {
        if (!running) break;
        const msg = e.name === 'AbortError' ? '' : e.message;
        if (/unauthorized/i.test(msg)) { lastError = 'The bot token was revoked. Add a new one.'; running = false; changed(); break; }
        if (msg && msg !== lastError) { lastError = msg; changed(); }
        await new Promise(r => setTimeout(r, backoff)); backoff = Math.min(backoff * 2, 60000);
      }
    }
  }
  function start() { if (running || !cfg.token) return; running = true; void loop(); changed(); }
  function stop() { running = false; try { abort?.abort(); } catch {} dropLock(); }

  return { status, setToken, linkUrl, disconnect, unlink, send, sendFile, start, stop, onChange: fn => { listeners.add(fn); return () => listeners.delete(fn); }, connected: () => !!cfg.chatId };
}

const looksLikeToken = t => TOKEN_RE.test(String(t || '').trim());
module.exports = { create, looksLikeToken };
