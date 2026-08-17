# Current session

**Preferred model:** claude-sonnet-5 (switched from claude-opus-5 for the icon task)

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

## Custom app + tray icon (2026-08-14)

Replaced the Electron default icon and the placeholder 16x16 base64 tray icon
with a real mark: a filled dot with two radiating arcs ("live signal"),
generated as SVG and rasterized with `qlmanage` (no ImageMagick/rsvg/PIL
available on this machine).

- `build/icon.png` (1024x1024, orange `#f54e00` glyph on `#1c1b19` rounded
  square) — electron-builder's default-convention path; it auto-generates
  `icon.icns` (mac) and would auto-generate `icon.ico` (win) from this file,
  no manual `iconutil`/ico packing needed.
- `assets/trayTemplate.png` (16x16) + `assets/trayTemplate@2x.png` (32x32) —
  black glyph, transparent background, loaded via `nativeImage.createFromPath`
  in `src/main/tray.js` with `setTemplateImage(true)` so macOS recolors it for
  light/dark menu bars. `package.json`'s `files` array now includes
  `assets/**/*` so these ship inside `app.asar`.
- Verified before rebuilding: unit tests still pass (66/66), the icon loads in
  a real Electron process (`nativeImage` not empty, correct 16x16 size, a real
  `Tray` instance constructs without throwing).
- Rebuilt the dmg, reinstalled to `/Applications/LiveWatcher.app` via `ditto`
  (preserves the code signature), confirmed via `asar list` that both tray
  PNGs are inside the packaged asar, confirmed `Info.plist`'s
  `CFBundleIconFile` now points at the new `icon.icns` (was `electron.icns`).
- Found and fixed a reinstall pitfall: `open -a` re-activated the *old*
  already-running process instead of launching the freshly built one, because
  `osascript quit` + `pkill -f <path>` had both silently failed to kill it.
  Caught by checking `ps -eo pid,lstart,command` and seeing a start time from
  before the rebuild; fixed by killing that PID directly, confirming it was
  gone via `pgrep`, then launching. The new process's start time now matches.
- computer-use could not attach to visually confirm the tray icon (same
  stale-app-list issue as the earlier install) — the human check below still
  needs a person at the keyboard.

**Bug found by the user, not caught before shipping:** the tray icon rendered
as a solid white square instead of the glyph. Root cause: `qlmanage`-based SVG
rasterization does not preserve alpha — it composited onto an opaque
background, so both `trayTemplate.png` and `trayTemplate@2x.png` had
`alpha=255` on every pixel (confirmed by decoding the PNG's IDAT stream by
hand — no ImageMagick/PIL on this machine to just ask). A macOS template
image with no transparent region renders as a filled block, matching exactly
what was reported.

Fixed by writing a small supersampled software rasterizer directly in Node
(signed-distance circle/ring math at 16x oversampling, box-filtered down to
16x16 and 32x32) and a minimal hand-rolled PNG encoder, bypassing `qlmanage`
entirely. Verified the fix by decoding the new PNGs the same way: alpha now
ranges 0 (transparent) to 255 (glyph) with proper anti-aliased partials in
between. Also composited the glyph onto a light-gray background as a sanity
preview before rebuilding — confirmed it reads as the intended dot + two
open arcs, not a blob.

Reinstalled the same way as before, but this time killed the running PID
directly first (`pgrep` → `kill -TERM` → confirm `pgrep` empty) rather than
relying on `osascript quit` / `pkill -f <path>`, since the previous session
found those can silently fail to kill an Electron app and `open -a` will
then just re-activate the stale process instead of the freshly built one.

## Still needs a human at the keyboard (updated)

Item 1 from the original list is the one this session's work targets — the
icon should now be a distinct "live signal" mark instead of the generic
Electron atom, in both light and dark menu bars. Please confirm it looks
right at actual menu bar size (16px), since qlmanage-based inspection of a
smoothed 20x upscale is not a substitute for seeing it at 1x on a real
display.
