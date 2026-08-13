'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { listPorts } = require('../src/main/scanner/index.js');

const read = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

test('listPorts parses lsof output on darwin', async () => {
  const calls = [];
  const run = async (cmd, args) => {
    calls.push(cmd);
    return read('lsof-darwin.txt');
  };

  const rows = await listPorts({ platform: 'darwin', run });

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0], 'lsof');
  assert.strictEqual(rows.length, 16);
});

test('listPorts runs both Windows commands and merges them', async () => {
  const calls = [];
  const run = async (cmd) => {
    calls.push(cmd);
    return cmd === 'netstat' ? read('netstat-win32.txt') : read('tasklist-win32.csv');
  };

  const rows = await listPorts({ platform: 'win32', run });

  assert.deepStrictEqual(calls.sort(), ['netstat', 'tasklist']);
  assert.strictEqual(rows.find((r) => r.port === 3000).processName, 'node.exe');
});

test('listPorts rejects on an unsupported platform', async () => {
  await assert.rejects(
    () => listPorts({ platform: 'aix', run: async () => '' }),
    /Unsupported platform: aix/
  );
});

test('listPorts propagates a failing command so the caller can keep the old snapshot', async () => {
  const run = async () => {
    throw new Error('spawn lsof ENOENT');
  };

  await assert.rejects(() => listPorts({ platform: 'darwin', run }), /ENOENT/);
});
