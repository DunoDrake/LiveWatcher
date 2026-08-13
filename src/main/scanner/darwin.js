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

module.exports = { parseLsof, parseAddress };
