'use strict';

// Default params (not top-of-file requires) so the expressions only run when a
// caller omits the argument. Tests always pass explicit fakes, so these never
// execute under plain `node --test`, which runs outside a real Electron process.
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
      // Left `true` on purpose: the download is now in progress, so a second
      // checkForUpdates() must keep being ignored until it finishes (see
      // update-downloaded, which is the only place this resets afterward).
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
    // The real autoUpdater both emits 'error' and rejects the returned promise
    // on failure. The 'error' listener already shows the dialog, so this catch
    // just needs to swallow the rejection and avoid an unhandled-rejection warning.
    Promise.resolve(updater.checkForUpdates()).catch(() => {});
  }

  return { checkForUpdates };
}

module.exports = { createUpdateChecker };
