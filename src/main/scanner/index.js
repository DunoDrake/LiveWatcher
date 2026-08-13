'use strict';

const { execFile } = require('node:child_process');
const { parseLsof } = require('./darwin.js');
const { parseNetstat, parseTasklist, mergeWin32 } = require('./win32.js');

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

module.exports = { listPorts, runCommand };
