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

test('a wrongly typed devRanges is rejected in favour of the default', () => {
  // Hand-editing this file is the documented way to change dev ranges, so a
  // typo here must not be able to make every later scan throw.
  const filePath = tempFile();
  fs.writeFileSync(filePath, JSON.stringify({ devRanges: 5 }));

  assert.deepStrictEqual(createStore({ filePath }).get('devRanges'), DEFAULT_SETTINGS.devRanges);
});

test('a malformed range pair is rejected', () => {
  const filePath = tempFile();
  fs.writeFileSync(filePath, JSON.stringify({ devRanges: [[3000]] }));

  assert.deepStrictEqual(createStore({ filePath }).get('devRanges'), DEFAULT_SETTINGS.devRanges);
});

test('a well formed custom range is accepted', () => {
  const filePath = tempFile();
  fs.writeFileSync(filePath, JSON.stringify({ devRanges: [[4000, 4100]] }));

  assert.deepStrictEqual(createStore({ filePath }).get('devRanges'), [[4000, 4100]]);
});

test('a zero poll interval is rejected so the loop cannot busy-spin', () => {
  const filePath = tempFile();
  fs.writeFileSync(filePath, JSON.stringify({ pollIntervalOpenMs: 0 }));

  assert.strictEqual(
    createStore({ filePath }).get('pollIntervalOpenMs'),
    DEFAULT_SETTINGS.pollIntervalOpenMs
  );
});

test('set refuses an unknown key and reports it', () => {
  const store = createStore({ filePath: tempFile() });

  assert.strictEqual(store.set('somethingElse', 1), false);
  assert.strictEqual(store.get('somethingElse'), undefined);
});

test('set refuses a valid key with an invalid value', () => {
  const store = createStore({ filePath: tempFile() });

  assert.strictEqual(store.set('openAtLogin', 'yes please'), false);
  assert.strictEqual(store.get('openAtLogin'), DEFAULT_SETTINGS.openAtLogin);
});

test('set accepts a valid change and reports success', () => {
  const store = createStore({ filePath: tempFile() });

  assert.strictEqual(store.set('openAtLogin', false), true);
  assert.strictEqual(store.get('openAtLogin'), false);
});
