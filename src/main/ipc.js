'use strict';

const { ipcMain, shell, clipboard, dialog, app } = require('electron');
const {
  checkKillGuards,
  getOwnerUid,
  readProcessName,
  processIdentityMatches,
  terminate
} = require('./kill.js');

// Everything arriving over IPC is treated as untrusted input. A non-numeric port
// would otherwise be interpolated straight into a URL, where 'localhost:@host'
// parses as userinfo and sends the user to a foreign origin.
const isValidPort = (port) => Number.isInteger(port) && port > 0 && port <= 65535;

function registerIpc({ panel, store, refreshNow, setSuppressHide }) {
  ipcMain.on('refresh', () => refreshNow());

  ipcMain.on('open-port', (_event, port) => {
    if (isValidPort(port)) shell.openExternal(`http://localhost:${port}`);
  });

  ipcMain.on('copy-url', (_event, port) => {
    if (isValidPort(port)) clipboard.writeText(`http://localhost:${port}`);
  });

  ipcMain.on('quit', () => app.quit());

  ipcMain.handle('set-setting', (_event, { key, value }) => {
    store.set(key, value);
    // Running from source would otherwise register the Electron binary itself
    // as a login item, which is never what the developer wants.
    if (key === 'openAtLogin' && app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: value, openAsHidden: true });
    }
    return store.all();
  });

  ipcMain.handle('stop-server', async (_event, { pid, port, processName }) => {
    const ownerUid = await getOwnerUid(pid);
    const currentUid = process.platform === 'win32' ? null : process.getuid();

    const guard = checkKillGuards({ pid, processName, ownerUid, currentUid });
    if (!guard.allowed) return { ok: false, reason: guard.reason };

    setSuppressHide(true);
    try {
      const confirmation = await dialog.showMessageBox(panel, {
        type: 'warning',
        buttons: ['Cancel', 'Stop server'],
        defaultId: 0,
        cancelId: 0,
        message: `Stop ${processName} on port ${port}?`,
        detail: `This sends SIGTERM to PID ${pid}. Unsaved work in that process will be lost.`
      });
      if (confirmation.response !== 1) return { ok: false, reason: null };

      // Re-check identity now, not when the row was drawn. The dialog may have
      // been open for minutes, and a PID freed in the meantime can be reissued
      // to something the user very much did not mean to kill.
      const liveName = await readProcessName(pid);
      if (!processIdentityMatches(processName, liveName)) {
        return {
          ok: false,
          reason: `PID ${pid} is no longer ${processName}. Nothing was stopped.`
        };
      }

      const result = await terminate({ pid });
      if (!result.ok) return { ok: false, reason: result.reason };

      if (result.stillAlive) {
        const force = await dialog.showMessageBox(panel, {
          type: 'warning',
          buttons: ['Leave it running', 'Force kill'],
          defaultId: 0,
          cancelId: 0,
          message: `${processName} ignored the stop request.`,
          detail: 'Force killing sends SIGKILL, which gives the process no chance to clean up.'
        });
        if (force.response === 1) await terminate({ pid, force: true });
      }
    } finally {
      setSuppressHide(false);
    }

    refreshNow();
    return { ok: true, reason: null };
  });
}

module.exports = { registerIpc };
