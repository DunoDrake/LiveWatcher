'use strict';

function createUpdateChecker({
  updater = require('electron-updater').autoUpdater,
  dialogModule = require('electron').dialog,
  getWindow,
  getCurrentVersion = () => require('electron').app.getVersion()
} = {}) {
  let checking = false;

  updater.on('update-not-available', () => {
    dialogModule.showMessageBox(getWindow(), {
      type: 'info',
      buttons: ['OK'],
      message: `You're up to date (v${getCurrentVersion()}).`
    });
    checking = false;
  });

  updater.on('update-available', async (info) => {
    const result = await dialogModule.showMessageBox(getWindow(), {
      type: 'info',
      buttons: ['Cancel', 'Download'],
      defaultId: 1,
      cancelId: 0,
      message: `Version ${info.version} is available. Download now?`
    });

    if (result.response === 1) {
      updater.downloadUpdate();
    } else {
      checking = false;
    }
  });

  updater.on('update-downloaded', async () => {
    const result = await dialogModule.showMessageBox(getWindow(), {
      type: 'info',
      buttons: ['Later', 'Restart'],
      defaultId: 1,
      cancelId: 0,
      message: 'Update downloaded. Restart now to install?'
    });

    checking = false;
    if (result.response === 1) {
      updater.quitAndInstall();
    }
  });

  updater.on('error', (error) => {
    dialogModule.showMessageBox(getWindow(), {
      type: 'error',
      buttons: ['OK'],
      message: 'Update check failed.',
      detail: error && error.message ? error.message : String(error)
    });
    checking = false;
  });

  function checkForUpdates() {
    if (checking) return;
    checking = true;
    updater.checkForUpdates();
  }

  return { checkForUpdates };
}

module.exports = { createUpdateChecker };
