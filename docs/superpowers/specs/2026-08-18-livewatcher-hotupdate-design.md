# LiveWatcher hot-update design

**Date:** 2026-08-18
**Status:** Approved

## Problem

LiveWatcher has no way to update itself. Every new version requires the user
to manually download and reinstall the `.dmg`/`.exe`. This spec adds
self-update: the app checks GitHub Releases for a newer version, downloads
it, and installs it on restart — all on explicit user action.

## Goals

- User can trigger an update check from the tray menu.
- If a newer version exists, the app downloads it and installs on restart,
  with a confirmation dialog at each step.
- Releases are published to GitHub Releases via `electron-builder`'s
  existing publish support.

## Non-goals (explicitly deferred)

- No automatic/periodic update checking. Manual trigger only.
- No progress bar during download.
- No changelog display in the update dialog.
- No delta/differential update tuning beyond electron-builder defaults.
- No dedicated Windows verification — same caveat as the existing scanner
  (fixtures/logic only, never run on real Windows hardware).

## Architecture

- New module `src/main/updater.js` wraps `electron-updater`'s `autoUpdater`
  singleton. All update logic lives here; nothing in `src/renderer/` or
  `preload.js` changes.
- `src/main/tray.js` gets one new menu item, **"Check for Updates..."**,
  which is the only entry point — there is no background polling.
- All user-facing prompts use Electron's native `dialog.showMessageBox`.
  No custom UI, no IPC additions.
- `electron-updater` is added to `dependencies` (it runs inside the packaged
  app, unlike `electron-builder` which is a dev-only build tool).
- `package.json`'s `build` config gets a `publish` block pointing at the
  GitHub repo (`DunoDrake/LiveWatcher`).

## Data flow

1. User clicks tray → "Check for Updates...".
2. `updater.js` guards against re-entry with an in-memory `checking` flag
   (mirrors the existing `refreshNow` re-entry guard in the scanner), then
   calls `autoUpdater.checkForUpdates()`.
3. Event handling on the `autoUpdater` instance:
   - `update-not-available` → dialog: "You're up to date (vX.X.X)." Clears
     the `checking` flag.
   - `update-available` → dialog: "Version vY.Y.Y is available. Download
     now?" [Download / Cancel].
     - Download → `autoUpdater.downloadUpdate()`.
     - Cancel → clear `checking` flag, stop.
   - `update-downloaded` → dialog: "Update downloaded. Restart now to
     install?" [Restart / Later].
     - Restart → `autoUpdater.quitAndInstall()`.
     - Later → clear `checking` flag; the update installs on the next
       natural quit (default `electron-updater` behavior — not overridden).
   - `error` → dialog showing the error message. Clears the `checking` flag.
     No automatic retry; the user can click the menu item again.
4. `download-progress` is not handled — no progress UI, per non-goals.

## Build & release process

- `package.json` `build.publish`:
  ```json
  "publish": { "provider": "github", "owner": "DunoDrake", "repo": "LiveWatcher" }
  ```
- Release steps (documented in README):
  1. Bump `version` in `package.json`.
  2. Run `GH_TOKEN=<token> npm run dist -- --publish always`.
  3. electron-builder uploads the installer plus `latest-mac.yml` /
     `latest.yml` to a new GitHub Release.
- `GH_TOKEN` needs `repo` scope to create releases. It is never committed —
  set as an environment variable only for the duration of the publish
  command.

## Known limitations

- **macOS code signing.** This machine only has an Apple Development
  certificate, not a Developer ID. `quitAndInstall()` may be blocked by
  Gatekeeper when it tries to replace the installed app. This must be
  verified with a real published release; if blocked, the `error` dialog is
  the fallback path (user is told to download manually from GitHub
  Releases). No workaround is implemented for this in code — it depends on
  getting a Developer ID certificate.
- **Windows unverified**, consistent with the existing scanner's status.

## Testing

- **Unit tests** (`test/updater.test.js`): stub `autoUpdater` as an
  `EventEmitter` and verify:
  - Each event (`update-available`, `update-not-available`,
    `update-downloaded`, `error`) triggers the correct dialog content.
  - `downloadUpdate()` is only called after the user confirms the
    `update-available` dialog, never automatically.
  - `quitAndInstall()` is only called after the user confirms the
    `update-downloaded` dialog, never automatically.
  - The `checking` guard prevents a second `checkForUpdates()` call while
    one is already in flight.
- **Needs a human at the keyboard** (append to `docs/current-session.md`'s
  existing list): publish a real GitHub Release, run an older installed
  build, click "Check for Updates...", confirm the full dialog sequence,
  and confirm restart actually installs the new version — specifically to
  observe whether Gatekeeper blocks the unsigned install.
