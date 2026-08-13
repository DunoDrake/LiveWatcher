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

const MIN_POLL_MS = 1000;

const isPositiveInt = (value, min) => Number.isInteger(value) && value >= min;

const isRangeList = (value) =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every(
    (pair) =>
      Array.isArray(pair) &&
      pair.length === 2 &&
      pair.every((port) => Number.isInteger(port) && port > 0 && port <= 65535) &&
      pair[0] <= pair[1]
  );

// Hand-editing settings.json is the documented way to change most of these, so a
// typo must not be able to brick the app. Anything that fails its check is
// dropped and the default stands in.
const VALIDATORS = {
  devRanges: isRangeList,
  openAtLogin: (value) => typeof value === 'boolean',
  pollIntervalOpenMs: (value) => isPositiveInt(value, MIN_POLL_MS),
  pollIntervalClosedMs: (value) => isPositiveInt(value, MIN_POLL_MS),
  probeTimeoutMs: (value) => isPositiveInt(value, 100),
  showOtherPorts: (value) => typeof value === 'boolean'
};

function createStore({ filePath }) {
  let settings = { ...DEFAULT_SETTINGS };

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (raw[key] !== undefined && VALIDATORS[key](raw[key])) settings[key] = raw[key];
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
    // Rejects unknown keys and bad values rather than persisting whatever the
    // renderer sends, so a compromised or buggy renderer cannot poison startup.
    set(key, value) {
      if (!Object.prototype.hasOwnProperty.call(VALIDATORS, key)) return false;
      if (!VALIDATORS[key](value)) return false;

      settings[key] = value;
      persist();
      return true;
    }
  };
}

module.exports = { createStore, DEFAULT_SETTINGS };
