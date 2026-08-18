# LiveWatcher hot-update implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user trigger a self-update from the tray menu: check GitHub Releases for a newer version, download it, and install it on restart, with a confirmation dialog at each step.

**Architecture:** A new `src/main/updater.js` module wraps `electron-updater`'s `autoUpdater` behind a dependency-injected wiring function (`createUpdateChecker`), so the event-handling logic is unit-testable under plain `node --test` without booting Electron — the same testable/wiring split the codebase already uses for `kill.js` (pure logic) vs `ipc.js` (Electron wiring). `tray.js` gains a native right-click context menu with one "Check for Updates..." item; `index.js` wires the two together. All user-facing prompts use `dialog.showMessageBox`; no renderer/preload changes.

**Tech Stack:** Electron 38, `electron-updater` (new dependency), `node:test` + `node:assert` (existing test stack), `electron-builder` (existing, gains a `publish` config).

**Reference spec:** `docs/superpowers/specs/2026-08-18-livewatcher-hotupdate-design.md`

---

### Task 1: Add `electron-updater` dependency and GitHub publish config

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the dependency**

Run: `npm install electron-updater --save`

Expected: `package.json` gains a new `"dependencies"` block (it doesn't exist yet) containing `"electron-updater": "^<resolved version>"`.

- [ ] **Step 2: Verify the install**

Run: `git diff package.json`
Expected: a new `"dependencies": { "electron-updater": "^X.Y.Z" }` block appears. No other lines change yet.

- [ ] **Step 3: Add the GitHub publish config**

In `package.json`, inside the `"build"` object, add a `"publish"` key right after `"productName"` (currently `package.json:16-19`):

```json
  "build": {
    "appId": "com.hue.livewatcher",
    "productName": "LiveWatcher",
    "publish": { "provider": "github", "owner": "DunoDrake", "repo": "LiveWatcher" },
    "files": ["src/**/*", "assets/**/*", "package.json"],
```

- [ ] **Step 4: Verify the file is valid JSON**

Run: `node -e "console.log(require('./package.json').build.publish)"`
Expected: `{ provider: 'github', owner: 'DunoDrake', repo: 'LiveWatcher' }`

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "[Chore] add electron-updater dependency and GitHub publish config"
```

---

### Task 2: Write `src/main/updater.js` with tests (TDD)

**Files:**
- Create: `src/main/updater.js`
- Test: `test/updater.test.js`

The wiring function `createUpdateChecker` takes the `autoUpdater`-shaped object, the `dialog`-shaped object, and a `getWindow` accessor as dependencies, all overridable so tests never touch real Electron or real `electron-updater`. Production code omits the overrides and gets the real modules via lazy default parameters (evaluated only when the argument is omitted, so `require('electron-updater')` never runs under `node --test`).

- [ ] **Step 1: Write the failing tests**

Create `test/updater.test.js`:

```javascript
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');

const { createUpdateChecker } = require('../src/main/updater.js');

function createFakeUpdater() {
  const updater = new EventEmitter();
  updater.checkForUpdatesCalls = 0;
  updater.downloadUpdateCalls = 0;
  updater.quitAndInstallCalls = 0;
  updater.checkForUpdates = () => { updater.checkForUpdatesCalls += 1; };
  updater.downloadUpdate = () => { updater.downloadUpdateCalls += 1; };
  updater.quitAndInstall = () => { updater.quitAndInstallCalls += 1; };
  return updater;
}

function createFakeDialog(responses) {
  const calls = [];
  const queue = [...responses];
  return {
    calls,
    showMessageBox: async (_window, options) => {
      calls.push(options);
      return { response: queue.shift() };
    }
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('checkForUpdates calls through to the real updater', () => {
  const updater = createFakeUpdater();
  const dialogModule = createFakeDialog([]);
  const checker = createUpdateChecker({ updater, dialogModule, getWindow: () => null });

  checker.checkForUpdates();

  assert.strictEqual(updater.checkForUpdatesCalls, 1);
});

test('a second call while one is in flight is ignored', () => {
  const updater = createFakeUpdater();
  const dialogModule = createFakeDialog([]);
  const checker = createUpdateChecker({ updater, dialogModule, getWindow: () => null });

  checker.checkForUpdates();
  checker.checkForUpdates();

  assert.strictEqual(updater.checkForUpdatesCalls, 1);
});

test('update-not-available shows an up-to-date dialog and clears the in-flight flag', async () => {
  const updater = createFakeUpdater();
  const dialogModule = createFakeDialog([]);
  const checker = createUpdateChecker({
    updater,
    dialogModule,
    getWindow: () => null,
    getCurrentVersion: () => '1.2.3'
  });

  checker.checkForUpdates();
  updater.emit('update-not-available');
  await flush();

  assert.match(dialogModule.calls[0].message, /up to date/i);
  assert.match(dialogModule.calls[0].message, /1\.2\.3/);

  checker.checkForUpdates();
  assert.strictEqual(updater.checkForUpdatesCalls, 2);
});

test('update-available: choosing Cancel does not download, and clears the flag', async () => {
  const updater = createFakeUpdater();
  const dialogModule = createFakeDialog([0]);
  const checker = createUpdateChecker({ updater, dialogModule, getWindow: () => null });

  checker.checkForUpdates();
  updater.emit('update-available', { version: '9.9.9' });
  await flush();

  assert.strictEqual(updater.downloadUpdateCalls, 0);
  checker.checkForUpdates();
  assert.strictEqual(updater.checkForUpdatesCalls, 2);
});

test('update-available: choosing Download calls downloadUpdate', async () => {
  const updater = createFakeUpdater();
  const dialogModule = createFakeDialog([1]);
  const checker = createUpdateChecker({ updater, dialogModule, getWindow: () => null });

  checker.checkForUpdates();
  updater.emit('update-available', { version: '9.9.9' });
  await flush();

  assert.match(dialogModule.calls[0].message, /9\.9\.9/);
  assert.strictEqual(updater.downloadUpdateCalls, 1);
});

test('update-downloaded: choosing Later does not install, and clears the flag', async () => {
  const updater = createFakeUpdater();
  const dialogModule = createFakeDialog([0]);
  const checker = createUpdateChecker({ updater, dialogModule, getWindow: () => null });

  checker.checkForUpdates();
  updater.emit('update-downloaded');
  await flush();

  assert.strictEqual(updater.quitAndInstallCalls, 0);
  checker.checkForUpdates();
  assert.strictEqual(updater.checkForUpdatesCalls, 2);
});

test('update-downloaded: choosing Restart calls quitAndInstall', async () => {
  const updater = createFakeUpdater();
  const dialogModule = createFakeDialog([1]);
  const checker = createUpdateChecker({ updater, dialogModule, getWindow: () => null });

  checker.checkForUpdates();
  updater.emit('update-downloaded');
  await flush();

  assert.strictEqual(updater.quitAndInstallCalls, 1);
});

test('error shows a dialog with the error message and clears the flag', async () => {
  const updater = createFakeUpdater();
  const dialogModule = createFakeDialog([]);
  const checker = createUpdateChecker({ updater, dialogModule, getWindow: () => null });

  checker.checkForUpdates();
  updater.emit('error', new Error('network down'));
  await flush();

  assert.match(dialogModule.calls[0].detail, /network down/);
  checker.checkForUpdates();
  assert.strictEqual(updater.checkForUpdatesCalls, 2);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/updater.test.js`
Expected: `FAIL` — `Cannot find module '../src/main/updater.js'` (the module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/main/updater.js`:

```javascript
'use strict';

function createUpdateChecker({
  updater = require('electron-updater').autoUpdater,
  dialogModule = require('electron').dialog,
  getWindow,
  getCurrentVersion = () => require('electron').app.getVersion()
} = {}) {
  let checking = false;

  updater.on('update-not-available', () => {
    dialogModule.showMessageBox(getWindow(), {
      type: 'info',
      buttons: ['OK'],
      message: `You're up to date (v${getCurrentVersion()}).`
    });
    checking = false;
  });

  updater.on('update-available', async (info) => {
    const result = await dialogModule.showMessageBox(getWindow(), {
      type: 'info',
      buttons: ['Cancel', 'Download'],
      defaultId: 1,
      cancelId: 0,
      message: `Version ${info.version} is available. Download now?`
    });

    if (result.response === 1) {
      updater.downloadUpdate();
    } else {
      checking = false;
    }
  });

  updater.on('update-downloaded', async () => {
    const result = await dialogModule.showMessageBox(getWindow(), {
      type: 'info',
      buttons: ['Later', 'Restart'],
      defaultId: 1,
      cancelId: 0,
      message: 'Update downloaded. Restart now to install?'
    });

    checking = false;
    if (result.response === 1) {
      updater.quitAndInstall();
    }
  });

  updater.on('error', (error) => {
    dialogModule.showMessageBox(getWindow(), {
      type: 'error',
      buttons: ['OK'],
      message: 'Update check failed.',
      detail: error && error.message ? error.message : String(error)
    });
    checking = false;
  });

  function checkForUpdates() {
    if (checking) return;
    checking = true;
    updater.checkForUpdates();
  }

  return { checkForUpdates };
}

module.exports = { createUpdateChecker };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/updater.test.js`
Expected: all 8 tests `PASS`.

- [ ] **Step 5: Run the full suite to check for regressions**

Run: `npm test`
Expected: all tests pass, including the new `updater.test.js` file.

- [ ] **Step 6: Commit**

```bash
git add src/main/updater.js test/updater.test.js
git commit -m "[Add] wire electron-updater with a testable dialog-driven update flow"
```

---

### Task 3: Add a "Check for Updates..." tray context menu

**Files:**
- Modify: `src/main/tray.js`

Right-click on the tray icon currently calls the same `toggle()` as left-click (`src/main/tray.js:88-89`). This task splits that: left-click keeps opening the custom panel; right-click now shows a native context menu with the one new item.

- [ ] **Step 1: Import `Menu` and accept the new callback**

In `src/main/tray.js:4`, change:

```javascript
const { Tray, BrowserWindow, nativeImage, screen } = require('electron');
```

to:

```javascript
const { Tray, BrowserWindow, nativeImage, screen, Menu } = require('electron');
```

In `src/main/tray.js:60`, change:

```javascript
function createTray({ onVisibilityChange }) {
```

to:

```javascript
function createTray({ onVisibilityChange, onCheckForUpdates }) {
```

- [ ] **Step 2: Build and show the context menu on right-click**

In `src/main/tray.js:88-89`, change:

```javascript
  tray.on('click', toggle);
  tray.on('right-click', toggle);
```

to:

```javascript
  tray.on('click', toggle);
  tray.on('right-click', () => {
    const menu = Menu.buildFromTemplate([
      { label: 'Check for Updates...', click: onCheckForUpdates }
    ]);
    tray.popUpContextMenu(menu);
  });
```

- [ ] **Step 3: Run the existing test suite to confirm nothing broke**

Run: `npm test`
Expected: all tests pass (there is no `tray.test.js` — `tray.js` isn't unit-tested today, consistent with `ipc.js` — so this step is a regression check on the rest of the suite, not new coverage).

- [ ] **Step 4: Commit**

```bash
git add src/main/tray.js
git commit -m "[Update] add Check for Updates context menu on tray right-click"
```

---

### Task 4: Wire the update checker into `index.js`

**Files:**
- Modify: `src/main/index.js`

- [ ] **Step 1: Import the new module**

In `src/main/index.js:6-12`, add the import alongside the existing ones:

```javascript
const { createTray } = require('./tray.js');
const { registerIpc } = require('./ipc.js');
const { createStore } = require('./store.js');
const { listPorts } = require('./scanner/index.js');
const { probeAll } = require('./probe.js');
const { classify } = require('./classify.js');
const { createTracker, snapshotFingerprint } = require('./state.js');
const { createUpdateChecker } = require('./updater.js');
```

- [ ] **Step 2: Construct the checker and pass its trigger to the tray**

In `src/main/index.js:86-93`, change:

```javascript
  const handle = createTray({
    onVisibilityChange: (visible) => {
      panelVisible = visible;
      rescheduleTimer();
      if (visible) refreshNow();
    }
  });
  panel = handle.panel;
```

to:

```javascript
  const updateChecker = createUpdateChecker({ getWindow: () => panel });

  const handle = createTray({
    onVisibilityChange: (visible) => {
      panelVisible = visible;
      rescheduleTimer();
      if (visible) refreshNow();
    },
    onCheckForUpdates: () => updateChecker.checkForUpdates()
  });
  panel = handle.panel;
```

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/main/index.js
git commit -m "[Update] trigger update checks from the tray menu"
```

---

### Task 5: Manual smoke test (needs a human at the keyboard)

This cannot be verified by an automated step — it requires watching the running app.

- [ ] **Step 1: Run from source**

Run: `npm start`

- [ ] **Step 2: Right-click the tray icon**

Expected: a native context menu appears with exactly one item, "Check for Updates...".

- [ ] **Step 3: Click "Check for Updates..."**

Expected: since `DunoDrake/LiveWatcher` has no published GitHub Release yet, this should surface the `error` dialog (e.g. "Cannot find latest-mac.yml" / 404-style message) rather than crash the app or hang. Confirm the dialog's OK button dismisses it and the app keeps running normally afterward (tray icon still responds, panel still opens on left-click).

- [ ] **Step 4: Record the result**

If it behaves as expected, no code change needed — this confirms the wiring is live. If it crashes or hangs, that's a bug to fix before moving on; do not proceed to Task 6 until this passes.

---

### Task 6: Document the release process and update session notes

**Files:**
- Modify: `README.md`
- Modify: `docs/current-session.md`

- [ ] **Step 1: Add a release section to the README**

In `README.md`, after the `## Configuration` section (`README.md:42-47`) and before `## Known limitations`, insert:

```markdown
## Releasing an update

1. Bump `"version"` in `package.json`.
2. Run `GH_TOKEN=<token> npm run dist -- --publish always`, where `<token>`
   is a GitHub personal access token with `repo` scope. `GH_TOKEN` is never
   committed — set it only for this one command.
3. electron-builder uploads the installer plus `latest-mac.yml` to a new
   GitHub Release on `DunoDrake/LiveWatcher`.
4. Installed copies pick it up when the user chooses "Check for
   Updates..." from the tray's right-click menu — there is no automatic
   background check.
```

- [ ] **Step 2: Add the macOS signing caveat to Known limitations**

In `README.md`'s `## Known limitations` section (`README.md:49-58`), add a bullet:

```markdown
- Hot-update installs are unverified against a real signed build. This
  machine only has an Apple Development certificate, not a Developer ID, so
  Gatekeeper may block `quitAndInstall()` from replacing the installed app.
```

- [ ] **Step 3: Append to the "needs a human" list in the session doc**

In `docs/current-session.md`'s `## Still needs a human at the keyboard (updated)` section (end of file), add:

```markdown

6. Publish a real GitHub Release and confirm the full hot-update flow on an
   older installed build: Check for Updates finds it, downloads it, and
   Restart actually installs and relaunches the new version — specifically
   to see whether Gatekeeper blocks the unsigned install.
```

- [ ] **Step 4: Commit**

```bash
git add README.md docs/current-session.md
git commit -m "[Docs] document the hot-update release process and open verification item"
```

---

## Self-review notes

- Spec coverage: architecture (Task 2–4), data flow / dialog sequence (Task 2 tests), build/publish config (Task 1), known limitations documented (Task 6), testing section (Task 2 unit tests + Task 5 manual check) — all spec sections have a corresponding task.
- No placeholders: every step has runnable commands or complete code.
- Type/name consistency checked: `createUpdateChecker`, `checkForUpdates`, `onCheckForUpdates`, `getWindow`, `getCurrentVersion` are spelled identically across Tasks 2–4.
