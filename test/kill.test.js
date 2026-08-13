'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { checkKillGuards } = require('../src/main/kill.js');

const base = { pid: 8823, processName: 'node', ownerUid: 503, currentUid: 503 };

test('a user-owned dev process passes the guards', () => {
  const result = checkKillGuards(base);
  assert.strictEqual(result.allowed, true);
  assert.strictEqual(result.reason, null);
});

test('a low pid is refused as a system process', () => {
  const result = checkKillGuards({ ...base, pid: 488 });
  assert.strictEqual(result.allowed, false);
  assert.match(result.reason, /system process/i);
});

test('a denylisted process is refused even with a high pid', () => {
  const result = checkKillGuards({ ...base, pid: 9000, processName: 'ControlCenter' });
  assert.strictEqual(result.allowed, false);
  assert.match(result.reason, /protected/i);
});

test('a process owned by another user is refused', () => {
  const result = checkKillGuards({ ...base, ownerUid: 0 });
  assert.strictEqual(result.allowed, false);
  assert.match(result.reason, /another user/i);
});

test('an unknown owner is allowed through so Windows can rely on EPERM', () => {
  const result = checkKillGuards({ ...base, ownerUid: null, currentUid: null });
  assert.strictEqual(result.allowed, true);
});

test('a non-integer pid is refused', () => {
  const result = checkKillGuards({ ...base, pid: Number.NaN });
  assert.strictEqual(result.allowed, false);
});
