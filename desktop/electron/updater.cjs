// Self-update from GitHub Releases (fatihacan1/dispatch-app) with electron-updater. Only in the installed app:
// checks 8 s after start, every 30 minutes and when the window gets focus (at most every 10 minutes), downloads
// in the background; the version label in the bottom bar turns into an Update button when it is ready.
// Installing restarts Dispatch; chats and settings live in ~/.dispatch, untouched.
const { app } = require('electron');

function create({ notify, onBeforeInstall = () => {} }) {
  let state = { current: app.getVersion(), available: '', ready: false, progress: 0, checking: false, checked: 0, error: '', enabled: false };
  const set = patch => { state = { ...state, ...patch }; notify('update', state); };
  if (!app.isPackaged || process.env.DISPATCH_TEST_HOME) return { status: () => state, check: async () => state, install: () => false, focus: () => {} };
  const { autoUpdater } = require('electron-updater');
  state.enabled = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = { info: m => console.log('[update]', m), warn: m => console.warn('[update]', m), error: m => console.error('[update]', m), debug: () => {} };
  autoUpdater.on('update-available', i => set({ available: i.version, error: '' }));
  autoUpdater.on('update-not-available', () => set({ available: '', error: '' }));
  autoUpdater.on('download-progress', p => set({ progress: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', i => set({ available: i.version, ready: true, progress: 100 }));
  autoUpdater.on('error', e => set({ checking: false, error: String(e?.message || e).split('\n')[0] }));
  let busy = false;
  const check = async () => {
    if (busy || state.ready) return state;
    busy = true; set({ checking: true });
    try { await autoUpdater.checkForUpdates(); } catch (e) { set({ error: String(e?.message || e).split('\n')[0] }); }
    busy = false; set({ checking: false, checked: Date.now() });
    return state;
  };
  app.whenReady().then(() => { setTimeout(check, 8000); setInterval(check, 30 * 60e3).unref?.(); });
  return {
    status: () => state,
    check,
    focus: () => { if (Date.now() - state.checked > 10 * 60e3) void check(); },
    install: () => { if (!state.ready) return false; onBeforeInstall(); setImmediate(() => autoUpdater.quitAndInstall(false, true)); return true; },
  };
}
module.exports = { create };
