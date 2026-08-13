'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  checkKillGuards,
  processIdentityMatches,
  readProcessName,
  isAlive
} = require('../src/main/kill.js');

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

test('identity matches when the live name equals the shown name', () => {
  assert.ok(processIdentityMatches('node', 'node'));
  assert.ok(processIdentityMatches('node.exe', 'node'));
  assert.ok(processIdentityMatches('Python', 'python'));
});

test('identity matches when one name is a truncation of the other', () => {
  // lsof and ps report the same process under different lengths.
  assert.ok(processIdentityMatches('Discord Helper (Renderer)', 'Discord Helper'));
});

test('identity does NOT match a recycled pid running something else', () => {
  assert.ok(!processIdentityMatches('node', 'postgres'));
  assert.ok(!processIdentityMatches('node', 'zsh'));
});

test('identity is assumed intact when the live name cannot be read', () => {
  // Windows has no ps; the OS enforces ownership by failing the kill instead.
  assert.ok(processIdentityMatches('node', null));
});

test('readProcessName returns the real command name for a live pid', async () => {
  const name = await readProcessName(process.pid);
  assert.strictEqual(typeof name, 'string');
  assert.match(name, /node/i);
});

test('readProcessName returns null for a pid that does not exist', async () => {
  let free = 999_999;
  while (isAlive(free)) free -= 1;

  assert.strictEqual(await readProcessName(free), null);
});
