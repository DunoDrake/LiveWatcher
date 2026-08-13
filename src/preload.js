'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('liveWatcher', {
  onSnapshot: (handler) => {
    ipcRenderer.on('snapshot', (_event, payload) => handler(payload));
  },
  refresh: () => ipcRenderer.send('refresh'),
  openPort: (port) => ipcRenderer.send('open-port', port),
  copyUrl: (port) => ipcRenderer.send('copy-url', port),
  stopServer: (payload) => ipcRenderer.invoke('stop-server', payload),
  setSetting: (key, value) => ipcRenderer.invoke('set-setting', { key, value }),
  quit: () => ipcRenderer.send('quit')
});
