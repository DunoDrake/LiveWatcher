'use strict';

// Default params (not top-of-file requires) so the expressions only run when a
// caller omits the argument. Tests always pass explicit fakes, so these never
// execute under plain `node --test`, which runs outside a real Electron process.
function createUpdateChecker({
  updater = require('electron-updater').autoUpdater,
  dialogModule = require('electron').dialog,
  getCurrentVersion = () => require('electron').app.getVersion()
} = {}) {
  // electron-updater defaults both of these to true, which means it starts
  // downloading in the background the instant 'update-available' fires --
  // before our dialog's await even resolves -- and will silently install a
  // cancelled update on next quit. We drive both explicitly from the dialogs
  // below instead.
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;

  let checking = false;

  updater.on('update-not-available', () => {
    dialogModule.showMessageBox({
      type: 'info',
      buttons: ['OK'],
      message: `You're up to date (v${getCurrentVersion()}).`
    });
    checking = false;
  });

  updater.on('update-available', async (info) => {
    const result = await dialogModule.showMessageBox({
      type: 'info',
      buttons: ['Cancel', 'Download'],
      defaultId: 1,
      cancelId: 0,
      message: `Version ${info.version} is available. Download now?`
    });

    if (result.response === 1) {
      // Left `true` on purpose: the download is now in progress, so a second
      // checkForUpdates() must keep being ignored until it finishes (see
      // update-downloaded, which is the only place this resets afterward).
      updater.downloadUpdate();
    } else {
      checking = false;
    }
  });

  updater.on('update-downloaded', async () => {
    const result = await dialogModule.showMessageBox({
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

  updater.on('update-cancelled', () => {
    checking = false;
  });

  updater.on('error', (error) => {
    dialogModule.showMessageBox({
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
    // In an unpackaged dev build, electron-updater resolves to null with no
    // event at all -- without this, checking would stay true forever and the
    // menu item would go dead until restart. Wrapping the call itself in
    // Promise.resolve().then() also means a synchronous throw from
    // updater.checkForUpdates() flows through the same .catch() below.
    Promise.resolve()
      .then(() => updater.checkForUpdates())
      .then((result) => {
        if (!result) {
          checking = false;
          dialogModule.showMessageBox({
            type: 'info',
            buttons: ['OK'],
            message: 'Updates can only be checked from a packaged build, not when running from source.'
          });
        }
      })
      .catch(() => {
        checking = false;
      });
  }

  return { checkForUpdates };
}

module.exports = { createUpdateChecker };
