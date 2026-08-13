'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  classify,
  isDevPort,
  isDevProcess,
  isSystemProcess,
  normalizeName,
  DEV_RANGES
} = require('../src/main/classify.js');

const entry = (port, processName, pid = 1000) => ({ port, processName, pid, address: '127.0.0.1' });

test('normalizeName lowercases and strips the Windows .exe suffix', () => {
  assert.strictEqual(normalizeName('Node.EXE'), 'node');
  assert.strictEqual(normalizeName('python3'), 'python3');
});

test('isDevPort covers the configured ranges and rejects outside them', () => {
  assert.ok(isDevPort(3000, DEV_RANGES));
  assert.ok(isDevPort(1337, DEV_RANGES));
  assert.ok(isDevPort(8080, DEV_RANGES));
  assert.ok(!isDevPort(64020, DEV_RANGES));
  assert.ok(!isDevPort(22, DEV_RANGES));
});

test('isDevProcess matches regardless of case or .exe suffix', () => {
  assert.ok(isDevProcess('node'));
  assert.ok(isDevProcess('node.exe'));
  assert.ok(!isDevProcess('CocosCreator'));
});

test('isSystemProcess matches known macOS and Windows daemons', () => {
  assert.ok(isSystemProcess('ControlCenter'));
  assert.ok(isSystemProcess('mDNSResponder'));
  assert.ok(isSystemProcess('svchost.exe'));
  assert.ok(!isSystemProcess('node'));
});

test('a dev-range port classifies as dev', () => {
  const { dev } = classify([entry(3000, 'node')]);
  assert.strictEqual(dev.length, 1);
  assert.strictEqual(dev[0].isDev, true);
});

test('a dev process on an unusual port still classifies as dev', () => {
  const { dev } = classify([entry(49134, 'node')]);
  assert.strictEqual(dev.length, 1);
  assert.strictEqual(dev[0].port, 49134);
});

test('neither rule matching puts the port in other', () => {
  const { dev, other } = classify([entry(64020, 'CocosCreator')]);
  assert.strictEqual(dev.length, 0);
  assert.strictEqual(other.length, 1);
});

test('a system process on a dev-range port is forced to other', () => {
  // Real macOS behaviour: ControlCenter (AirPlay Receiver) binds port 5000,
  // which sits inside the 5000-5999 dev range.
  const { dev, other } = classify([entry(5000, 'ControlCenter', 521)]);
  assert.strictEqual(dev.length, 0);
  assert.strictEqual(other[0].port, 5000);
});

test('classify sorts each group by port ascending', () => {
  const { dev } = classify([entry(8080, 'java'), entry(3000, 'node'), entry(5173, 'node')]);
  assert.deepStrictEqual(dev.map((e) => e.port), [3000, 5173, 8080]);
});

test('classify honours custom ranges from settings', () => {
  const { dev, other } = classify([entry(3000, 'CocosCreator')], { devRanges: [[7000, 7999]] });
  assert.strictEqual(dev.length, 0);
  assert.strictEqual(other.length, 1);
});
