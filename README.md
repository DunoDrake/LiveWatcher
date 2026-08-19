# LiveWatcher

A menu bar (macOS) and system tray (Windows) tool that lists the local servers
currently listening on this machine, and lets you open, copy, or stop each one.

## Installation (macOS)

1. Download `LiveWatcher-<version>-arm64.dmg` — from the
   [GitHub Releases page](https://github.com/DunoDrake/LiveWatcher/releases)
   once a version has been published there, or build it yourself locally
   (`npm run dist`, output lands in `dist/`).
2. Open the `.dmg` and drag **LiveWatcher** into **Applications**.
3. Launch it from Applications (or Spotlight). The app has **no dock icon and
   no window on open** by design — look for its icon in the menu bar (top
   right) instead. Click it to open the panel; right-click for "Check for
   Updates...".

### "LiveWatcher can't be opened" on first launch

The build isn't notarized with an Apple Developer ID (see Known limitations
below), so Gatekeeper blocks it the first time. To open it anyway:

- **macOS Sequoia (15) and later:** System Settings → Privacy & Security →
  scroll to the bottom → "LiveWatcher was blocked..." → **Open Anyway** →
  confirm in the dialog that appears. You'll need to do this once per new
  build/version.
- **Older macOS:** right-click (or Control-click) the app in Applications →
  **Open** → **Open** again in the confirmation dialog.

### Uninstalling

Quit the app from its panel (or the tray menu), then drag
`/Applications/LiveWatcher.app` to the Trash. Settings live separately at
`~/Library/Application Support/LiveWatcher/` if you want to remove those too.

## Installation (Windows)

1. Download `LiveWatcher Setup <version>.exe` — from the
   [GitHub Releases page](https://github.com/DunoDrake/LiveWatcher/releases)
   once a version has been published there, or build it yourself locally
   (`npm run dist`, output lands in `dist/`).
2. Run the installer. It is not one-click: it asks you to confirm (and
   optionally change) the install directory, then walks through the usual
   next/next/finish steps.
3. Launch **LiveWatcher** from the Start menu (or the desktop shortcut, if
   you left that box checked during install). The app has **no window on
   open** by design — look for its icon in the system tray (bottom right,
   near the clock; click the `^` arrow to see hidden icons if it's not
   visible right away). Click it to open the panel.

### "Windows protected your PC" on first launch

The build isn't signed with a Windows code-signing certificate (see Known
limitations below), so SmartScreen blocks it the first time. To run it
anyway: on the SmartScreen dialog, click **More info**, then **Run anyway**.
You'll need to do this once per new build/version.

### Uninstalling

Quit the app from its panel (or the tray menu), then use **Settings → Apps →
Installed apps** (or **Control Panel → Programs and Features** on older
Windows) and uninstall **LiveWatcher**. Settings live separately at
`%APPDATA%\LiveWatcher\settings.json` if you want to remove those too.

## Development

```bash
npm install
npm start     # run from source
npm test      # unit tests (node --test), 87 tests
npm run dist  # build the installer into dist/
```

## How it finds servers

`lsof -nP -iTCP -sTCP:LISTEN -F pcn` on macOS, `netstat -ano` joined with
`tasklist` on Windows. Field mode is used on macOS rather than column parsing
because real process names contain spaces and parentheses — `Discord Helper
(Renderer)`, `Cursor Helper (Plugin)` — which break any whitespace splitter.

Each unique pid found this way is then looked up once more (`ps -o
pid=,command=` on macOS, `wmic process get CommandLine,ProcessId` on Windows)
to get its full command line, shown as a hover tooltip on the row. This is
the only way to tell apart two ports served by the same process — e.g. one
binary running separate HTTP and stream workers on different ports still
shows the same short process name and pid for both rows.

Each listening port is then probed over HTTP to read its status code, page
title, and framework header, so the panel can show `localhost:3000 —
PorfolioWebsite · Next.js` instead of a bare port number. Ports that accept TCP
but do not answer HTTP (Postgres, Redis) are marked `tcp` and shown with an
amber dot; that is a normal state, not an error.

A port is shown as a dev server when it falls inside a configured dev range
(3000–3999, 5000–5999, 8000–8999, and others) **or** its process is a known dev
runtime — unless the process is a system daemon, which always sorts into "Other
listening ports". That last rule matters on stock macOS, where ControlCenter
binds ports 5000 and 7000 for AirPlay Receiver and would otherwise appear as one
of your dev servers on every run.

## Stopping a server

The stop button refuses outright, with no confirmation prompt, when the target
has a PID below 500, is on the system-daemon denylist, or belongs to another
user. Otherwise it asks for confirmation naming the port, process, and PID, then
sends `SIGTERM`, waits three seconds, and only then offers `SIGKILL`.

## Configuration

Settings live in `~/Library/Application Support/LiveWatcher/settings.json`
(`%APPDATA%\LiveWatcher\settings.json` on Windows): dev port ranges, poll
intervals, probe timeout. Restart the app after editing. Only "Launch at login"
is editable from the interface.

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

## Known limitations

- The Windows scanner is unit-tested against recorded fixtures but has never
  been run on a real Windows machine.
- Uptime counts from when LiveWatcher first saw the port, not from when the
  process actually started. Restarting the app restarts the count.
- There is no settings screen.
- `npm run dist` signs the build with whatever Apple certificate it finds in
  your keychain. To produce a genuinely unsigned build, run
  `CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist`.
- The Windows build is not code-signed (no certificate configured), so
  SmartScreen flags it on first launch — see the Windows install section
  above.
- The `mac` target must build both `dmg` and `zip` — Squirrel.Mac (what
  electron-updater uses on macOS) downloads the `.zip`, not the `.dmg`.
  Publishing only the `.dmg` makes "Check for Updates..." find the release
  but then fail with "ZIP file not provided" once the user clicks Download.
- Hot-update installs are unverified against a real signed build. This
  machine only has an Apple Development certificate, not a Developer ID, so
  Gatekeeper may block `quitAndInstall()` from replacing the installed app.

## Design and implementation notes

`docs/superpowers/specs/` holds the design spec, `docs/superpowers/plans/` the
implementation plan. Both record why each decision was made, including the
alternatives that were rejected.
