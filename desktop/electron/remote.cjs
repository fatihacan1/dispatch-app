// Remote mode: one Dispatch (e.g. an always-on Mac) shares its main process on the local network and
// another Dispatch (e.g. a Windows laptop) uses it as if it were local, like VS Code Remote-SSH.
// No dependencies: plain HTTP for calls (POST /invoke, /send) and Server-Sent Events for main -> renderer events.
// The renderer side lives in preload.cjs; the shared wire format is in remote-wire.cjs.
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const wire = require('./remote-wire.cjs');

const DEFAULT_PORT = 7420;
// Channels only this computer may use: remote control itself and the voice overlay window.
const LOCAL_ONLY = /^(remote:|overlay:|tray:)/;

module.exports = function createRemote(ipcMain, dialog) {
  const handlers = new Map(); // invoke channels
  const listeners = new Map(); // send channels
  const origHandle = ipcMain.handle.bind(ipcMain), origOn = ipcMain.on.bind(ipcMain);
  ipcMain.handle = (channel, fn) => { handlers.set(channel, fn); return origHandle(channel, fn); };
  ipcMain.on = (channel, fn) => { (listeners.get(channel) || listeners.set(channel, []).get(channel)).push(fn); return origOn(channel, fn); };

  // A dialog opened while serving a remote call is shown on the caller's screen (a picker over this computer's files).
  const callCtx = new AsyncLocalStorage();
  const pendingDialogs = new Map();
  const bridge = (orig, mode) => function (...args) {
    const ctx = callCtx.getStore();
    if (!ctx) return orig.apply(dialog, args);
    const options = (args.length > 1 ? args[1] : args[0]) || {};
    const id = crypto.randomUUID();
    broadcast('remote:dialog', { client: ctx.client, id, mode, options: { title: options.title, properties: options.properties, defaultPath: options.defaultPath, filters: options.filters } });
    return new Promise(resolve => pendingDialogs.set(id, resolve));
  };
  dialog.showOpenDialog = bridge(dialog.showOpenDialog, 'open');
  dialog.showSaveDialog = bridge(dialog.showSaveDialog, 'save');

  let file = '', config = {}, server = null, win = null, keepAwake = null, electron = null;
  const clients = new Set();
  const save = () => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(config, null, 2)); };
  function broadcast(channel, value) {
    if (!clients.size) return;
    const line = `data: ${JSON.stringify({ channel, value: wire.encode(value) })}\n\n`;
    for (const c of clients) c.res.write(line);
  }

  const lanAddresses = () => Object.values(os.networkInterfaces()).flat().filter(a => a && a.family === 'IPv4' && !a.internal).map(a => a.address)
    .sort((a, b) => (/^(192\.168|10\.|172\.)/.test(b) ? 1 : 0) - (/^(192\.168|10\.|172\.)/.test(a) ? 1 : 0));
  const hostName = () => os.hostname().replace(/\.local$/i, '');
  const shareHosts = () => [...lanAddresses(), ...(process.platform === 'darwin' ? [hostName() + '.local'] : [])];
  const link = () => config.token ? `dispatch://${shareHosts()[0] || '127.0.0.1'}:${config.port || DEFAULT_PORT}/${config.token}?name=${encodeURIComponent(hostName())}${shareHosts().slice(1).map(h => '&alt=' + encodeURIComponent(h)).join('')}` : '';

  function listDir(target) {
    const dir = path.resolve(target || os.homedir());
    const entries = fs.readdirSync(dir, { withFileTypes: true }).filter(d => !d.name.startsWith('.')).map(d => {
      let isDir = d.isDirectory();
      if (d.isSymbolicLink()) try { isDir = fs.statSync(path.join(dir, d.name)).isDirectory(); } catch {}
      return { name: d.name, dir: isDir };
    }).sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name));
    const parent = path.dirname(dir);
    return { path: dir, parent: parent === dir ? null : parent, sep: path.sep, home: os.homedir(), entries };
  }
  const remoteHandlers = { 'remote-fs:list': (_e, target) => listDir(target), 'remote-fs:join': (_e, dir, name) => path.join(dir, name) };

  const body = req => new Promise((resolve, reject) => { const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(e); } }); req.on('error', reject); });
  const reply = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(value)); };
  const fakeEvent = () => ({ sender: win?.webContents, senderFrame: null, remote: true, returnValue: undefined, reply: () => {} });

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST' }); return res.end(); }
    const token = url.searchParams.get('token') || '';
    const ok = config.token && token.length === config.token.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(config.token));
    if (!ok) return reply(res, 401, { error: 'Wrong or expired link.' });
    const client = url.searchParams.get('client') || '';
    if (url.pathname === '/ping') return reply(res, 200, { ok: true, name: hostName(), platform: process.platform });
    if (url.pathname === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
      res.write(': hello\n\n');
      const c = { id: client, res }; clients.add(c);
      const beat = setInterval(() => res.write(': beat\n\n'), 15000);
      req.on('close', () => { clearInterval(beat); clients.delete(c); });
      return;
    }
    if (req.method !== 'POST') return reply(res, 404, { error: 'Not found' });
    let msg; try { msg = await body(req); } catch { return reply(res, 400, { error: 'Bad request' }); }
    const channel = String(msg.channel || ''), args = Array.isArray(msg.args) ? wire.decode(msg.args) : [];
    if (url.pathname === '/dialog') { const done = pendingDialogs.get(msg.id); pendingDialogs.delete(msg.id); done?.(msg.result || { canceled: true, filePaths: [] }); return reply(res, 200, { ok: true }); }
    if (LOCAL_ONLY.test(channel)) return reply(res, 403, { error: `${channel} is not available remotely` });
    if (url.pathname === '/send') {
      for (const fn of listeners.get(channel) || []) try { callCtx.run({ client }, () => fn(fakeEvent(), ...args)); } catch (e) { console.error('remote send', channel, e); }
      return reply(res, 200, { ok: true });
    }
    if (url.pathname === '/invoke') {
      const fn = remoteHandlers[channel] || handlers.get(channel);
      if (!fn) return reply(res, 404, { error: `No handler for ${channel}` });
      try { const value = await callCtx.run({ client }, () => fn(fakeEvent(), ...args)); return reply(res, 200, { value: wire.encode(value) }); }
      catch (e) { return reply(res, 200, { error: e?.message || String(e) }); }
    }
    return reply(res, 404, { error: 'Not found' });
  }

  function startServer() {
    if (server) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = http.createServer((req, res) => { handle(req, res).catch(e => { try { reply(res, 500, { error: String(e) }); } catch {} }); });
      s.once('error', reject);
      s.listen(config.port || DEFAULT_PORT, '0.0.0.0', () => { server = s; resolve(); });
    }).then(() => { if (electron && !keepAwake) keepAwake = electron.powerSaveBlocker.start('prevent-app-suspension'); });
  }
  function stopServer() {
    if (keepAwake != null) { electron.powerSaveBlocker.stop(keepAwake); keepAwake = null; }
    for (const c of clients) c.res.end(); clients.clear();
    for (const done of pendingDialogs.values()) done({ canceled: true, filePaths: [] }); pendingDialogs.clear();
    if (server) { server.close(); server = null; }
  }

  function ping(host, port, token, timeout = 3000) {
    return new Promise(resolve => {
      const req = http.get({ host, port, path: `/ping?token=${encodeURIComponent(token)}`, timeout }, res => {
        const chunks = []; res.on('data', c => chunks.push(c));
        res.on('end', () => { try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(res.statusCode === 200 ? { ok: true, name: v.name } : { ok: false, error: v.error || `HTTP ${res.statusCode}` }); } catch { resolve({ ok: false, error: 'That address is not a Dispatch computer.' }); } });
      });
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'It did not answer.' }); });
      req.on('error', e => resolve({ ok: false, error: e.code === 'ECONNREFUSED' ? 'Dispatch is not running there, or sharing is off.' : e.message }));
    });
  }
  function parseLink(text) {
    const m = String(text || '').trim().match(/^dispatch:\/\/([^/:?#]+):(\d+)\/([A-Za-z0-9]+)(?:\?(.*))?$/);
    if (!m) throw new Error('This is not a Dispatch link. It starts with dispatch://');
    const q = new URLSearchParams(m[4] || '');
    return { hosts: [m[1], ...q.getAll('alt')], port: Number(m[2]), token: m[3], name: q.get('name') || m[1] };
  }
  /** Tries every address of the target; the first that answers moves to the front. */
  async function reach(target) {
    let last = { ok: false, error: 'No address' };
    for (const host of target.hosts) {
      last = await ping(host, target.port, target.token);
      if (last.ok) return { ok: true, name: last.name, target: { ...target, name: last.name || target.name, hosts: [host, ...target.hosts.filter(h => h !== host)] } };
    }
    return last;
  }

  return {
    /** Called once the main window exists: events it receives are mirrored to remote clients. */
    attach(window, dir, electronModule) {
      win = window; electron = electronModule; file = path.join(dir, 'remote.json');
      try { config = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { config = {}; }
      const wc = win.webContents, send = wc.send.bind(wc);
      wc.send = (channel, ...args) => { send(channel, ...args); broadcast(channel, args[0]); };
      if (config.share) startServer().catch(e => console.error('Remote sharing could not start:', e.message));
      const status = () => ({ share: !!server, link: server ? link() : '', clients: new Set([...clients].map(c => c.id)).size, target: config.target || null, loginItem: electron.app.getLoginItemSettings().openAtLogin, host: hostName() });
      origOn('remote:target', e => { e.returnValue = config.target || null; });
      origHandle('remote:status', () => status());
      origHandle('remote:share', async (_e, on) => {
        if (on) { config.token ||= crypto.randomBytes(18).toString('hex'); config.share = true; save(); await startServer(); }
        else { config.share = false; save(); stopServer(); }
        return status();
      });
      origHandle('remote:new-link', async () => { config.token = crypto.randomBytes(18).toString('hex'); save(); for (const c of clients) c.res.end(); clients.clear(); return status(); });
      origHandle('remote:login-item', (_e, on) => { electron.app.setLoginItemSettings({ openAtLogin: !!on, openAsHidden: true }); return status(); });
      origHandle('remote:connect', async (_e, text) => {
        const result = await reach(parseLink(text));
        if (!result.ok) throw new Error(`Could not reach that computer: ${result.error}`);
        config.target = result.target; save(); return result.target;
      });
      origHandle('remote:reach', async () => {
        if (!config.target) return { ok: false, error: 'Not connected' };
        const result = await reach(config.target);
        if (result.ok) { config.target = result.target; save(); }
        return result.ok ? { ok: true, target: result.target } : result;
      });
      origHandle('remote:disconnect', () => { delete config.target; save(); return true; });
    },
    stop: stopServer,
    _test: { parseLink, listDir },
  };
};
