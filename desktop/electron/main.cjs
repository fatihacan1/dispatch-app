// The app shell: one window with up to five project tabs. Each tab is its own renderer (WebContentsView) with its
// own engine (engine.cjs: workspace, operation, agents), so a project's agents keep working while another tab is in
// front. Global pieces live here: the window, tray, voice shortcut, Telegram bot, updater and .dispatch files.
const { app, BaseWindow, WebContentsView, ipcMain, dialog, nativeImage, shell } = require('electron');
// Must run before any ipcMain.handle: it records the handlers so another computer can call them (remote mode).
const remote = require('./remote.cjs')(ipcMain, dialog);
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const storage = require('./storage.cjs');
const createEngine = require('./engine.cjs');
// Dispatch started from inside a Claude Code session (npm run dev in its terminal) inherits that session's markers.
// An agent that sees them thinks it is a child session and stops saving its transcript: no live steps, no turn
// state, no resume. Agents must start as sessions of their own.
for (const key of ['CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_SSE_PORT']) delete process.env[key];
app.setName('Dispatch');
if (process.platform === 'win32') app.setAppUserModelId('com.dispatch.desktop');
if (process.platform === 'darwin') {
  try {
    const shellPath = require('node:child_process').execFileSync(process.env.SHELL || '/bin/zsh', ['-lc', 'printf "%s" "$PATH"'], { timeout: 1500, encoding: 'utf8' }).trim();
    const extra = [shellPath, process.env.PATH, '/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', path.join(os.homedir(), '.local', 'bin')].filter(Boolean).join(':').split(':');
    process.env.PATH = [...new Set(extra.filter(Boolean))].join(':');
  } catch {}
}

const MAX_TABS = 5;
const globalDir = () => path.join(process.env.DISPATCH_HOME || os.homedir(), '.dispatch');
const iconPath = () => path.join(__dirname, '..', app.isPackaged ? 'dist' : 'public', 'icon-256.png');
const same = (a, b) => !!a && !!b && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
let win = null, tray = null, trayWin = null, trayPlace = null, quitting = false;
const tabs = []; let active = null, tabSeq = 0;
const byContents = new Map(); // webContents id -> tab

// ── IPC routing: every engine registers the same channels; a call goes to the engine of the tab that made it ──
const routed = new Set();
const tabFor = e => byContents.get(e?.sender?.id) || active;
function ipcFor(tab) {
  tab.handlers = new Map(); tab.listeners = new Map();
  return {
    handle(channel, fn) {
      tab.handlers.set(channel, fn);
      if (routed.has('h:' + channel)) return; routed.add('h:' + channel);
      ipcMain.handle(channel, (e, ...args) => { const t = tabFor(e), f = t?.handlers.get(channel); if (!f) throw new Error('This project tab is closed.'); return f(e, ...args); });
    },
    on(channel, fn) {
      (tab.listeners.get(channel) || tab.listeners.set(channel, []).get(channel)).push(fn);
      if (routed.has('o:' + channel)) return; routed.add('o:' + channel);
      ipcMain.on(channel, (e, ...args) => { for (const f of tabFor(e)?.listeners.get(channel) || []) f(e, ...args); });
    },
  };
}
const sendTo = (tab, channel, value) => { try { if (tab && !tab.view.webContents.isDestroyed()) tab.view.webContents.send(channel, value); } catch {} };
const broadcast = (channel, value) => { for (const t of tabs) sendTo(t, channel, value); };

// ── Tabs ──
const tabsFile = () => path.join(globalDir(), 'tabs.json');
function saveTabs() {
  if (process.env.DISPATCH_TEST_HOME && !process.env.DISPATCH_TEST_TABS) return;
  try { fs.mkdirSync(globalDir(), { recursive: true }); fs.writeFileSync(tabsFile(), JSON.stringify({ tabs: tabs.filter(t => !t.engine.needsFolder()).map(t => t.engine.workspace()), active: active && !active.engine.needsFolder() ? active.engine.workspace() : null }, null, 2)); } catch {}
}
const tabName = t => t.engine.needsFolder() ? 'New tab' : path.basename(t.engine.workspace()) || t.engine.workspace();
function tabsState(from) {
  return { max: MAX_TABS, from: from ?? null, telegram: tgDefault, tabs: tabs.map(t => { let s = {}; try { s = t.engine.status(); } catch {} return { id: t.id, name: tabName(t), path: t.engine.needsFolder() ? '' : t.engine.workspace(), active: t === active, ...s }; }) };
}
let lastTabs = '';
function broadcastTabs(from) { const state = tabsState(from); lastTabs = JSON.stringify({ ...state, from: null }); broadcast('tabs', state); updateTitle(); }
// Running / working / needs-you dots on background tabs.
setInterval(() => { if (!tabs.length) return; const s = JSON.stringify(tabsState()); if (s !== lastTabs) { lastTabs = s; broadcast('tabs', JSON.parse(s)); } }, 1500).unref?.();
// Frosted Glass: native blur behind the window (Windows acrylic, macOS vibrancy) where the system has it; the page then draws
// translucent panels. Without a material the renderer falls back to an opaque tint (data-material is absent).
let materialOn = false;
function setWindowTheme(id) {
  if (!win || win.isDestroyed()) return;
  const frosted = id === 'frosted';
  let ok = false;
  try {
    if (frosted && process.platform === 'win32' && typeof win.setBackgroundMaterial === 'function') { win.setBackgroundMaterial('acrylic'); ok = true; }
    else if (frosted && process.platform === 'darwin' && typeof win.setVibrancy === 'function') { win.setVibrancy('under-window'); ok = true; }
    else { if (process.platform === 'win32' && typeof win.setBackgroundMaterial === 'function') win.setBackgroundMaterial('none'); if (process.platform === 'darwin' && typeof win.setVibrancy === 'function') win.setVibrancy(null); }
  } catch {}
  materialOn = ok;
  const light = id === 'light';
  const bg = ok ? '#00000000' : light ? '#f4f4f2' : '#0d0e10';
  try { win.setBackgroundColor(bg); } catch {}
  for (const t of tabs) try { t.view.setBackgroundColor(bg); } catch {}
  if (process.platform !== 'darwin') try { win.setTitleBarOverlay({ color: ok ? '#00000000' : light ? '#ffffff' : '#131417', symbolColor: light ? '#55585f' : '#a3a6ad', height: 43 }); } catch {}
  broadcast('material', ok);
}
function updateTitle() { if (win && !win.isDestroyed() && active) win.setTitle(`${tabName(active)} · Dispatch`); }
function layout() {
  if (!win || win.isDestroyed()) return;
  const [width, height] = win.getContentSize();
  // A tab in the back keeps its agents running (they live here, in the main process); its page is throttled like a
  // background browser tab, so its office scene and timers stop costing CPU and GPU.
  for (const t of tabs) { t.view.setBounds({ x: 0, y: 0, width, height }); t.view.setVisible(t === active); try { t.view.webContents.setBackgroundThrottling(t !== active); } catch {} }
}
function rendererUrl(view, hash) {
  if (process.env.VITE_DEV_SERVER_URL) return view.webContents.loadURL(process.env.VITE_DEV_SERVER_URL + (hash ? '#' + hash : ''));
  return view.webContents.loadFile(path.join(__dirname, '../dist/index.html'), hash ? { hash } : undefined);
}
// Tabs restored at start load their page one after another, not all at once (each is a full app): the window is usable sooner.
function loadTab(tab) { if (tab.loaded) return; tab.loaded = true; void rendererUrl(tab.view); }
function createTab(folder, { defer = false } = {}) {
  const view = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  view.setBackgroundColor(materialOn ? '#00000000' : readUi().theme === 'light' ? '#f4f4f2' : '#0d0e10');
  const tab = { id: ++tabSeq, view };
  const host = {
    id: 'tab' + tab.id, ipc: ipcFor(tab), window: win, telegram,
    send: (channel, value) => sendTo(tab, channel, value),
    free: f => !tabs.some(t => t !== tab && t.engine && !t.engine.needsFolder() && same(t.engine.workspace(), f)),
    focusFolder: f => { const t = tabs.find(x => !x.engine.needsFolder() && same(x.engine.workspace(), f)); if (t) activate(t); },
    changed: () => { saveTabs(); broadcastTabs(); },
    isActive: () => active === tab,
    usage: all => { for (const t of tabs) try { t.engine?.onUsage(all); } catch {} },
    customTools,
    material: () => materialOn, setTheme: id => setWindowTheme(id),
    voiceKeyOk: () => voiceKeyOk, registerVoiceKey,
    takePendingPack: () => { const f = pendingPack; pendingPack = null; return f; },
  };
  tab.engine = createEngine(host);
  byContents.set(view.webContents.id, tab);
  tab.engine.init(folder);
  tabs.push(tab);
  win.contentView.addChildView(view);
  view.webContents.on('did-finish-load', () => { if (win && !win.isDestroyed()) sendTo(tab, 'window-fullscreen', win.isFullScreen()); });
  view.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) void shell.openExternal(url); return { action: 'deny' }; });
  // The preload asks remote:target synchronously on load: attach before the first page starts loading.
  if (tabs.length === 1) remote.attach({ webContents: view.webContents }, globalDir(), require('electron'));
  if (!defer) loadTab(tab);
  return tab;
}
function activate(tab) {
  if (!tab || tab === active) return;
  const from = active ? tabs.indexOf(active) : null;
  active = tab; loadTab(tab); layout();
  if (!process.env.DISPATCH_TEST_HIDDEN) try { tab.view.webContents.focus(); } catch {}
  saveTabs(); broadcastTabs(from); sendTo(tab, 'tab-shown', null);
}
function closeTab(tab) {
  const i = tabs.indexOf(tab); if (i < 0) return;
  if (tabs.length === 1) throw new Error('This is the last tab.');
  try { tab.engine.dispose(); } catch (e) { console.error(e); }
  tabs.splice(i, 1); byContents.delete(tab.view.webContents.id);
  try { win.contentView.removeChildView(tab.view); } catch {}
  try { tab.view.webContents.close(); } catch {}
  if (tgDefault === tab.id) tgDefault = null;
  remote.retarget({ webContents: tabs[0].view.webContents });
  if (active === tab) { active = null; activate(tabs[Math.min(i, tabs.length - 1)]); } else { saveTabs(); broadcastTabs(); }
}
async function openTab(folder, caller) {
  if (!folder) { const r = await dialog.showOpenDialog(win, { title: 'Open a project in a new tab', properties: ['openDirectory'] }); if (r.canceled || !r.filePaths[0]) return null; folder = r.filePaths[0]; }
  if (!fs.statSync(folder).isDirectory()) throw new Error('Not a folder.');
  const open = tabs.find(t => !t.engine.needsFolder() && same(t.engine.workspace(), folder));
  if (open) { activate(open); return open.id; }
  // An empty "New tab" (first start) takes the folder itself.
  const blank = caller && caller.engine.needsFolder() ? caller : null;
  if (!blank && tabs.length >= MAX_TABS) throw new Error(`Up to ${MAX_TABS} projects can be open. Close a tab first.`);
  const tab = createTab(folder);
  activate(tab);
  if (blank) closeTab(blank);
  return tab.id;
}
ipcMain.handle('tabs:list', () => tabsState());
ipcMain.handle('tabs:open', (e, folder) => openTab(folder ? String(folder) : '', tabFor(e)));
ipcMain.handle('tabs:switch', (_e, id) => { activate(tabs.find(t => t.id === id)); return true; });
ipcMain.handle('tabs:step', (_e, dir) => { const i = tabs.indexOf(active); activate(tabs[(i + (dir < 0 ? -1 : 1) + tabs.length) % tabs.length]); return true; });
ipcMain.handle('tabs:close', (_e, id) => { closeTab(tabs.find(t => t.id === id)); return true; });
ipcMain.handle('tabs:move', (_e, id, to) => { const i = tabs.findIndex(t => t.id === id); if (i < 0) return false; const [t] = tabs.splice(i, 1); tabs.splice(Math.max(0, Math.min(tabs.length, Number(to) || 0)), 0, t); saveTabs(); broadcastTabs(); return true; });

// ── Telegram: one bot for every tab. A message goes to the project named with @name, the project of the message
// it replies to, or the default project (the last one used, else the tab in front). Each project keeps its own
// Telegram owner (boss, or the agent it was handed to). ──
let tgDefault = null;
const openTabs = () => tabs.filter(t => !t.engine.needsFolder());
function findTab(name) {
  const n = String(name || '').trim().toLowerCase(); if (!n) return null;
  const list = openTabs();
  return list.find(t => tabName(t).toLowerCase() === n) || (list.filter(t => tabName(t).toLowerCase().startsWith(n)).length === 1 ? list.find(t => tabName(t).toLowerCase().startsWith(n)) : null);
}
const tgTarget = () => openTabs().find(t => t.id === tgDefault) || (active && !active.engine.needsFolder() ? active : openTabs()[0]);
const telegram = require('./telegram.cjs').create({
  dir: globalDir(),
  log: t => console.log(t),
  onMessage: async (text, files = [], replyTo = '') => {
    let target = null, body = text;
    const at = text.match(/^@([^\s:]+)[:,]?\s*([\s\S]*)$/);
    if (at) {
      target = findTab(at[1]);
      if (!target) throw new Error(`no open project "${at[1]}". Open: ${openTabs().map(tabName).join(', ') || 'none'}.`);
      body = at[2]; tgDefault = target.id; broadcastTabs();
    } else if (replyTo) { const r = replyTo.match(/^\[([^\]·]+?)(?:\s·\s[^\]]*)?\]/); if (r) target = findTab(r[1]); }
    target ||= tgTarget();
    if (!target) throw new Error('no project is open in Dispatch.');
    if (!body.trim() && !files.length) { tgDefault = target.id; broadcastTabs(); await telegram.send(`Now talking to ${tabName(target)}.`); return; }
    await target.engine.telegramIn(body, files);
  },
  // The "/" menu in Telegram (the bot sets it itself).
  commands: [['projects', 'Open projects: tap one to talk to it'], ['status', 'What every agent is doing'], ['use', 'Talk to a project: /use <number or name>'], ['help', 'How to use this chat']],
  onCommand: async (cmd, arg) => {
    const list = openTabs(), def = tgTarget();
    // Telegram suggests no custom words after @: projects are buttons instead.
    const pick = () => list.map(t => [{ text: `${t === def ? '● ' : ''}${tabName(t)}`, data: `use:${t.id}` }]);
    if (cmd === 'projects' || cmd === 'where') return list.length ? { text: `Open projects. Tap one to talk to it; ${def ? `now: ${tabName(def)}` : 'none chosen'}.\nA reply to a message goes back to that message's project.`, buttons: pick() } : 'No project is open in Dispatch.';
    if (cmd === 'use') {
      if (!arg) return list.length ? { text: 'Which project?', buttons: pick() } : 'No project is open in Dispatch.';
      const n = Number(arg); const t = Number.isInteger(n) && n >= 1 ? list[n - 1] : findTab(arg);
      if (!t) return `No open project "${arg}". Send /projects to see them.`;
      tgDefault = t.id; broadcastTabs();
      return `Messages now go to ${tabName(t)} (${t.engine.owner()} answers).`;
    }
    if (cmd === 'status') {
      if (!list.length) return 'No project is open in Dispatch.';
      return list.map(t => { let team = []; try { team = t.engine.teamStatus(); } catch {} return `${tabName(t)}${t === def ? ' (now)' : ''}\n${team.length ? team.map(a => `  ${a.name}: ${a.state}`).join('\n') : '  no team'}`; }).join('\n\n');
    }
    if (cmd === 'help') return { text: `Write anything and ${def ? tabName(def) : 'the open project'} answers.\nTap / for commands. /projects switches project; @name message also works.\nReply to a message: the answer goes to that project.\nWhen an agent waits 20 s for a command approval, it comes here with Approve / Deny buttons.`, buttons: list.length > 1 ? pick() : [] };
    return null;
  },
  onButton: async data => {
    const use = /^use:(.+)$/.exec(data);
    if (use) {
      const t = openTabs().find(x => String(x.id) === use[1]);
      if (!t) return { toast: 'That project is no longer open.' };
      tgDefault = t.id; broadcastTabs();
      return { toast: `Now: ${tabName(t)}`, text: `Messages now go to ${tabName(t)} (${t.engine.owner()} answers).` };
    }
    for (const t of openTabs()) { let r = null; try { r = t.engine.telegramButton(data); } catch (e) { return { toast: e.message }; } if (r) return r; }
    return { toast: 'This is no longer open.' };
  },
});
telegram.onChange(s => { broadcast('telegram', s); for (const t of tabs) try { t.engine.onTelegramChange(); } catch {} });
ipcMain.handle('telegram:status', () => telegram.status());
ipcMain.handle('telegram:set-token', (_e, token) => telegram.setToken(token));
ipcMain.handle('telegram:link', () => { const url = telegram.linkUrl(); void shell.openExternal(url); return url; });
ipcMain.handle('telegram:unlink', () => telegram.unlink());
ipcMain.handle('telegram:disconnect', () => telegram.disconnect());
ipcMain.handle('telegram:test', () => telegram.send('Test from Dispatch. Your boss can reach you here.'));
ipcMain.handle('telegram:botfather', () => shell.openExternal('https://t.me/BotFather?start'));
ipcMain.handle('telegram:clipboard-token', () => { const t = require('electron').clipboard.readText().trim(); return require('./telegram.cjs').looksLikeToken(t) ? t : null; });

// ── Custom tools (Tools > Add tool): one process per tool for the whole app, every tab sees its terminal ──
const customTools = require('./custom-tools.cjs').create({ dir: globalDir, spawn: (...a) => require('node-pty').spawn(...a) });
customTools.on((channel, value) => broadcast(channel, value));
ipcMain.handle('custom-tools:list', () => customTools.list());
ipcMain.handle('custom-tools:save', (_e, tool) => customTools.save(tool));
ipcMain.handle('custom-tools:remove', (_e, id) => customTools.remove(String(id)));
ipcMain.handle('custom-tools:start', (_e, id) => customTools.start(String(id)));
ipcMain.handle('custom-tools:stop', (_e, id) => customTools.stop(String(id), { remember: true }));
ipcMain.handle('custom-tools:choose-file', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Program or script to run', properties: ['openFile'], filters: process.platform === 'win32' ? [{ name: 'Programs and scripts', extensions: ['bat', 'cmd', 'exe', 'ps1', 'js', 'mjs', 'py'] }, { name: 'All files', extensions: ['*'] }] : [] });
  if (r.canceled || !r.filePaths[0]) return null;
  const f = r.filePaths[0], ext = path.extname(f).toLowerCase(), q = /\s/.test(f) ? `"${f}"` : f;
  const command = ext === '.js' || ext === '.mjs' ? `node ${q}` : ext === '.py' ? `python ${q}` : ext === '.ps1' ? `powershell -NoProfile -ExecutionPolicy Bypass -File ${q}` : q;
  return { command, cwd: path.dirname(f), name: path.basename(f, ext).replace(/[-_]+/g, ' ') };
});
ipcMain.handle('custom-tools:choose-folder', async () => { const r = await dialog.showOpenDialog(win, { title: 'Folder to run it in', properties: ['openDirectory'] }); return r.canceled ? null : r.filePaths[0] || null; });

// ── Updates ──
const updater = require('./updater.cjs').create({ notify: broadcast, onBeforeInstall: () => { quitting = true; } });
ipcMain.handle('update:status', () => updater.status());
ipcMain.handle('update:check', () => updater.check());
ipcMain.handle('update:install', () => updater.install());

// ── Voice shortcut and its overlay (types into whatever app has focus, or into the tab in front) ──
const whisper = require('./whisper.cjs');
const VOICE_KEYS = ['Control+Alt+Space', 'Control+Shift+Space', 'Control+Alt+D', 'F9'];
const readUi = () => { try { return JSON.parse(fs.readFileSync(path.join(globalDir(), 'ui.json'), 'utf8')); } catch { return {}; } };
const voiceKey = () => VOICE_KEYS.includes(readUi().voiceShortcut) ? readUi().voiceShortcut : VOICE_KEYS[0];
let overlay = null, overlayOn = false, voiceKeyOk = false;
function overlayWindow() {
  if (overlay && !overlay.isDestroyed()) return overlay;
  const { BrowserWindow } = require('electron');
  overlay = new BrowserWindow({ width: 120, height: 36, show: false, frame: false, transparent: true, hasShadow: false, alwaysOnTop: true, focusable: true, skipTaskbar: true, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, backgroundColor: '#00000000', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  void rendererUrl(overlay, 'overlay');
  overlay.on('closed', () => { overlay = null; overlayOn = false; });
  return overlay;
}
function showOverlay() {
  const { screen } = require('electron');
  const o = overlayWindow();
  const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  o.setBounds({ x: wa.x + Math.round((wa.width - 120) / 2), y: wa.y + wa.height - 36 - 60, width: 120, height: 36 });
  o.setAlwaysOnTop(true, 'screen-saver', 1);
  // Inactive: the user keeps typing focus in whatever app they were in.
  o.showInactive(); o.moveTop(); overlayOn = true;
  const start = () => o.webContents.send('overlay-start');
  if (o.webContents.isLoading()) o.webContents.once('did-finish-load', start); else start();
}
// e2e only: press the shortcut (forceOverlay = as if another app had focus).
if (process.env.DISPATCH_TEST_HOME) global.__dispatchVoiceKey = forceOverlay => onVoiceKey(forceOverlay);
function onVoiceKey(forceOverlay = false) {
  if (!forceOverlay && win && !win.isDestroyed() && win.isVisible() && win.isFocused()) return sendTo(active, 'voice-toggle', null);
  if (overlayOn && overlay && !overlay.isDestroyed()) return overlay.webContents.send('overlay-stop');
  showOverlay();
}
function registerVoiceKey() {
  const { globalShortcut } = require('electron');
  globalShortcut.unregisterAll();
  if (process.env.DISPATCH_TEST_HOME) { voiceKeyOk = true; return; }
  try { voiceKeyOk = globalShortcut.register(voiceKey(), onVoiceKey); } catch { voiceKeyOk = false; }
}
ipcMain.on('overlay:done', (_e, text) => { overlay?.hide(); overlayOn = false; if (text && String(text).trim()) sendTo(active, 'voice-result', String(text).trim()); });
ipcMain.on('overlay:live', (_e, text) => sendTo(active, 'voice-live', String(text || '')));
ipcMain.on('overlay:close', () => { overlay?.hide(); overlayOn = false; });

// ── Tray ──
function createTray() {
  const { Tray, BrowserWindow, screen } = require('electron');
  const trayFile = path.join(__dirname, '..', app.isPackaged ? 'dist' : 'public', 'tray.png');
  let trayImg = nativeImage.createFromPath(trayFile);
  if (process.platform === 'darwin') {
    try {
      const retina = nativeImage.createEmpty();
      retina.addRepresentation({ scaleFactor: 2, width: 16, height: 16, buffer: fs.readFileSync(trayFile) });
      if (!retina.isEmpty()) trayImg = retina;
      else trayImg = trayImg.resize({ width: 18, height: 18 });
    } catch { trayImg = trayImg.resize({ width: 18, height: 18 }); }
  }
  tray = new Tray(trayImg);
  tray.setToolTip('Dispatch');
  // Custom right-click menu: one hidden, reused window (opens instantly), placed next to the tray icon.
  trayWin = new BrowserWindow({ width: 280, height: 300, show: false, frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false, webPreferences: { backgroundThrottling: false, preload: path.join(__dirname, 'tray-preload.cjs'), contextIsolation: true, nodeIntegration: false } });
  void trayWin.loadFile(path.join(__dirname, 'tray-menu.html'));
  // Blur fires when the right-click itself lands on the tray icon; ignore it for a moment so the menu is not hidden right after opening.
  trayWin.on('blur', () => { if (Date.now() - (trayWin.shownAt || 0) > 300) trayWin.hide(); });
  trayWin.webContents.on('before-input-event', (e, input) => { if (input.type === 'keyDown' && input.key === 'Escape') { e.preventDefault(); trayWin.hide(); } });
  trayPlace = height => {
    const b = tray.getBounds(), wa = screen.getDisplayNearestPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 }).workArea, w = 280, h = Math.min(Math.max(height, 80), wa.height);
    trayWin.setBounds({ x: Math.round(Math.min(Math.max(b.x + b.width / 2 - w / 2, wa.x), wa.x + wa.width - w)), y: Math.round(Math.min(Math.max(b.y < wa.y + wa.height / 2 ? b.y + b.height : b.y - h, wa.y), wa.y + wa.height - h)), width: w, height: h });
    trayWin.shownAt = Date.now(); trayWin.show(); trayWin.focus();
  };
  tray.on('right-click', () => {
    const open = openTabs(), sum = open.reduce((a, t) => { const s = t.engine.status(); return { running: a.running + s.running, needs: a.needs + s.needs }; }, { running: 0, needs: 0 });
    let recent = []; try { recent = JSON.parse(fs.readFileSync(path.join(globalDir(), 'workspaces.json'), 'utf8')); } catch {}
    trayWin.webContents.send('tray:state', { icon: nativeImage.createFromPath(iconPath()).resize({ width: 44 }).toDataURL(), folder: open.map(tabName).join(', ') || 'No project', running: sum.running, attention: sum.needs, recent: recent.filter(w => !open.some(t => same(t.engine.workspace(), w)) && !path.resolve(w).toLowerCase().startsWith(path.resolve(os.tmpdir()).toLowerCase()) && fs.existsSync(w)).slice(0, 5).map(w => ({ name: path.basename(w) || w, path: w })) });
  });
  ipcMain.on('tray:ready', (_e, height) => trayPlace(Number(height) || 300));
  ipcMain.on('tray:action', (_e, action, arg) => {
    trayWin.hide();
    if (action === 'quit') { quitting = true; return app.quit(); }
    if (!win || win.isDestroyed() || action === 'hide') return;
    revealWin();
    if (action === 'view') sendTo(active, 'tray-nav', { view: String(arg) });
    else if (action === 'workspace') openTab(String(arg), active).catch(e => sendTo(active, 'send-error', e.message));
  });
  // Click always brings the window back (no toggle): a double click used to show then hide it again.
  tray.on('click', revealWin);
  tray.on('double-click', revealWin);
}
// show() alone does not undo a minimize on Windows, so restore first.
function revealWin() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}

// ── .dispatch packs: double-clicked files arrive in argv (a second instance) or open-file (macOS) ──
let pendingPack = null;
const PACK_EXT = require('./pack.cjs').EXT;
function packFromArgv(argv) { return argv.slice(1).find(a => a.toLowerCase().endsWith('.' + PACK_EXT) && fs.existsSync(a)) || null; }
function showPack(file) { if (!file) return; pendingPack = file; if (win) { revealWin(); sendTo(active, 'pack-open', file); } }
if (app.isPackaged && !app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', (_e, argv) => { const f = packFromArgv(argv); if (f) showPack(f); else revealWin(); });
app.on('open-file', (e, file) => { e.preventDefault(); if (file.toLowerCase().endsWith('.' + PACK_EXT)) showPack(file); });
pendingPack = packFromArgv(process.argv);

app.whenReady().then(() => {
  // Music scene visualizer: getDisplayMedia hands the page the system sound (loopback); the screen video track is dropped by the page.
  try {
    const { session, desktopCapturer } = require('electron');
    session.defaultSession.setDisplayMediaRequestHandler((_req, cb) => { desktopCapturer.getSources({ types: ['screen'] }).then(src => cb(src[0] ? { video: src[0], audio: 'loopback' } : {})).catch(() => cb({})); });
  } catch {}
  if (process.env.DISPATCH_TEST_HOME) process.env.USERPROFILE = process.env.DISPATCH_TEST_HOME;
  storage.migrate(process.env.DISPATCH_HOME || os.homedir());
  // DISPATCH_TEST_HIDDEN: e2e runs never show a window or take focus from what the user is doing.
  const hidden = !!process.env.DISPATCH_TEST_HIDDEN;
  win = new BaseWindow({ show: !hidden, focusable: !hidden, title: 'Dispatch', icon: iconPath(), width: 1280, height: 800, minWidth: 800, minHeight: 560, backgroundColor: '#0d0e10', titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden', ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 14, y: 16 } } : { titleBarOverlay: { color: '#131417', symbolColor: '#a3a6ad', height: 43 } }) });
  win.on('resize', layout);
  setWindowTheme(readUi().theme);
  win.on('enter-full-screen', () => broadcast('window-fullscreen', true));
  win.on('leave-full-screen', () => broadcast('window-fullscreen', false));
  win.on('focus', () => updater.focus());
  // The close button keeps Dispatch (and its agents) running in the tray; Quit in the tray menu ends it.
  win.on('close', e => { if (!quitting && tray && !process.env.DISPATCH_TEST_HOME) { e.preventDefault(); win.hide(); } });
  win.on('closed', () => { if (!quitting) app.quit(); });
  // The tabs that were open last time come back, each continuing its own operation.
  let saved = { tabs: [], active: null };
  if (!process.env.DISPATCH_TEST_HOME || process.env.DISPATCH_TEST_TABS) try { saved = JSON.parse(fs.readFileSync(tabsFile(), 'utf8')); } catch {}
  const folders = (saved.tabs || []).filter(f => { try { return fs.statSync(f).isDirectory(); } catch { return false; } }).slice(0, MAX_TABS);
  if (folders.length) for (const f of folders) createTab(f, { defer: true }); else createTab();
  activate(tabs.find(t => same(t.engine.workspace(), saved.active)) || tabs[0]);
  const loadRest = () => { const next = tabs.find(t => !t.loaded); if (!next) return; loadTab(next); let went = false; const go = () => { if (!went) { went = true; setTimeout(loadRest, 800); } }; next.view.webContents.once('did-finish-load', go); setTimeout(go, 6000); };
  // Tray and the bot come after the first tab has loaded: the window is up sooner, and the tab is the first page.
  let rest = false; const startRest = () => { if (rest) return; rest = true; createTray(); registerVoiceKey(); telegram.start(); if (!process.env.DISPATCH_TEST_HOME || process.env.DISPATCH_TEST_TOOLS) customTools.autostart(); setTimeout(loadRest, 1500); };
  active.view.webContents.once('did-finish-load', () => setTimeout(startRest, 600)); setTimeout(startRest, 8000);
});
// On quit every project's agents go down with everything they started.
app.on('before-quit', () => { quitting = true; for (const t of tabs) try { t.engine.dispose(); } catch {} customTools.stopAll(); require('./vpns.cjs').stopAll(); telegram.stop(); try { tray?.destroy(); } catch {} });
app.on('will-quit', () => { try { require('electron').globalShortcut.unregisterAll(); } catch {} whisper.stop(); });
app.on('activate', () => { if (win && !win.isDestroyed()) revealWin(); });
app.on('window-all-closed', () => app.quit());
