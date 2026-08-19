'use strict';

function splitHostPort(raw) {
  const idx = raw.lastIndexOf(':');
  if (idx === -1) return null;

  const port = Number(raw.slice(idx + 1));
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;

  let host = raw.slice(0, idx);
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (host === '') return null;

  return { host, port };
}

const NULL_ENDPOINTS = new Set(['0.0.0.0:0', '[::]:0', '*:*']);

function parseNetstat(stdout) {
  const rows = [];

  for (const line of String(stdout).split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length !== 5) continue;
    if (parts[0].toUpperCase() !== 'TCP') continue;

    const [, local, foreign, state, pidRaw] = parts;
    const listening = state.toUpperCase() === 'LISTENING' || NULL_ENDPOINTS.has(foreign);
    if (!listening) continue;

    const pid = Number(pidRaw);
    if (!Number.isInteger(pid)) continue;

    const address = splitHostPort(local);
    if (!address) continue;

    rows.push({ port: address.port, pid, address: address.host });
  }

  return rows;
}

function parseTasklist(stdout) {
  const map = new Map();

  for (const line of String(stdout).split('\n')) {
    const fields = line.trim().match(/"([^"]*)"/g);
    if (!fields || fields.length < 2) continue;

    const name = fields[0].slice(1, -1);
    const pid = Number(fields[1].slice(1, -1));
    if (!Number.isInteger(pid)) continue;

    map.set(pid, name);
  }

  return map;
}

function mergeWin32(netstatRows, pidMap) {
  const rows = [];
  const seen = new Set();

  for (const row of netstatRows) {
    const key = `${row.pid}:${row.port}`;
    if (seen.has(key)) continue;
    seen.add(key);

    rows.push({
      port: row.port,
      pid: row.pid,
      processName: pidMap.get(row.pid) ?? 'unknown',
      address: row.address
    });
  }

  return rows;
}

// `wmic ... get CommandLine,ProcessId /VALUE` prints one KEY=VALUE line per
// field, blocks separated by blank lines. That format sidesteps the ambiguity
// CSV would have with commas inside a real command line (paths, args).
function parseWmicCommandLines(stdout) {
  const map = new Map();
  const blocks = String(stdout).replace(/\r\n/g, '\n').split(/\n\s*\n/);

  for (const block of blocks) {
    let pid = null;
    let commandLine = null;

    for (const line of block.split('\n')) {
      const idx = line.indexOf('=');
      if (idx === -1) continue;

      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();

      if (key === 'ProcessId') pid = Number(value);
      else if (key === 'CommandLine') commandLine = value;
    }

    if (Number.isInteger(pid) && commandLine) map.set(pid, commandLine);
  }

  return map;
}

function buildPidFilter(pids) {
  return pids.map((pid) => `ProcessId=${pid}`).join(' or ');
}

module.exports = {
  parseNetstat,
  parseTasklist,
  mergeWin32,
  splitHostPort,
  parseWmicCommandLines,
  buildPidFilter
};
