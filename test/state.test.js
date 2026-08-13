'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { createTracker, snapshotFingerprint, formatUptime } = require('../src/main/state.js');

const entry = (port, pid = 100) => ({ port, pid, processName: 'node', kind: 'http', httpStatus: 200, title: null });

test('the first sighting of a port records its timestamp', () => {
  const tracker = createTracker();
  const [row] = tracker.update([entry(3000)], 1000);
  assert.strictEqual(row.firstSeenAt, 1000);
});

test('a port seen again keeps its original timestamp', () => {
  const tracker = createTracker();
  tracker.update([entry(3000)], 1000);
  const [row] = tracker.update([entry(3000)], 9000);
  assert.strictEqual(row.firstSeenAt, 1000);
});

test('a port that disappears and returns restarts its uptime', () => {
  const tracker = createTracker();
  tracker.update([entry(3000)], 1000);
  tracker.update([], 2000);
  const [row] = tracker.update([entry(3000)], 3000);
  assert.strictEqual(row.firstSeenAt, 3000);
});

test('the same port under a new pid restarts its uptime', () => {
  const tracker = createTracker();
  tracker.update([entry(3000, 100)], 1000);
  const [row] = tracker.update([entry(3000, 200)], 5000);
  assert.strictEqual(row.firstSeenAt, 5000);
});

test('the fingerprint is stable across reordering', () => {
  const a = snapshotFingerprint([entry(3000), entry(5173)]);
  const b = snapshotFingerprint([entry(5173), entry(3000)]);
  assert.strictEqual(a, b);
});

test('the fingerprint changes when a probe result changes', () => {
  const before = snapshotFingerprint([{ ...entry(3000), title: 'old' }]);
  const after = snapshotFingerprint([{ ...entry(3000), title: 'new' }]);
  assert.notStrictEqual(before, after);
});

test('formatUptime renders seconds, minutes, and hours', () => {
  assert.strictEqual(formatUptime(0), '0s');
  assert.strictEqual(formatUptime(45_000), '45s');
  assert.strictEqual(formatUptime(34 * 60_000), '34m');
  assert.strictEqual(formatUptime(2 * 3_600_000 + 14 * 60_000), '2h 14m');
});
