'use strict';

const path = require('node:path');
const { app } = require('electron');

const { createTray } = require('./tray.js');
const { registerIpc } = require('./ipc.js');
const { createStore } = require('./store.js');
const { listPorts, getCommandLines } = require('./scanner/index.js');
const { probeAll } = require('./probe.js');
const { classify } = require('./classify.js');
const { createTracker, snapshotFingerprint } = require('./state.js');
const { createUpdateChecker } = require('./updater.js');

let panel = null;
let store = null;
let timer = null;
let panelVisible = false;
let scanning = false;
let lastFingerprint = null;
let lastPayload = { dev: [], other: [], error: null };

const tracker = createTracker();

async function collect() {
  const raw = await listPorts();

  let commandLines = new Map();
  try {
    commandLines = await getCommandLines(raw.map((row) => row.pid));
  } catch {
    // Command-line lookup is best-effort tooltip context; losing it must not
    // blank the whole scan.
  }

  const probes = await probeAll(raw.map((row) => row.port), {
    timeoutMs: store.get('probeTimeoutMs')
  });

  const enriched = raw.map((row) => ({
    ...row,
    commandLine: commandLines.get(row.pid) ?? null,
    ...probes.get(row.port)
  }));
  const tracked = tracker.update(enriched);

  return classify(tracked, { devRanges: store.get('devRanges') });
}

async function refreshNow() {
  // A scan can outlast its own interval: lsof may take seconds and each wave of
  // probes adds up to the probe timeout. Overlapping runs finish out of order,
  // and the older one then deletes the newer one's firstSeen entries, making
  // rows vanish and their uptime restart.
  if (scanning) return;
  scanning = true;

  let payload;

  try {
    const { dev, other } = await collect();
    payload = { dev, other, error: null };
  } catch (error) {
    // Keep the previous list on screen rather than blanking it; a failed scan is
    // far more likely to be a transient lsof hiccup than every server vanishing.
    payload = { ...lastPayload, error: `Scan failed: ${error.message}` };
  } finally {
    // Safe to clear here: nothing below awaits, so no other run can interleave.
    scanning = false;
  }

  const fingerprint = snapshotFingerprint([...payload.dev, ...payload.other]) + String(payload.error);
  if (fingerprint === lastFingerprint) return;

  lastFingerprint = fingerprint;
  lastPayload = payload;

  if (panel && !panel.isDestroyed()) {
    panel.webContents.send('snapshot', {
      ...payload,
      settings: store.all(),
      version: app.getVersion(),
      now: Date.now()
    });
  }
}

function rescheduleTimer() {
  if (timer) clearInterval(timer);
  const interval = panelVisible
    ? store.get('pollIntervalOpenMs')
    : store.get('pollIntervalClosedMs');
  timer = setInterval(refreshNow, interval);
}

if (process.platform === 'darwin' && app.dock) app.dock.hide();

app.whenReady().then(() => {
  store = createStore({ filePath: path.join(app.getPath('userData'), 'settings.json') });

  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: store.get('openAtLogin'), openAsHidden: true });
  }

  const updateChecker = createUpdateChecker();

  const handle = createTray({
    onVisibilityChange: (visible) => {
      panelVisible = visible;
      rescheduleTimer();
      if (visible) refreshNow();
    },
    onCheckForUpdates: () => updateChecker.checkForUpdates()
  });
  panel = handle.panel;

  registerIpc({ panel, store, refreshNow, setSuppressHide: handle.setSuppressHide });

  panel.webContents.on('did-finish-load', refreshNow);
  rescheduleTimer();
  refreshNow();
});

app.on('window-all-closed', (event) => event.preventDefault());

// tray.js's panel keeps itself alive by preventing its own 'close' (so Cmd+W
// just hides it) -- but that same handler would also block a real app.quit()
// from ever completing, since Electron won't quit until its windows actually
// close. before-quit fires first, so flagging it here lets that handler tell
// the two cases apart.
app.on('before-quit', () => {
  app.isQuitting = true;
});
