'use strict';

const DEV_RANGES = [
  [1337, 1337],
  [3000, 3999],
  [4000, 4999],
  [5000, 5999],
  [8000, 8999],
  [9000, 9999]
];

const DEV_PROCESSES = [
  'node', 'bun', 'deno', 'python', 'python3', 'ruby', 'java',
  'php', 'dotnet', 'go', 'nginx', 'caddy', 'docker', 'com.docker.backend'
];

// Daemons that must never be presented as dev servers even when they occupy a
// dev-range port. ControlCenter is the load-bearing case: stock macOS binds it
// to 5000 and 7000 for AirPlay Receiver.
const SYSTEM_PROCESSES = [
  'launchd', 'mdnsresponder', 'rapportd', 'controlcenter', 'sharingd',
  'airplayxpchelper', 'remoted', 'svchost', 'system', 'lsass', 'services', 'wininit'
];

function normalizeName(name) {
  return String(name).toLowerCase().replace(/\.exe$/, '');
}

function isDevPort(port, ranges = DEV_RANGES) {
  return ranges.some(([low, high]) => port >= low && port <= high);
}

function isDevProcess(name, list = DEV_PROCESSES) {
  const normalized = normalizeName(name);
  return list.some((candidate) => normalizeName(candidate) === normalized);
}

function isSystemProcess(name, list = SYSTEM_PROCESSES) {
  const normalized = normalizeName(name);
  return list.some((candidate) => normalizeName(candidate) === normalized);
}

function classify(entries, settings = {}) {
  const ranges = settings.devRanges ?? DEV_RANGES;
  const dev = [];
  const other = [];

  for (const entry of entries) {
    const system = isSystemProcess(entry.processName);
    const isDev = !system && (isDevPort(entry.port, ranges) || isDevProcess(entry.processName));
    (isDev ? dev : other).push({ ...entry, isDev });
  }

  const byPort = (a, b) => a.port - b.port;
  dev.sort(byPort);
  other.sort(byPort);

  return { dev, other };
}

module.exports = {
  classify,
  isDevPort,
  isDevProcess,
  isSystemProcess,
  normalizeName,
  DEV_RANGES,
  DEV_PROCESSES,
  SYSTEM_PROCESSES
};
