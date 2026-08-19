'use strict';

// lsof field-mode output is a flat stream of tagged lines:
//   p<pid>  starts a process record
//   c<name> the command name for that process
//   f<fd>   starts a file record
//   n<addr> the address bound by that file
function parseAddress(raw) {
  const idx = raw.lastIndexOf(':');
  if (idx === -1) return null;

  const port = Number(raw.slice(idx + 1));
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;

  let host = raw.slice(0, idx);
  if (host === '*') host = '0.0.0.0';
  else if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (host === '') return null;

  return { host, port };
}

function parseLsof(stdout) {
  const rows = [];
  const seen = new Set();
  let pid = null;
  let processName = 'unknown';

  for (const line of String(stdout).split('\n')) {
    if (line.length === 0) continue;
    const tag = line[0];
    const value = line.slice(1);

    if (tag === 'p') {
      pid = Number(value);
      processName = 'unknown';
      continue;
    }
    if (tag === 'c') {
      processName = value;
      continue;
    }
    if (tag !== 'n' || !Number.isInteger(pid)) continue;

    const address = parseAddress(value);
    if (!address) continue;

    const key = `${pid}:${address.port}`;
    if (seen.has(key)) continue;
    seen.add(key);

    rows.push({ port: address.port, pid, processName, address: address.host });
  }

  return rows;
}

// `ps -o pid=,command=` prints one line per pid: right-padded pid, one space,
// then the full command including args. Unlike lsof's 'c' field (truncated
// comm name), this carries the whole invocation so two ports served by the
// same binary can still be told apart by their arguments.
function parseCommandLines(stdout) {
  const map = new Map();

  for (const line of String(stdout).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const spaceIdx = trimmed.indexOf(' ');
    if (spaceIdx === -1) continue;

    const pid = Number(trimmed.slice(0, spaceIdx));
    if (!Number.isInteger(pid)) continue;

    const command = trimmed.slice(spaceIdx + 1).trim();
    if (command) map.set(pid, command);
  }

  return map;
}

module.exports = { parseLsof, parseAddress, parseCommandLines };
