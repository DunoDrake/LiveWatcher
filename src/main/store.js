'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DEV_RANGES } = require('./classify.js');

const DEFAULT_SETTINGS = {
  devRanges: DEV_RANGES,
  openAtLogin: true,
  pollIntervalOpenMs: 5000,
  pollIntervalClosedMs: 15000,
  probeTimeoutMs: 1500,
  showOtherPorts: false
};

function createStore({ filePath }) {
  let settings = { ...DEFAULT_SETTINGS };

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (raw[key] !== undefined) settings[key] = raw[key];
    }
  } catch {
    // Missing or corrupted file: the defaults above already stand in.
  }

  function persist() {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(settings, null, 2));
    fs.renameSync(temporary, filePath);
  }

  return {
    get: (key) => settings[key],
    all: () => ({ ...settings }),
    set(key, value) {
      settings[key] = value;
      persist();
    }
  };
}

module.exports = { createStore, DEFAULT_SETTINGS };
