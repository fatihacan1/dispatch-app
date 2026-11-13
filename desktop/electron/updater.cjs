// Self-update from GitHub Releases (fatihacan1/dispatch-app) with electron-updater. Only in the installed app:
// checks at start and every 4 hours, downloads in the background, and the rail shows a blue Update button
// when a new version is ready. Installing restarts Dispatch; chats and settings live in ~/.dispatch, untouched.
const { app } = require('electron');

function create({ notify, onBeforeInstall = () => {} }) {
  let state = { current: app.getVersion(), available: '', ready: false, progress: 0, error: '' };
  const set = patch => { state = { ...state, ...patch }; notify('update', state); };
  if (!app.isPackaged || process.env.DISPATCH_TEST_HOME) return { status: () => state, check: async () => state, install: () => false };
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', i => set({ available: i.version, error: '' }));
  autoUpdater.on('download-progress', p => set({ progress: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', i => set({ available: i.version, ready: true, progress: 100 }));
  autoUpdater.on('error', e => set({ error: String(e?.message || e).split('\n')[0] }));
  const check = async () => { try { await autoUpdater.checkForUpdates(); } catch (e) { set({ error: String(e?.message || e).split('\n')[0] }); } return state; };
  app.whenReady().then(() => { setTimeout(check, 8000); setInterval(check, 4 * 3600e3).unref?.(); });
  return {
    status: () => state,
    check,
    install: () => { if (!state.ready) return false; onBeforeInstall(); setImmediate(() => autoUpdater.quitAndInstall(false, true)); return true; },
  };
}
module.exports = { create };
