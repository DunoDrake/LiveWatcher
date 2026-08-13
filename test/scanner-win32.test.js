'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { parseNetstat, parseTasklist, mergeWin32 } = require('../src/main/scanner/win32.js');

const read = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const NETSTAT = read('netstat-win32.txt');
const TASKLIST = read('tasklist-win32.csv');

test('parseNetstat keeps only listening TCP rows', () => {
  const rows = parseNetstat(NETSTAT);
  assert.strictEqual(rows.length, 6);
  assert.ok(!rows.some((r) => r.port === 52100), 'established connection must be excluded');
});

test('parseNetstat unwraps bracketed IPv6 hosts', () => {
  const rows = parseNetstat(NETSTAT);
  const ipv6 = rows.find((r) => r.address === '::');
  assert.strictEqual(ipv6.port, 3000);
  assert.strictEqual(ipv6.pid, 8823);
});

test('parseTasklist maps pid to process name', () => {
  const map = parseTasklist(TASKLIST);
  assert.strictEqual(map.get(8823), 'node.exe');
  assert.strictEqual(map.get(4120), 'postgres.exe');
  assert.strictEqual(map.size, 6);
});

test('mergeWin32 joins names onto ports and collapses IPv4/IPv6 duplicates', () => {
  const rows = mergeWin32(parseNetstat(NETSTAT), parseTasklist(TASKLIST));
  const onPort3000 = rows.filter((r) => r.port === 3000);
  assert.strictEqual(onPort3000.length, 1);
  assert.strictEqual(onPort3000[0].processName, 'node.exe');
  assert.strictEqual(onPort3000[0].pid, 8823);
});

test('mergeWin32 falls back to "unknown" when tasklist has no entry', () => {
  const rows = mergeWin32([{ port: 9999, pid: 31337, address: '0.0.0.0' }], new Map());
  assert.strictEqual(rows[0].processName, 'unknown');
});

test('parseNetstat returns an empty array for empty input', () => {
  assert.deepStrictEqual(parseNetstat(''), []);
});
