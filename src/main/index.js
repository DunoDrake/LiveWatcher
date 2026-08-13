'use strict';

const { app } = require('electron');
const { createTray } = require('./tray.js');

let trayHandle = null;

if (process.platform === 'darwin' && app.dock) app.dock.hide();

app.whenReady().then(() => {
  trayHandle = createTray({ onVisibilityChange: () => {} });
});

// A tray app has no windows to keep alive, so the default quit-on-close is wrong.
app.on('window-all-closed', (event) => event.preventDefault());
