'use strict';

const { ipcMain, shell, clipboard, dialog, app } = require('electron');
const { checkKillGuards, getOwnerUid, terminate } = require('./kill.js');

function registerIpc({ panel, store, refreshNow, setSuppressHide }) {
  ipcMain.on('refresh', () => refreshNow());
  ipcMain.on('open-port', (_event, port) => shell.openExternal(`http://localhost:${port}`));
  ipcMain.on('copy-url', (_event, port) => clipboard.writeText(`http://localhost:${port}`));
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
