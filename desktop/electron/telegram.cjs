// Telegram bridge: the user talks to the boss from their phone through their own bot.
// No server: Dispatch long-polls the Bot API while it runs. Config in ~/.dispatch/telegram.json.
// Linking: the user opens t.me/<bot>?start=<one-time code>; the chat that sends that code becomes the only allowed chat.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const TOKEN_RE = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;

function create({ dir, onMessage, onCommand = async () => null, onButton = async () => null, commands = [], log = () => {} }) {
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
    write(cfg); lastError = ''; commandsSet = false; start(); changed();
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

  // buttons: rows of { text, data } shown under the (last part of the) message; a tap comes back through onButton.
  const keyboard = buttons => (buttons?.length ? { reply_markup: { inline_keyboard: buttons.map(row => row.map(b => ({ text: String(b.text).slice(0, 60), callback_data: String(b.data).slice(0, 64) }))) } } : {});
  async function send(text, { buttons } = {}) {
    if (!cfg.chatId) throw new Error('Telegram is not connected. Connect it in Dispatch under Tools, Telegram.');
    const body = String(text || '').trim() || '(empty)';
    let last = null;
    for (let i = 0; i < body.length; i += 4000) last = await api('sendMessage', { chat_id: cfg.chatId, text: body.slice(i, i + 4000), disable_web_page_preview: true, ...(i + 4000 >= body.length ? keyboard(buttons) : {}) });
    return last?.message_id ?? true;
  }
  // Replaces a sent message's text and buttons (a tapped Approve turns into "Approved").
  async function edit(messageId, text, { buttons } = {}) {
    if (!cfg.chatId || !messageId) return false;
    await api('editMessageText', { chat_id: cfg.chatId, message_id: messageId, text: String(text).slice(0, 4000), disable_web_page_preview: true, ...keyboard(buttons) }).catch(() => {});
    return true;
  }
  // The "/" menu in Telegram: set by the bot itself, so nothing has to be done in BotFather.
  let commandsSet = false;
  async function setCommands() {
    if (commandsSet || !cfg.token || !commands.length) return;
    try { await api('setMyCommands', { commands: commands.map(([command, description]) => ({ command, description })) }); commandsSet = true; } catch (e) { log(`telegram: setMyCommands ${e.message}`); }
  }
  async function sendFile(filePath, caption = '') {
    if (!cfg.chatId) throw new Error('Telegram is not connected. Connect it in Dispatch under Tools, Telegram.');
    const data = fs.readFileSync(filePath);
    if (data.length > 50 * 1024 * 1024) throw new Error('Telegram bots can send files up to 50 MB.');
    // Shown inline in the chat when Telegram knows the kind; anything else goes as a file.
    const kind = IMAGE_EXT.test(filePath) && !/\.gif$/i.test(filePath) && data.length < 10 * 1024 * 1024 ? ['sendPhoto', 'photo']
      : /\.gif$/i.test(filePath) ? ['sendAnimation', 'animation']
      : /\.(mp4|mov|webm)$/i.test(filePath) ? ['sendVideo', 'video']
      : /\.ogg$/i.test(filePath) ? ['sendVoice', 'voice']
      : /\.(mp3|m4a|wav|flac)$/i.test(filePath) ? ['sendAudio', 'audio'] : ['sendDocument', 'document'];
    const form = new FormData();
    form.append('chat_id', String(cfg.chatId));
    if (caption) form.append('caption', String(caption).slice(0, 1000));
    form.append(kind[1], new Blob([data]), path.basename(filePath));
    await api(kind[0], form);
    return true;
  }

  /** Saves a file the user sent into `dir`; returns the path. Bots can download up to 20 MB. */
  async function download(f, dir) {
    if (f.size > 20 * 1024 * 1024) throw new Error(`${f.name} is larger than 20 MB, the limit for bots.`);
    const info = await api('getFile', { file_id: f.id });
    const res = await fetch(`https://api.telegram.org/file/bot${cfg.token}/${info.file_path}`);
    if (!res.ok) throw new Error(`Download failed (${res.status}).`);
    const ext = path.extname(info.file_path || ''), base = path.basename(f.name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    const out = path.join(dir, `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}-${path.extname(base) ? base : base + ext}`);
    fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
    return out;
  }
  /** The bot's own profile: photo (jpg/png), name, description. */
  async function setProfile({ photo, name, description, about }) {
    if (!cfg.token) throw new Error('Telegram is not connected.');
    const done = [];
    if (photo) {
      const form = new FormData();
      form.append('photo', JSON.stringify({ type: 'static', photo: 'attach://pic' }));
      form.append('pic', new Blob([fs.readFileSync(photo)]), path.basename(photo));
      await api('setMyProfilePhoto', form); done.push('photo');
    }
    if (name) { await api('setMyName', { name: String(name).slice(0, 64) }); cfg.bot = { ...cfg.bot, name }; write(cfg); done.push('name'); }
    if (description) { await api('setMyDescription', { description: String(description).slice(0, 512) }); done.push('description'); }
    if (about) { await api('setMyShortDescription', { short_description: String(about).slice(0, 120) }); done.push('about text'); }
    if (!done.length) throw new Error('Give --photo, --name, --description and/or --about.');
    return `Updated the bot's ${done.join(', ')}.`;
  }

  // A command answer is text, or { text, buttons }.
  const reply = r => (typeof r === 'string' ? send(r) : send(r.text, { buttons: r.buttons }));
  async function handleButton(q) {
    const answer = text => api('answerCallbackQuery', { callback_query_id: q.id, ...(text ? { text: String(text).slice(0, 190) } : {}) }).catch(() => {});
    if (!cfg.chatId || q.message?.chat?.id !== cfg.chatId) { await answer('This bot is private.'); return; }
    let r = null;
    try { r = await onButton(String(q.data || ''), q.message.message_id); } catch (e) { await answer(e.message); return; }
    // r: { toast, text, buttons }: toast pops up briefly; text replaces the tapped message (its buttons go unless given again).
    await answer(r?.toast || '');
    if (r?.text) await edit(q.message.message_id, r.text, { buttons: r.buttons });
    else if (r?.reply) await reply(r.reply);
  }

  async function handle(update) {
    if (update.callback_query) return handleButton(update.callback_query);
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
    if (start) { await setCommands(); try { const r = await onCommand('help', ''); if (r) { await reply(r); return; } } catch {} await send('Already connected. Write your message for the boss.').catch(() => {}); return; }
    // Photos, files, voice notes, videos: passed on as files the agent can open.
    const files = [];
    if (m.photo?.length) files.push({ id: m.photo.at(-1).file_id, name: `photo-${m.message_id}.jpg` });
    for (const [k, ext] of [['document', ''], ['video', '.mp4'], ['voice', '.ogg'], ['audio', '.mp3'], ['video_note', '.mp4'], ['animation', '.mp4']]) if (m[k]) files.push({ id: m[k].file_id, name: m[k].file_name || `${k}-${m.message_id}${ext}`, size: m[k].file_size });
    if (!text && !files.length) { await api('sendMessage', { chat_id: m.chat.id, text: 'That kind of message is not supported. Send text, a photo, a file, a voice note or a video.' }).catch(() => {}); return; }
    const cmd = text.match(/^\/(\w+)(?:@\w+)?\s*([\s\S]*)$/);
    if (cmd) { try { const r = await onCommand(cmd[1].toLowerCase(), cmd[2].trim()); if (r) { await reply(r); return; } } catch (e) { await send(e.message).catch(() => {}); return; } }
    // A reply to one of the bot's messages carries that message's text: its [project] tag says where the answer goes.
    const replyTo = m.reply_to_message?.from?.is_bot ? String(m.reply_to_message.text || m.reply_to_message.caption || '') : '';
    try { await onMessage(text, files, replyTo); } catch (e) { await send(`Could not reach the boss: ${e.message}`).catch(() => {}); }
  }

  async function loop() {
    let backoff = 1000;
    while (running) {
      if (!takeLock()) { if (!standby) { standby = true; changed(); } await new Promise(r => setTimeout(r, 15000)); continue; }
      // Taking over from another copy: it may have linked the chat or moved the offset meanwhile.
      if (standby) { standby = false; cfg = read(); if (!cfg.token) { running = false; dropLock(); changed(); break; } changed(); }
      abort = new AbortController();
      try {
        if (cfg.chatId) void setCommands();
        const updates = await api('getUpdates', { offset: cfg.offset || 0, timeout: 25, allowed_updates: ['message', 'callback_query'] }, cfg.token, abort.signal);
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

  return { status, setToken, linkUrl, disconnect, unlink, send, edit, sendFile, download, setProfile, start, stop, onChange: fn => { listeners.add(fn); return () => listeners.delete(fn); }, connected: () => !!cfg.chatId };
}

const looksLikeToken = t => TOKEN_RE.test(String(t || '').trim());
module.exports = { create, looksLikeToken };
