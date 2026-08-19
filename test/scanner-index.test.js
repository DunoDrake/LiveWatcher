'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { listPorts, getCommandLines } = require('../src/main/scanner/index.js');

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

test('getCommandLines runs ps once with a comma-joined pid list on darwin', async () => {
  const calls = [];
  const run = async (cmd, args) => {
    calls.push([cmd, args]);
    return read('ps-darwin.txt');
  };

  const map = await getCommandLines([6161, 591, 591], { platform: 'darwin', run });

  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0], ['ps', ['-o', 'pid=,command=', '-p', '6161,591']]);
  assert.strictEqual(map.get(6161).startsWith('/Users/hue/.agentmemory/bin/iii'), true);
});

test('getCommandLines runs wmic with a where clause built from the pids on win32', async () => {
  const calls = [];
  const run = async (cmd, args) => {
    calls.push([cmd, args]);
    return read('wmic-win32.txt');
  };

  const map = await getCommandLines([8823, 4120], { platform: 'win32', run });

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0][0], 'wmic');
  assert.ok(calls[0][1].includes('ProcessId=8823 or ProcessId=4120'));
  assert.strictEqual(map.get(4120), 'C:\\Program Files\\PostgreSQL\\16\\bin\\postgres.exe -D data');
});

test('getCommandLines skips the command entirely when there are no pids', async () => {
  let called = false;
  const run = async () => {
    called = true;
    return '';
  };

  const map = await getCommandLines([], { platform: 'darwin', run });

  assert.strictEqual(called, false);
  assert.strictEqual(map.size, 0);
});

test('getCommandLines rejects on an unsupported platform', async () => {
  await assert.rejects(
    () => getCommandLines([1], { platform: 'aix', run: async () => '' }),
    /Unsupported platform: aix/
  );
});
