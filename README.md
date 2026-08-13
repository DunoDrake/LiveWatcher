# LiveWatcher

A menu bar (macOS) and system tray (Windows) tool that lists the local servers
currently listening on this machine, and lets you open, copy, or stop each one.

## Development

```bash
npm install
npm start     # run from source
npm test      # unit tests (node --test), 52 tests
npm run dist  # build the installer into dist/
```

## How it finds servers

`lsof -nP -iTCP -sTCP:LISTEN -F pcn` on macOS, `netstat -ano` joined with
`tasklist` on Windows. Field mode is used on macOS rather than column parsing
because real process names contain spaces and parentheses — `Discord Helper
(Renderer)`, `Cursor Helper (Plugin)` — which break any whitespace splitter.

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

## Known limitations

- The Windows scanner is unit-tested against recorded fixtures but has never
  been run on a real Windows machine.
- Uptime counts from when LiveWatcher first saw the port, not from when the
  process actually started. Restarting the app restarts the count.
- There is no settings screen.
- `npm run dist` signs the build with whatever Apple certificate it finds in
  your keychain. To produce a genuinely unsigned build, run
  `CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist`.

## Design and implementation notes

`docs/superpowers/specs/` holds the design spec, `docs/superpowers/plans/` the
implementation plan. Both record why each decision was made, including the
alternatives that were rejected.
