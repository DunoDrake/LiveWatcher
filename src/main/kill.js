'use strict';

const { execFile } = require('node:child_process');
const { isSystemProcess } = require('./classify.js');

const MIN_KILLABLE_PID = 500;
const SIGTERM_GRACE_MS = 3000;

function checkKillGuards({ pid, processName, ownerUid, currentUid }) {
  if (!Number.isInteger(pid) || pid < MIN_KILLABLE_PID) {
    return { allowed: false, reason: 'Refusing to stop a system process (PID below 500).' };
  }

  if (isSystemProcess(processName)) {
    return { allowed: false, reason: `${processName} is a protected system process.` };
  }

  // On Windows there is no getuid(), so both values arrive as null and the OS
  // enforces ownership by failing the kill with EPERM instead.
  if (ownerUid !== null && currentUid !== null && ownerUid !== currentUid) {
    return { allowed: false, reason: 'This process belongs to another user.' };
  }

  return { allowed: true, reason: null };
}

function getOwnerUid(pid) {
  if (process.platform === 'win32') return Promise.resolve(null);

  return new Promise((resolve) => {
    execFile('ps', ['-o', 'uid=', '-p', String(pid)], (error, stdout) => {
      if (error) return resolve(null);
      const uid = Number(String(stdout).trim());
      resolve(Number.isInteger(uid) ? uid : null);
    });
  });
}

// Reads the live command name for a PID, so a kill can confirm the process is
// still the one the user was shown. Resolves null when it cannot be determined.
function readProcessName(pid) {
  if (process.platform === 'win32') return Promise.resolve(null);

  return new Promise((resolve) => {
    execFile('ps', ['-o', 'comm=', '-p', String(pid)], { timeout: 3000 }, (error, stdout) => {
      if (error) return resolve(null);
      const name = String(stdout).trim();
      resolve(name.length > 0 ? name.split('/').pop() : null);
    });
  });
}

// The panel's row can be up to a poll interval old, and the confirmation dialog
// can sit open indefinitely. If the PID were recycled in that window, the guards
// would happily approve a kill against an unrelated process the user now owns.
function processIdentityMatches(expectedName, liveName) {
  if (liveName === null) return true;

  const normalize = (value) => String(value).toLowerCase().replace(/\.exe$/, '');
  const expected = normalize(expectedName);
  const live = normalize(liveName);

  return expected === live || expected.startsWith(live) || live.startsWith(expected);
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function terminate({ pid, force = false }) {
  try {
    process.kill(pid, force ? 'SIGKILL' : 'SIGTERM');
  } catch (error) {
    return { ok: false, stillAlive: isAlive(pid), reason: error.message };
  }

  if (force) return { ok: true, stillAlive: false, reason: null };

  await wait(SIGTERM_GRACE_MS);
  return { ok: true, stillAlive: isAlive(pid), reason: null };
}

module.exports = {
  checkKillGuards,
  getOwnerUid,
  readProcessName,
  processIdentityMatches,
  terminate,
  isAlive,
  MIN_KILLABLE_PID
};
