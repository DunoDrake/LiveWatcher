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

module.exports = { checkKillGuards, getOwnerUid, terminate, isAlive, MIN_KILLABLE_PID };
