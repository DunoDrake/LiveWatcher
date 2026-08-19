'use strict';

const { execFile } = require('node:child_process');
const { parseLsof, parseCommandLines } = require('./darwin.js');
const {
  parseNetstat,
  parseTasklist,
  mergeWin32,
  parseWmicCommandLines,
  buildPidFilter
} = require('./win32.js');

const COMMAND_TIMEOUT_MS = 4000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: COMMAND_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true },
      (error, stdout) => {
        // lsof exits non-zero when some sockets are unreadable but still prints
        // the ones it could read, so partial output is preferred over failing.
        if (error && !stdout) reject(error);
        else resolve(stdout);
      }
    );
  });
}

async function listPorts({ platform = process.platform, run = runCommand } = {}) {
  if (platform === 'darwin') {
    const stdout = await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pcn']);
    return parseLsof(stdout);
  }

  if (platform === 'win32') {
    const [netstat, tasklist] = await Promise.all([
      run('netstat', ['-ano', '-p', 'TCP']),
      run('tasklist', ['/FO', 'CSV', '/NH'])
    ]);
    return mergeWin32(parseNetstat(netstat), parseTasklist(tasklist));
  }

  throw new Error(`Unsupported platform: ${platform}`);
}

// Best-effort context for the panel's row tooltip, kept separate from
// listPorts: lsof/netstat already found every port in one call, so this only
// needs to run once per unique pid, not once per port.
async function getCommandLines(pids, { platform = process.platform, run = runCommand } = {}) {
  const uniquePids = [...new Set(pids)].filter((pid) => Number.isInteger(pid));
  if (uniquePids.length === 0) return new Map();

  if (platform === 'darwin') {
    const stdout = await run('ps', ['-o', 'pid=,command=', '-p', uniquePids.join(',')]);
    return parseCommandLines(stdout);
  }

  if (platform === 'win32') {
    const stdout = await run('wmic', [
      'process',
      'where',
      buildPidFilter(uniquePids),
      'get',
      'CommandLine,ProcessId',
      '/VALUE'
    ]);
    return parseWmicCommandLines(stdout);
  }

  throw new Error(`Unsupported platform: ${platform}`);
}

module.exports = { listPorts, runCommand, getCommandLines };
