const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('trayMenu', {
  onState: fn => ipcRenderer.on('tray:state', (_e, state) => fn(state)),
  ready: height => ipcRenderer.send('tray:ready', height),
  act: (action, arg) => ipcRenderer.send('tray:action', action, arg),
});
