# Current session

**Preferred model:** claude-opus-5

**Project:** LiveWatcher — Electron tray tool listing live local servers.

**Status:** Tasks 1–15 of `docs/superpowers/plans/2026-08-13-livewatcher.md` complete,
plus a final review pass, on branch `feature/livewatcher`. 66 unit tests pass.
The macOS `.dmg` builds.

## Verified programmatically

- Scanner, probe, classify, kill guards, store, tracker — 52 unit tests, all green.
- The whole pipeline against this machine's real processes: 5 dev servers found,
  12 other ports, zero system daemons leaking into the dev list.
- Preload bridge exposes exactly 7 functions; `require`, `process`, and
  `ipcRenderer` are all `undefined` in the renderer.
- A snapshot sent over IPC arrives intact at the renderer.
- The panel renders correctly in both colour schemes (captured to PNG and
  inspected), with no CSP violations and no console errors.
- The destructive path end to end: a real orphaned `python3 -m http.server` on
  port 8000 was found by the scanner, passed the guards, terminated with SIGTERM
  inside the grace period, and disappeared from the next scan. `ControlCenter`
  was refused with "is a protected system process" and kept running.
- The built app's `Info.plist` carries `LSUIElement = 1`.

## Still needs a human at the keyboard

These cannot be checked without watching the screen:

1. The tray icon is visible in the menu bar and looks right in both light and
   dark menu bars.
2. Clicking the tray icon opens the panel and it **stays open**. Programmatic
   testing found that `panel.show()` followed by `panel.focus()` can be followed
   by an immediate real blur when the app is not frontmost, which hides the
   panel instantly. Showing without `focus()` did not reproduce it, so this is
   probably an artifact of launching from a terminal — but confirm it. If the
   panel does vanish on its own, call `app.focus({ steal: true })` before
   `panel.show()` in `toggle()` in `src/main/tray.js`.
3. The stop-confirmation dialog appears, names the right port/process/PID, and
   Cancel genuinely cancels.
4. Hover reveals the three action buttons on a row.
5. The packaged app registers under System Settings → General → Login Items, and
   the panel toggle adds and removes it.

## Open items

- Windows scanner unverified on real hardware (fixtures only).
- No settings UI; dev ranges and poll intervals are edited in settings.json.
- Up/down notifications deliberately deferred; they would need debouncing
  against hot-reload restarts before being useful.
- `npm run dist` signs with the Apple Development certificate found in the
  keychain (`hue.nguyen@enotion.io`). Use
  `CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist` for an unsigned build.

## Defects found and fixed during implementation

- `node --test test/` does not work on Node v24.13.1 — it resolves the directory
  as an entry module. Fixed to a quoted glob.
- The probe tests hung forever because a `net` server that never reads leaves
  the request unconsumed, so `server.close()` never resolves. Fixed with
  `socket.resume()`.
- A long meta line pushed the uptime column off the 360px panel, because grid
  items default to `min-width: auto` and would not shrink. Fixed with
  `.row > div { min-width: 0 }`, which also activated the intended ellipsis.

Found by the final review pass and fixed in `5ab98d1`:

- **Uptime never advanced.** Snapshots are only sent when the fingerprint
  changes, and the fingerprint has no time component, so on a quiet machine the
  column froze at whatever it last read. The renderer now ticks it locally.
  Verified: a row painted as `0s` from a stale snapshot reads `2h 14m` after one
  tick against the real clock.
- **Overlapping scans.** A scan can outlast its interval, and the older run then
  deleted the newer run's `firstSeen` keys — rows vanished and uptimes reset.
  `refreshNow` now refuses to re-enter.
- **A recycled PID could be killed.** The confirmation dialog can sit open
  indefinitely while the row's PID goes stale. The kill path now re-reads the
  live process name and aborts if it no longer matches what the dialog promised.
- **Cmd+W killed the app dead.** Closing the panel destroyed the only window,
  leaving the tray icon inert with no recovery but Force Quit. Close now hides.
- **Settings were trusted blindly.** `"devRanges": 5` made every scan throw with
  no way back except deleting the file — bad, since hand-editing that file is the
  documented way to configure the app. Values are now validated on load and on
  set, with unknown keys refused.
- **Fingerprint field collisions.** Fields were joined with `''`, so
  `title:'foo' + name:'bar'` hashed the same as `title:'foob' + name:'ar'` and
  swallowed a real update. Now delimited.

Findings from that review left unfixed on purpose: `formatUptime` is duplicated
between `state.js` (tested, unused) and `panel.js` (used, untested) because the
sandboxed renderer cannot require from `src/main`; `showOtherPorts` is unused
config; there is no `requestSingleInstanceLock`; and `ipc.js` has no unit tests
of its own. None of these can lose data.
