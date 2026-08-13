'use strict';

const keyOf = (entry) => `${entry.pid}:${entry.port}`;

function createTracker() {
  const firstSeen = new Map();

  return {
    update(entries, now = Date.now()) {
      const live = new Set();

      const rows = entries.map((entry) => {
        const key = keyOf(entry);
        live.add(key);
        if (!firstSeen.has(key)) firstSeen.set(key, now);
        return { ...entry, firstSeenAt: firstSeen.get(key) };
      });

      for (const key of firstSeen.keys()) {
        if (!live.has(key)) firstSeen.delete(key);
      }

      return rows;
    }
  };
}

function snapshotFingerprint(entries) {
  // Delimited on purpose: joining with '' lets adjacent fields blur into each
  // other, so a real change could hash to the previous value and be swallowed.
  return entries
    .map((e) => [e.pid, e.port, e.kind, e.httpStatus, e.title, e.processName].join('|'))
    .sort()
    .join('\n');
}

function formatUptime(elapsedMs) {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${totalSeconds}s`;
}

module.exports = { createTracker, snapshotFingerprint, formatUptime };
