'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');

const { createUpdateChecker } = require('../src/main/updater.js');

function createFakeUpdater() {
  const updater = new EventEmitter();
  updater.checkForUpdatesCalls = 0;
  updater.downloadUpdateCalls = 0;
  updater.quitAndInstallCalls = 0;
  updater.checkForUpdates = () => { updater.checkForUpdatesCalls += 1; };
  updater.downloadUpdate = () => { updater.downloadUpdateCalls += 1; };
  updater.quitAndInstall = () => { updater.quitAndInstallCalls += 1; };
  return updater;
}

function createFakeDialog(responses) {
  const calls = [];
  const queue = [...responses];
  return {
    calls,
    showMessageBox: async (_window, options) => {
      calls.push(options);
      return { response: queue.shift() };
    }
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('checkForUpdates calls through to the real updater', () => {
  const updater = createFakeUpdater();
  const dialogModule = createFakeDialog([]);
  const checker = createUpdateChecker({ updater, dialogModule, getWindow: () => null });

  checker.checkForUpdates();

  assert.strictEqual(updater.checkForUpdatesCalls, 1);
});

test('a second call while one is in flight is ignored', () => {
  const updater = createFakeUpdater();
  const dialogModule = createFakeDialog([]);
  const checker = createUpdateChecker({ updater, dialogModule, getWindow: () => null });

  checker.checkForUpdates();
  checker.checkForUpdates();

  assert.strictEqual(updater.checkForUpdatesCalls, 1);
});

test('update-not-available shows an up-to-date dialog and clears the in-flight flag', async () => {
  const updater = createFakeUpdater();
  const dialogModule = createFakeDialog([]);
  const checker = createUpdateChecker({
    updater,
    dialogModule,
    getWindow: () => null,
    getCurrentVersion: () => '1.2.3'
  });

  checker.checkForUpdates();
  updater.emit('update-not-available');
  await flush();

  assert.match(dialogModule.calls[0].message, /up to date/i);
  assert.match(dialogModule.calls[0].message, /1\.2\.3/);

  checker.checkForUpdates();
  assert.strictEqual(updater.checkForUpdatesCalls, 2);
});

test('update-available: choosing Cancel does not download, and clears the flag', async () => {
  const updater = createFakeUpdater();
  const dialogModule = createFakeDialog([0]);
  const checker = createUpdateChecker({ updater, dialogModule, getWindow: () => null });

  checker.checkForUpdates();
  updater.emit('update-available', { version: '9.9.9' });
  await flush();

  assert.strictEqual(updater.downloadUpdateCalls, 0);
  checker.checkForUpdates();
  assert.strictEqual(updater.checkForUpdatesCalls, 2);
});

test('update-available: choosing Download calls downloadUpdate', async () => {
  const updater = createFakeUpdater();
  const dialogModule = createFakeDialog([1]);
  const checker = createUpdateChecker({ updater, dialogModule, getWindow: () => null });

  checker.checkForUpdates();
  updater.emit('update-available', { version: '9.9.9' });
  await flush();

  assert.match(dialogModule.calls[0].message, /9\.9\.9/);
  assert.strictEqual(updater.downloadUpdateCalls, 1);
});

test('update-downloaded: choosing Later does not install, and clears the flag', async () => {
  const updater = createFakeUpdater();
  const dialogModule = createFakeDialog([0]);
  const checker = createUpdateChecker({ updater, dialogModule, getWindow: () => null });

  checker.checkForUpdates();
  updater.emit('update-downloaded');
  await flush();

  assert.strictEqual(updater.quitAndInstallCalls, 0);
  checker.checkForUpdates();
  assert.strictEqual(updater.checkForUpdatesCalls, 2);
});

test('update-downloaded: choosing Restart calls quitAndInstall', async () => {
  const updater = createFakeUpdater();
  const dialogModule = createFakeDialog([1]);
  const checker = createUpdateChecker({ updater, dialogModule, getWindow: () => null });

  checker.checkForUpdates();
  updater.emit('update-downloaded');
  await flush();

  assert.strictEqual(updater.quitAndInstallCalls, 1);
});

test('error shows a dialog with the error message and clears the flag', async () => {
  const updater = createFakeUpdater();
  const dialogModule = createFakeDialog([]);
  const checker = createUpdateChecker({ updater, dialogModule, getWindow: () => null });

  checker.checkForUpdates();
  updater.emit('error', new Error('network down'));
  await flush();

  assert.match(dialogModule.calls[0].detail, /network down/);
  checker.checkForUpdates();
  assert.strictEqual(updater.checkForUpdatesCalls, 2);
});
