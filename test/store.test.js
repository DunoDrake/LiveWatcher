'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createStore, DEFAULT_SETTINGS } = require('../src/main/store.js');

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'livewatcher-'));
  return path.join(dir, 'settings.json');
}

test('a fresh store returns the defaults', () => {
  const store = createStore({ filePath: tempFile() });
  assert.strictEqual(store.get('pollIntervalOpenMs'), DEFAULT_SETTINGS.pollIntervalOpenMs);
});

test('set persists a value that a new store instance reads back', () => {
  const filePath = tempFile();
  createStore({ filePath }).set('openAtLogin', false);

  assert.strictEqual(createStore({ filePath }).get('openAtLogin'), false);
});

test('unknown keys in the file do not clobber known defaults', () => {
  const filePath = tempFile();
  fs.writeFileSync(filePath, JSON.stringify({ somethingRemoved: 1 }));

  const store = createStore({ filePath });
  assert.strictEqual(store.get('probeTimeoutMs'), DEFAULT_SETTINGS.probeTimeoutMs);
});

test('a corrupted settings file falls back to defaults instead of throwing', () => {
  const filePath = tempFile();
  fs.writeFileSync(filePath, '{ this is not json');

  const store = createStore({ filePath });
  assert.deepStrictEqual(store.all(), DEFAULT_SETTINGS);
});
