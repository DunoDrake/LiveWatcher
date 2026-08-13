# LiveWatcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a background desktop tool that lives in the macOS menu bar / Windows system tray, lists every local server currently listening (localhost:3000, :5173…), and lets the user open, copy, or stop each one.

**Architecture:** All heavy logic runs in the Electron main process, split into small single-responsibility modules. Every scanner is split in two — a shell-runner half and a **pure parse function** that takes a string and returns objects — so the fragile parsing logic is unit-testable against recorded fixtures without ever shelling out. The renderer only draws and sends intents over a whitelisted IPC bridge.

**Tech Stack:** Electron (main + renderer), CommonJS modules, `node --test` (built into Node 24, no test framework dependency), `electron-builder` for packaging. Total runtime dependency count: zero. Total dev dependency count: two.

**Spec:** [`docs/superpowers/specs/2026-08-13-livewatcher-design.md`](../specs/2026-08-13-livewatcher-design.md)

---

## Context you need before starting

**You are building for two operating systems but can only verify one.** The development machine is macOS (arm64, Node v24.13.1, npm 11.8.0). The Windows scanner must still be written and unit-tested against a recorded fixture, but do not claim it works on real Windows — that stays an open item until someone runs it there.

**Why CommonJS and not ESM.** Electron supports ESM in the main process, but ESM preload scripts require `sandbox: false`, which weakens the renderer isolation this app depends on. CommonJS everywhere avoids that trade entirely. Use `require`/`module.exports` in every file.

**Why `lsof -F` field mode and not column parsing.** Real output from the dev machine contains process names with spaces and parentheses — `Discord Helper (Renderer)`, `Cursor Helper (Plugin)`. Any column-splitting parser breaks on these. Field mode emits one tagged value per line and cannot be ambiguous.

**A finding that changed the design.** Real `lsof` output on macOS shows `ControlCenter` listening on ports **5000 and 7000** (AirPlay Receiver). Port 5000 sits inside the dev range 5000–5999, so the classification rule from the spec would file a macOS system daemon under "dev servers". The spec's rule needs a third clause, implemented in Task 5: **a system-process denylist that overrides the dev rules.** Without it the tool ships with a visible wrong answer on every stock Mac.

**Two deliberate deviations from the spec.** Both are decisions, not oversights — do not "fix" them without asking:

1. **No Settings screen.** The spec's interface sketch shows a gear button and a Settings entry, and says dev ranges are configurable there. This plan ships the settings *store* (Task 8) with every value the app reads, but no UI for editing them beyond the "Launch at login" toggle. Building a settings screen roughly doubles the renderer work for a value nobody has asked for yet; until then the file at `~/Library/Application Support/LiveWatcher/settings.json` is editable by hand. The gear button is therefore absent from the markup rather than present and dead.

2. **An empty scan is believed, not suppressed.** The spec says an unexpectedly empty parse result should keep the previous snapshot. That rule cannot distinguish "the parser broke" from "you just stopped your last server", and getting it wrong means the panel confidently shows servers that are gone — a worse failure than briefly showing nothing. This plan keeps the old snapshot **only when the scan throws**, and treats an empty result as the truth.

**Project conventions** (from the user's `CLAUDE.md`, these override any habit you have):
- Commit subjects are prefixed `[Add]`, `[Update]`, `[Fix]`, `[Refactor]`, `[Docs]`, `[Test]`, `[Chore]`, `[Style]`, `[Perf]`. Max 20 words. **Never** add a `Co-Authored-By` trailer.
- No `console.log` / debug logging unless explicitly requested.
- Functions taking more than 4 parameters use a single named-parameter object instead.
- No external UI libraries. No external animation libraries. No animation longer than 300ms.
- Code and comments in English.

---

## File Structure

| Path | Responsibility |
|---|---|
| `package.json` | Scripts, deps, electron-builder config |
| `src/main/index.js` | App lifecycle, wires poll loop to tray |
| `src/main/scanner/index.js` | Platform dispatcher + shell execution |
| `src/main/scanner/darwin.js` | **Pure** `lsof -F` parser |
| `src/main/scanner/win32.js` | **Pure** `netstat`/`tasklist` parsers + merge |
| `src/main/classify.js` | Dev/other/system classification rules |
| `src/main/probe.js` | HTTP enrichment (status, title, framework) |
| `src/main/kill.js` | Guard checks + process termination |
| `src/main/store.js` | Settings persistence |
| `src/main/state.js` | Uptime tracking + change detection |
| `src/main/tray.js` | Tray icon + frameless panel window |
| `src/main/ipc.js` | Whitelisted main↔renderer channels |
| `src/preload.js` | `contextBridge` API surface |
| `src/renderer/index.html` | Panel markup |
| `src/renderer/panel.css` | Panel styling, light + dark |
| `src/renderer/panel.js` | Panel rendering + event handling |
| `test/fixtures/lsof-darwin.txt` | Real recorded macOS output |
| `test/fixtures/netstat-win32.txt` | Recorded Windows output |
| `test/fixtures/tasklist-win32.csv` | Recorded Windows output |
| `test/*.test.js` | One test file per pure module |

Tasks 2–9 build the pure logic and are fully test-driven. Tasks 10–14 build the Electron shell, which cannot be meaningfully unit-tested and is verified by running the app instead — each of those tasks states exactly what you must see on screen.

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `src/renderer/.gitkeep`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "livewatcher",
  "version": "0.1.0",
  "description": "Menu bar tool that lists live local servers",
  "main": "src/main/index.js",
  "private": true,
  "scripts": {
    "start": "electron .",
    "test": "node --test \"test/**/*.test.js\"",
    "dist": "electron-builder"
  },
  "devDependencies": {
    "electron": "^38.0.0",
    "electron-builder": "^26.0.0"
  }
}
```

The test script uses an explicit quoted glob rather than `node --test test/`. On Node v24.13.1 the directory form is not treated as a test path — it is resolved as an entry module and dies with `Cannot find module '…/test'`. The quotes matter: they stop the shell from expanding the glob so Node expands it itself.

- [ ] **Step 2: Install dependencies**

Run: `npm install`
Expected: completes without error, creates `node_modules/` and `package-lock.json`.

- [ ] **Step 3: Verify Electron is usable**

Run: `npx electron --version`
Expected: prints a version string like `v38.x.y`. If this fails with a download error, the Electron binary did not fetch — rerun `npm install` before continuing, because every later task depends on it.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "[Chore] scaffold Electron project with test and packaging scripts"
```

---

## Task 2: macOS scanner parser

This is the highest-risk parsing code in the project, so it is built first and tested against real output recorded from the development machine.

**Files:**
- Create: `test/fixtures/lsof-darwin.txt`
- Create: `test/scanner-darwin.test.js`
- Create: `src/main/scanner/darwin.js`

- [ ] **Step 1: Save the real fixture**

Create `test/fixtures/lsof-darwin.txt` with exactly this content. It is genuine `lsof -nP -iTCP -sTCP:LISTEN -F pcn` output captured on the dev machine — do not tidy it up, its warts are the point.

```
p488
crapportd
f8
n*:64020
f9
n*:64020
p521
cControlCenter
f8
n*:7000
f9
n*:7000
f10
n*:5000
f11
n*:5000
p591
cnode
f21
n127.0.0.1:3113
p598
cjava
f9
n*:8080
p659
cfigma_agent
f9
n127.0.0.1:44950
f10
n127.0.0.1:44960
p6161
ciii
f9
n127.0.0.1:3111
f10
n127.0.0.1:3112
f11
n*:49134
p8979
cDiscord Helper (Renderer)
f41
n127.0.0.1:6463
p9605
cCocosCreator
f43
n*:7456
p21425
cnode
f12
n*:3000
p25295
cCursor Helper (Plugin)
f55
n127.0.0.1:50898
f69
n127.0.0.1:63654
p26389
cCursor Helper (Plugin)
f24
n[::1]:51165
```

Note the four properties this fixture exercises: a process name containing a space and parentheses, an IPv6 bracketed address, the `*` wildcard host, and the same process listening on one port through two file descriptors (rapportd on 64020, ControlCenter on 7000 and on 5000).

- [ ] **Step 2: Write the failing test**

Create `test/scanner-darwin.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { parseLsof, parseAddress } = require('../src/main/scanner/darwin.js');

const FIXTURE = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'lsof-darwin.txt'),
  'utf8'
);

test('parseAddress handles wildcard, IPv4, and bracketed IPv6', () => {
  assert.deepStrictEqual(parseAddress('*:3000'), { host: '0.0.0.0', port: 3000 });
  assert.deepStrictEqual(parseAddress('127.0.0.1:3113'), { host: '127.0.0.1', port: 3113 });
  assert.deepStrictEqual(parseAddress('[::1]:51165'), { host: '::1', port: 51165 });
  assert.deepStrictEqual(parseAddress('[::]:8080'), { host: '::', port: 8080 });
});

test('parseAddress rejects malformed input', () => {
  assert.strictEqual(parseAddress('no-colon-here'), null);
  assert.strictEqual(parseAddress('127.0.0.1:notaport'), null);
});

test('parseLsof collapses duplicate file descriptors on the same port', () => {
  const rows = parseLsof(FIXTURE);
  const rapportd = rows.filter((r) => r.pid === 488);
  assert.strictEqual(rapportd.length, 1);
  assert.strictEqual(rapportd[0].port, 64020);
});

test('parseLsof keeps distinct ports from one process', () => {
  const rows = parseLsof(FIXTURE);
  const ports = rows.filter((r) => r.pid === 521).map((r) => r.port).sort((a, b) => a - b);
  assert.deepStrictEqual(ports, [5000, 7000]);
});

test('parseLsof preserves process names containing spaces and parentheses', () => {
  const rows = parseLsof(FIXTURE);
  const discord = rows.find((r) => r.port === 6463);
  assert.strictEqual(discord.processName, 'Discord Helper (Renderer)');
  assert.strictEqual(discord.pid, 8979);
});

test('parseLsof reads IPv6 loopback entries', () => {
  const rows = parseLsof(FIXTURE);
  const ipv6 = rows.find((r) => r.port === 51165);
  assert.strictEqual(ipv6.address, '::1');
  assert.strictEqual(ipv6.processName, 'Cursor Helper (Plugin)');
});

test('parseLsof returns every distinct pid/port pair in the fixture', () => {
  const rows = parseLsof(FIXTURE);
  assert.strictEqual(rows.length, 16);
});

test('parseLsof returns an empty array for empty input', () => {
  assert.deepStrictEqual(parseLsof(''), []);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test test/scanner-darwin.test.js`
Expected: FAIL — `Cannot find module '../src/main/scanner/darwin.js'`.

- [ ] **Step 4: Write the implementation**

Create `src/main/scanner/darwin.js`:

```js
'use strict';

// lsof field-mode output is a flat stream of tagged lines:
//   p<pid>  starts a process record
//   c<name> the command name for that process
//   f<fd>   starts a file record
//   n<addr> the address bound by that file
function parseAddress(raw) {
  const idx = raw.lastIndexOf(':');
  if (idx === -1) return null;

  const port = Number(raw.slice(idx + 1));
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;

  let host = raw.slice(0, idx);
  if (host === '*') host = '0.0.0.0';
  else if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (host === '') return null;

  return { host, port };
}

function parseLsof(stdout) {
  const rows = [];
  const seen = new Set();
  let pid = null;
  let processName = 'unknown';

  for (const line of String(stdout).split('\n')) {
    if (line.length === 0) continue;
    const tag = line[0];
    const value = line.slice(1);

    if (tag === 'p') {
      pid = Number(value);
      processName = 'unknown';
      continue;
    }
    if (tag === 'c') {
      processName = value;
      continue;
    }
    if (tag !== 'n' || !Number.isInteger(pid)) continue;

    const address = parseAddress(value);
    if (!address) continue;

    const key = `${pid}:${address.port}`;
    if (seen.has(key)) continue;
    seen.add(key);

    rows.push({ port: address.port, pid, processName, address: address.host });
  }

  return rows;
}

module.exports = { parseLsof, parseAddress };
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test test/scanner-darwin.test.js`
Expected: PASS, 8 tests, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add src/main/scanner/darwin.js test/scanner-darwin.test.js test/fixtures/lsof-darwin.txt
git commit -m "[Add] macOS lsof field-mode parser with real captured fixture"
```

---

## Task 3: Windows scanner parser

Same shape as Task 2, but Windows needs two commands: `netstat -ano` gives port→PID, `tasklist` gives PID→name.

**Files:**
- Create: `test/fixtures/netstat-win32.txt`
- Create: `test/fixtures/tasklist-win32.csv`
- Create: `test/scanner-win32.test.js`
- Create: `src/main/scanner/win32.js`

- [ ] **Step 1: Save the fixtures**

Create `test/fixtures/netstat-win32.txt`:

```

Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1044
  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       8823
  TCP    [::]:3000              [::]:0                 LISTENING       8823
  TCP    127.0.0.1:5432         0.0.0.0:0              LISTENING       4120
  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       9001
  TCP    192.168.1.5:139        0.0.0.0:0              LISTENING       4
  TCP    127.0.0.1:52100        127.0.0.1:3000         ESTABLISHED     7777
```

Create `test/fixtures/tasklist-win32.csv`:

```
"System","4","Services","0","144 K"
"svchost.exe","1044","Services","0","12,208 K"
"node.exe","8823","Console","1","145,678 K"
"postgres.exe","4120","Services","0","32,904 K"
"node.exe","9001","Console","1","98,112 K"
"chrome.exe","7777","Console","1","410,556 K"
```

- [ ] **Step 2: Write the failing test**

Create `test/scanner-win32.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { parseNetstat, parseTasklist, mergeWin32 } = require('../src/main/scanner/win32.js');

const read = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const NETSTAT = read('netstat-win32.txt');
const TASKLIST = read('tasklist-win32.csv');

test('parseNetstat keeps only listening TCP rows', () => {
  const rows = parseNetstat(NETSTAT);
  assert.strictEqual(rows.length, 6);
  assert.ok(!rows.some((r) => r.port === 52100), 'established connection must be excluded');
});

test('parseNetstat unwraps bracketed IPv6 hosts', () => {
  const rows = parseNetstat(NETSTAT);
  const ipv6 = rows.find((r) => r.address === '::');
  assert.strictEqual(ipv6.port, 3000);
  assert.strictEqual(ipv6.pid, 8823);
});

test('parseTasklist maps pid to process name', () => {
  const map = parseTasklist(TASKLIST);
  assert.strictEqual(map.get(8823), 'node.exe');
  assert.strictEqual(map.get(4120), 'postgres.exe');
  assert.strictEqual(map.size, 6);
});

test('mergeWin32 joins names onto ports and collapses IPv4/IPv6 duplicates', () => {
  const rows = mergeWin32(parseNetstat(NETSTAT), parseTasklist(TASKLIST));
  const onPort3000 = rows.filter((r) => r.port === 3000);
  assert.strictEqual(onPort3000.length, 1);
  assert.strictEqual(onPort3000[0].processName, 'node.exe');
  assert.strictEqual(onPort3000[0].pid, 8823);
});

test('mergeWin32 falls back to "unknown" when tasklist has no entry', () => {
  const rows = mergeWin32([{ port: 9999, pid: 31337, address: '0.0.0.0' }], new Map());
  assert.strictEqual(rows[0].processName, 'unknown');
});

test('parseNetstat returns an empty array for empty input', () => {
  assert.deepStrictEqual(parseNetstat(''), []);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test test/scanner-win32.test.js`
Expected: FAIL — `Cannot find module '../src/main/scanner/win32.js'`.

- [ ] **Step 4: Write the implementation**

Create `src/main/scanner/win32.js`. Note the listening check: matching the literal word `LISTENING` breaks on localized Windows installs, so a row also counts as listening when its foreign address is the null endpoint.

```js
'use strict';

function splitHostPort(raw) {
  const idx = raw.lastIndexOf(':');
  if (idx === -1) return null;

  const port = Number(raw.slice(idx + 1));
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;

  let host = raw.slice(0, idx);
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (host === '') return null;

  return { host, port };
}

const NULL_ENDPOINTS = new Set(['0.0.0.0:0', '[::]:0', '*:*']);

function parseNetstat(stdout) {
  const rows = [];

  for (const line of String(stdout).split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length !== 5) continue;
    if (parts[0].toUpperCase() !== 'TCP') continue;

    const [, local, foreign, state, pidRaw] = parts;
    const listening = state.toUpperCase() === 'LISTENING' || NULL_ENDPOINTS.has(foreign);
    if (!listening) continue;

    const pid = Number(pidRaw);
    if (!Number.isInteger(pid)) continue;

    const address = splitHostPort(local);
    if (!address) continue;

    rows.push({ port: address.port, pid, address: address.host });
  }

  return rows;
}

function parseTasklist(stdout) {
  const map = new Map();

  for (const line of String(stdout).split('\n')) {
    const fields = line.trim().match(/"([^"]*)"/g);
    if (!fields || fields.length < 2) continue;

    const name = fields[0].slice(1, -1);
    const pid = Number(fields[1].slice(1, -1));
    if (!Number.isInteger(pid)) continue;

    map.set(pid, name);
  }

  return map;
}

function mergeWin32(netstatRows, pidMap) {
  const rows = [];
  const seen = new Set();

  for (const row of netstatRows) {
    const key = `${row.pid}:${row.port}`;
    if (seen.has(key)) continue;
    seen.add(key);

    rows.push({
      port: row.port,
      pid: row.pid,
      processName: pidMap.get(row.pid) ?? 'unknown',
      address: row.address
    });
  }

  return rows;
}

module.exports = { parseNetstat, parseTasklist, mergeWin32, splitHostPort };
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test test/scanner-win32.test.js`
Expected: PASS, 6 tests, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add src/main/scanner/win32.js test/scanner-win32.test.js test/fixtures/netstat-win32.txt test/fixtures/tasklist-win32.csv
git commit -m "[Add] Windows netstat and tasklist parsers with locale-tolerant listening check"
```

---

## Task 4: Scanner dispatcher

The half that actually shells out. The command runner is injected so the dispatcher is testable without touching the real system.

**Files:**
- Create: `test/scanner-index.test.js`
- Create: `src/main/scanner/index.js`

- [ ] **Step 1: Write the failing test**

Create `test/scanner-index.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { listPorts } = require('../src/main/scanner/index.js');

const read = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

test('listPorts parses lsof output on darwin', async () => {
  const calls = [];
  const run = async (cmd, args) => {
    calls.push(cmd);
    return read('lsof-darwin.txt');
  };

  const rows = await listPorts({ platform: 'darwin', run });

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0], 'lsof');
  assert.strictEqual(rows.length, 16);
});

test('listPorts runs both Windows commands and merges them', async () => {
  const calls = [];
  const run = async (cmd) => {
    calls.push(cmd);
    return cmd === 'netstat' ? read('netstat-win32.txt') : read('tasklist-win32.csv');
  };

  const rows = await listPorts({ platform: 'win32', run });

  assert.deepStrictEqual(calls.sort(), ['netstat', 'tasklist']);
  assert.strictEqual(rows.find((r) => r.port === 3000).processName, 'node.exe');
});

test('listPorts rejects on an unsupported platform', async () => {
  await assert.rejects(
    () => listPorts({ platform: 'aix', run: async () => '' }),
    /Unsupported platform: aix/
  );
});

test('listPorts propagates a failing command so the caller can keep the old snapshot', async () => {
  const run = async () => {
    throw new Error('spawn lsof ENOENT');
  };

  await assert.rejects(() => listPorts({ platform: 'darwin', run }), /ENOENT/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/scanner-index.test.js`
Expected: FAIL — `Cannot find module '../src/main/scanner/index.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/main/scanner/index.js`:

```js
'use strict';

const { execFile } = require('node:child_process');
const { parseLsof } = require('./darwin.js');
const { parseNetstat, parseTasklist, mergeWin32 } = require('./win32.js');

const COMMAND_TIMEOUT_MS = 4000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: COMMAND_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true },
      (error, stdout) => {
        // lsof exits non-zero when some sockets are unreadable but still prints
        // the ones it could read, so partial output is preferred over failing.
        if (error && !stdout) reject(error);
        else resolve(stdout);
      }
    );
  });
}

async function listPorts({ platform = process.platform, run = runCommand } = {}) {
  if (platform === 'darwin') {
    const stdout = await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pcn']);
    return parseLsof(stdout);
  }

  if (platform === 'win32') {
    const [netstat, tasklist] = await Promise.all([
      run('netstat', ['-ano', '-p', 'TCP']),
      run('tasklist', ['/FO', 'CSV', '/NH'])
    ]);
    return mergeWin32(parseNetstat(netstat), parseTasklist(tasklist));
  }

  throw new Error(`Unsupported platform: ${platform}`);
}

module.exports = { listPorts, runCommand };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/scanner-index.test.js`
Expected: PASS, 4 tests, 0 failures.

- [ ] **Step 5: Verify against the real system**

Run:

```bash
node -e "require('./src/main/scanner/index.js').listPorts().then(r => console.table(r.slice(0, 10)))"
```

Expected: a table of real listening ports on this Mac. You should recognise at least one of your own dev servers. If the table is empty, `lsof` is not on `PATH` — stop and fix that before continuing.

- [ ] **Step 6: Commit**

```bash
git add src/main/scanner/index.js test/scanner-index.test.js
git commit -m "[Add] platform scanner dispatcher with injectable command runner"
```

---

## Task 5: Classification rules

Implements the spec's rule D **plus** the system-process override discovered from real `lsof` output.

**Files:**
- Create: `test/classify.test.js`
- Create: `src/main/classify.js`

- [ ] **Step 1: Write the failing test**

Create `test/classify.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  classify,
  isDevPort,
  isDevProcess,
  isSystemProcess,
  normalizeName,
  DEV_RANGES
} = require('../src/main/classify.js');

const entry = (port, processName, pid = 1000) => ({ port, processName, pid, address: '127.0.0.1' });

test('normalizeName lowercases and strips the Windows .exe suffix', () => {
  assert.strictEqual(normalizeName('Node.EXE'), 'node');
  assert.strictEqual(normalizeName('python3'), 'python3');
});

test('isDevPort covers the configured ranges and rejects outside them', () => {
  assert.ok(isDevPort(3000, DEV_RANGES));
  assert.ok(isDevPort(1337, DEV_RANGES));
  assert.ok(isDevPort(8080, DEV_RANGES));
  assert.ok(!isDevPort(64020, DEV_RANGES));
  assert.ok(!isDevPort(22, DEV_RANGES));
});

test('isDevProcess matches regardless of case or .exe suffix', () => {
  assert.ok(isDevProcess('node'));
  assert.ok(isDevProcess('node.exe'));
  assert.ok(!isDevProcess('CocosCreator'));
});

test('isSystemProcess matches known macOS and Windows daemons', () => {
  assert.ok(isSystemProcess('ControlCenter'));
  assert.ok(isSystemProcess('mDNSResponder'));
  assert.ok(isSystemProcess('svchost.exe'));
  assert.ok(!isSystemProcess('node'));
});

test('a dev-range port classifies as dev', () => {
  const { dev } = classify([entry(3000, 'node')]);
  assert.strictEqual(dev.length, 1);
  assert.strictEqual(dev[0].isDev, true);
});

test('a dev process on an unusual port still classifies as dev', () => {
  const { dev } = classify([entry(49134, 'node')]);
  assert.strictEqual(dev.length, 1);
  assert.strictEqual(dev[0].port, 49134);
});

test('neither rule matching puts the port in other', () => {
  const { dev, other } = classify([entry(64020, 'CocosCreator')]);
  assert.strictEqual(dev.length, 0);
  assert.strictEqual(other.length, 1);
});

test('a system process on a dev-range port is forced to other', () => {
  // Real macOS behaviour: ControlCenter (AirPlay Receiver) binds port 5000,
  // which sits inside the 5000-5999 dev range.
  const { dev, other } = classify([entry(5000, 'ControlCenter', 521)]);
  assert.strictEqual(dev.length, 0);
  assert.strictEqual(other[0].port, 5000);
});

test('classify sorts each group by port ascending', () => {
  const { dev } = classify([entry(8080, 'java'), entry(3000, 'node'), entry(5173, 'node')]);
  assert.deepStrictEqual(dev.map((e) => e.port), [3000, 5173, 8080]);
});

test('classify honours custom ranges from settings', () => {
  const { dev, other } = classify([entry(3000, 'CocosCreator')], { devRanges: [[7000, 7999]] });
  assert.strictEqual(dev.length, 0);
  assert.strictEqual(other.length, 1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/classify.test.js`
Expected: FAIL — `Cannot find module '../src/main/classify.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/main/classify.js`:

```js
'use strict';

const DEV_RANGES = [
  [1337, 1337],
  [3000, 3999],
  [4000, 4999],
  [5000, 5999],
  [8000, 8999],
  [9000, 9999]
];

const DEV_PROCESSES = [
  'node', 'bun', 'deno', 'python', 'python3', 'ruby', 'java',
  'php', 'dotnet', 'go', 'nginx', 'caddy', 'docker', 'com.docker.backend'
];

// Daemons that must never be presented as dev servers even when they occupy a
// dev-range port. ControlCenter is the load-bearing case: stock macOS binds it
// to 5000 and 7000 for AirPlay Receiver.
const SYSTEM_PROCESSES = [
  'launchd', 'mdnsresponder', 'rapportd', 'controlcenter', 'sharingd',
  'airplayxpchelper', 'remoted', 'svchost', 'system', 'lsass', 'services', 'wininit'
];

function normalizeName(name) {
  return String(name).toLowerCase().replace(/\.exe$/, '');
}

function isDevPort(port, ranges = DEV_RANGES) {
  return ranges.some(([low, high]) => port >= low && port <= high);
}

function isDevProcess(name, list = DEV_PROCESSES) {
  const normalized = normalizeName(name);
  return list.some((candidate) => normalizeName(candidate) === normalized);
}

function isSystemProcess(name, list = SYSTEM_PROCESSES) {
  const normalized = normalizeName(name);
  return list.some((candidate) => normalizeName(candidate) === normalized);
}

function classify(entries, settings = {}) {
  const ranges = settings.devRanges ?? DEV_RANGES;
  const dev = [];
  const other = [];

  for (const entry of entries) {
    const system = isSystemProcess(entry.processName);
    const isDev = !system && (isDevPort(entry.port, ranges) || isDevProcess(entry.processName));
    (isDev ? dev : other).push({ ...entry, isDev });
  }

  const byPort = (a, b) => a.port - b.port;
  dev.sort(byPort);
  other.sort(byPort);

  return { dev, other };
}

module.exports = {
  classify,
  isDevPort,
  isDevProcess,
  isSystemProcess,
  normalizeName,
  DEV_RANGES,
  DEV_PROCESSES,
  SYSTEM_PROCESSES
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/classify.test.js`
Expected: PASS, 10 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/main/classify.js test/classify.test.js
git commit -m "[Add] port classification with system process override for dev ranges"
```

---

## Task 6: HTTP probe

Turns `localhost:3000` into `PorfolioWebsite · Next.js`. Tested against a real HTTP server started inside the test, not a mock, because the interesting behaviour is timeouts and non-HTTP sockets.

**Files:**
- Create: `test/probe.test.js`
- Create: `src/main/probe.js`

- [ ] **Step 1: Write the failing test**

Create `test/probe.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const net = require('node:net');

const { probe, extractTitle, detectFramework } = require('../src/main/probe.js');

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test('extractTitle pulls the document title and trims it', () => {
  assert.strictEqual(extractTitle('<html><head><title>  My App  </title></head>'), 'My App');
  assert.strictEqual(extractTitle('<title lang="en">Attrs</title>'), 'Attrs');
  assert.strictEqual(extractTitle('<html><body>no title</body></html>'), null);
  assert.strictEqual(extractTitle('<title></title>'), null);
});

test('detectFramework prefers Next.js headers over the generic ones', () => {
  const headers = new Headers({ 'x-nextjs-cache': 'HIT', 'x-powered-by': 'Express' });
  assert.strictEqual(detectFramework(headers), 'Next.js');
});

test('detectFramework falls back to x-powered-by then server', () => {
  assert.strictEqual(detectFramework(new Headers({ 'x-powered-by': 'Express' })), 'Express');
  assert.strictEqual(detectFramework(new Headers({ server: 'nginx/1.25' })), 'nginx/1.25');
  assert.strictEqual(detectFramework(new Headers({})), null);
});

test('probe reads status, title, and framework from a real HTML server', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html', 'x-powered-by': 'Express' });
    res.end('<html><head><title>PorfolioWebsite</title></head><body>hi</body></html>');
  });
  const port = await listen(server);

  const result = await probe(port);

  assert.strictEqual(result.kind, 'http');
  assert.strictEqual(result.httpStatus, 200);
  assert.strictEqual(result.title, 'PorfolioWebsite');
  assert.strictEqual(result.framework, 'Express');

  await close(server);
});

test('probe records an HTTP error status without treating it as a failure', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('boom');
  });
  const port = await listen(server);

  const result = await probe(port);

  assert.strictEqual(result.kind, 'http');
  assert.strictEqual(result.httpStatus, 500);
  assert.strictEqual(result.title, null);

  await close(server);
});

test('probe marks a non-HTTP TCP socket as kind tcp', async () => {
  // Drain the incoming bytes before ending: an accepted socket that never
  // reads leaves its request unconsumed, which keeps Node's stream from
  // emitting 'close' and hangs server.close() forever, independent of probe().
  const server = net.createServer((socket) => {
    socket.resume();
    socket.end();
  });
  const port = await listen(server);

  const result = await probe(port, { timeoutMs: 400 });

  assert.strictEqual(result.kind, 'tcp');
  assert.strictEqual(result.httpStatus, null);

  await close(server);
});

test('probe gives up on a silent socket within the timeout', async () => {
  const server = net.createServer((socket) => {
    // Accept and never respond, forcing the timeout path. Still drain the
    // socket so an ended/aborted client connection can fully close (see the
    // comment on the previous test for why this is required).
    socket.resume();
  });
  const port = await listen(server);

  const started = Date.now();
  const result = await probe(port, { timeoutMs: 300 });

  assert.strictEqual(result.kind, 'tcp');
  assert.ok(Date.now() - started < 2000, 'probe must abort near its timeout');

  await close(server);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/probe.test.js`
Expected: FAIL — `Cannot find module '../src/main/probe.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/main/probe.js`:

```js
'use strict';

const MAX_HTML_BYTES = 8192;

function extractTitle(html) {
  const match = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  if (!match) return null;

  const title = match[1].trim();
  return title.length > 0 ? title : null;
}

function detectFramework(headers) {
  const get = (key) => headers.get(key);

  if (get('x-nextjs-cache') || get('x-nextjs-prerender')) return 'Next.js';
  return get('x-powered-by') || get('server') || null;
}

const UNREACHABLE = { kind: 'tcp', httpStatus: null, title: null, framework: null };

async function probe(port, { timeoutMs = 1500, fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(`http://127.0.0.1:${port}/`, {
      signal: controller.signal,
      redirect: 'manual',
      headers: { accept: 'text/html' }
    });

    const contentType = response.headers.get('content-type') ?? '';
    let title = null;

    if (contentType.includes('text/html')) {
      const body = await response.text();
      title = extractTitle(body.slice(0, MAX_HTML_BYTES));
    } else {
      await response.body?.cancel();
    }

    return {
      kind: 'http',
      httpStatus: response.status,
      title,
      framework: detectFramework(response.headers)
    };
  } catch {
    // A refused connection, a protocol mismatch, or a timeout all mean the same
    // thing to the user: this port is listening but is not a web page.
    return { ...UNREACHABLE };
  } finally {
    clearTimeout(timer);
  }
}

async function probeAll(ports, { concurrency = 8, timeoutMs = 1500 } = {}) {
  const results = new Map();
  const queue = [...ports];

  const worker = async () => {
    while (queue.length > 0) {
      const port = queue.shift();
      results.set(port, await probe(port, { timeoutMs }));
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return results;
}

module.exports = { probe, probeAll, extractTitle, detectFramework };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/probe.test.js`
Expected: PASS, 7 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/main/probe.js test/probe.test.js
git commit -m "[Add] HTTP probe enriching ports with status, title, and framework"
```

---

## Task 7: Kill guards

The only destructive code in the app. The guard function is pure so every refusal path is tested.

**Files:**
- Create: `test/kill.test.js`
- Create: `src/main/kill.js`

- [ ] **Step 1: Write the failing test**

Create `test/kill.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { checkKillGuards } = require('../src/main/kill.js');

const base = { pid: 8823, processName: 'node', ownerUid: 503, currentUid: 503 };

test('a user-owned dev process passes the guards', () => {
  const result = checkKillGuards(base);
  assert.strictEqual(result.allowed, true);
  assert.strictEqual(result.reason, null);
});

test('a low pid is refused as a system process', () => {
  const result = checkKillGuards({ ...base, pid: 488 });
  assert.strictEqual(result.allowed, false);
  assert.match(result.reason, /system process/i);
});

test('a denylisted process is refused even with a high pid', () => {
  const result = checkKillGuards({ ...base, pid: 9000, processName: 'ControlCenter' });
  assert.strictEqual(result.allowed, false);
  assert.match(result.reason, /protected/i);
});

test('a process owned by another user is refused', () => {
  const result = checkKillGuards({ ...base, ownerUid: 0 });
  assert.strictEqual(result.allowed, false);
  assert.match(result.reason, /another user/i);
});

test('an unknown owner is allowed through so Windows can rely on EPERM', () => {
  const result = checkKillGuards({ ...base, ownerUid: null, currentUid: null });
  assert.strictEqual(result.allowed, true);
});

test('a non-integer pid is refused', () => {
  const result = checkKillGuards({ ...base, pid: Number.NaN });
  assert.strictEqual(result.allowed, false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/kill.test.js`
Expected: FAIL — `Cannot find module '../src/main/kill.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/main/kill.js`:

```js
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/kill.test.js`
Expected: PASS, 6 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/main/kill.js test/kill.test.js
git commit -m "[Add] guarded process termination refusing system and foreign processes"
```

---

## Task 8: Settings store

**Files:**
- Create: `test/store.test.js`
- Create: `src/main/store.js`

- [ ] **Step 1: Write the failing test**

Create `test/store.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createStore, DEFAULT_SETTINGS } = require('../src/main/store.js');

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'livewatcher-'));
  return path.join(dir, 'settings.json');
}

test('a fresh store returns the defaults', () => {
  const store = createStore({ filePath: tempFile() });
  assert.strictEqual(store.get('pollIntervalOpenMs'), DEFAULT_SETTINGS.pollIntervalOpenMs);
});

test('set persists a value that a new store instance reads back', () => {
  const filePath = tempFile();
  createStore({ filePath }).set('openAtLogin', false);

  assert.strictEqual(createStore({ filePath }).get('openAtLogin'), false);
});

test('unknown keys in the file do not clobber known defaults', () => {
  const filePath = tempFile();
  fs.writeFileSync(filePath, JSON.stringify({ somethingRemoved: 1 }));

  const store = createStore({ filePath });
  assert.strictEqual(store.get('probeTimeoutMs'), DEFAULT_SETTINGS.probeTimeoutMs);
});

test('a corrupted settings file falls back to defaults instead of throwing', () => {
  const filePath = tempFile();
  fs.writeFileSync(filePath, '{ this is not json');

  const store = createStore({ filePath });
  assert.deepStrictEqual(store.all(), DEFAULT_SETTINGS);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/store.test.js`
Expected: FAIL — `Cannot find module '../src/main/store.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/main/store.js`:

```js
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/store.test.js`
Expected: PASS, 4 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/main/store.js test/store.test.js
git commit -m "[Add] settings store with atomic writes and corruption fallback"
```

---

## Task 9: Uptime tracking and change detection

Keeps `firstSeenAt` per port so the panel can show uptime, and produces a cheap fingerprint so the poll loop only pushes IPC when something actually changed.

**Files:**
- Create: `test/state.test.js`
- Create: `src/main/state.js`

- [ ] **Step 1: Write the failing test**

Create `test/state.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { createTracker, snapshotFingerprint, formatUptime } = require('../src/main/state.js');

const entry = (port, pid = 100) => ({ port, pid, processName: 'node', kind: 'http', httpStatus: 200, title: null });

test('the first sighting of a port records its timestamp', () => {
  const tracker = createTracker();
  const [row] = tracker.update([entry(3000)], 1000);
  assert.strictEqual(row.firstSeenAt, 1000);
});

test('a port seen again keeps its original timestamp', () => {
  const tracker = createTracker();
  tracker.update([entry(3000)], 1000);
  const [row] = tracker.update([entry(3000)], 9000);
  assert.strictEqual(row.firstSeenAt, 1000);
});

test('a port that disappears and returns restarts its uptime', () => {
  const tracker = createTracker();
  tracker.update([entry(3000)], 1000);
  tracker.update([], 2000);
  const [row] = tracker.update([entry(3000)], 3000);
  assert.strictEqual(row.firstSeenAt, 3000);
});

test('the same port under a new pid restarts its uptime', () => {
  const tracker = createTracker();
  tracker.update([entry(3000, 100)], 1000);
  const [row] = tracker.update([entry(3000, 200)], 5000);
  assert.strictEqual(row.firstSeenAt, 5000);
});

test('the fingerprint is stable across reordering', () => {
  const a = snapshotFingerprint([entry(3000), entry(5173)]);
  const b = snapshotFingerprint([entry(5173), entry(3000)]);
  assert.strictEqual(a, b);
});

test('the fingerprint changes when a probe result changes', () => {
  const before = snapshotFingerprint([{ ...entry(3000), title: 'old' }]);
  const after = snapshotFingerprint([{ ...entry(3000), title: 'new' }]);
  assert.notStrictEqual(before, after);
});

test('formatUptime renders seconds, minutes, and hours', () => {
  assert.strictEqual(formatUptime(0), '0s');
  assert.strictEqual(formatUptime(45_000), '45s');
  assert.strictEqual(formatUptime(34 * 60_000), '34m');
  assert.strictEqual(formatUptime(2 * 3_600_000 + 14 * 60_000), '2h 14m');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/state.test.js`
Expected: FAIL — `Cannot find module '../src/main/state.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/main/state.js`:

```js
'use strict';

const keyOf = (entry) => `${entry.pid}:${entry.port}`;

function createTracker() {
  const firstSeen = new Map();

  return {
    update(entries, now = Date.now()) {
      const live = new Set();

      const rows = entries.map((entry) => {
        const key = keyOf(entry);
        live.add(key);
        if (!firstSeen.has(key)) firstSeen.set(key, now);
        return { ...entry, firstSeenAt: firstSeen.get(key) };
      });

      for (const key of firstSeen.keys()) {
        if (!live.has(key)) firstSeen.delete(key);
      }

      return rows;
    }
  };
}

function snapshotFingerprint(entries) {
  return entries
    .map((e) => [e.pid, e.port, e.kind, e.httpStatus, e.title, e.processName].join(''))
    .sort()
    .join('');
}

function formatUptime(elapsedMs) {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${totalSeconds}s`;
}

module.exports = { createTracker, snapshotFingerprint, formatUptime };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/state.test.js`
Expected: PASS, 7 tests, 0 failures.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS, 52 tests total across 8 files, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add src/main/state.js test/state.test.js
git commit -m "[Add] uptime tracker and snapshot fingerprint for change detection"
```

---

## Task 10: Tray icon and panel window

From here on the code runs inside Electron and is verified by running the app. There are no unit tests for these tasks — the verification steps say exactly what you must see.

**Files:**
- Create: `src/main/tray.js`
- Create: `src/renderer/index.html`
- Create: `src/main/index.js`

- [ ] **Step 1: Write the tray module**

Create `src/main/tray.js`. The icon is a 16×16 template PNG embedded as a data URL so the repository needs no binary asset; `setTemplateImage(true)` makes macOS recolour it for light and dark menu bars automatically.

```js
'use strict';

const path = require('node:path');
const { Tray, BrowserWindow, nativeImage, screen } = require('electron');

const PANEL_WIDTH = 360;
const PANEL_MAX_HEIGHT = 620;
const ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAYklEQVR42rVTsQ3AMAjzE/2mN/Kl76ALA7JoKwSx5IXEjkkIcBhXsC0yAATgQUbt1+wWoZKx5/XkLFZkkzKJfYjVxKpFiljj5zqr+N4wcG1jbDBuYeUSx884HqSVUV75TC08opdQxf5di+YAAAAASUVORK5CYII=';

function createPanel() {
  const panel = new BrowserWindow({
    width: PANEL_WIDTH,
    height: PANEL_MAX_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    fullscreenable: false,
    alwaysOnTop: true,
    transparent: process.platform === 'darwin',
    backgroundColor: process.platform === 'darwin' ? '#00000000' : '#1c1b19',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, '..', 'preload.js')
    }
  });

  panel.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  return panel;
}

function positionPanel(panel, trayBounds) {
  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
  const { width } = panel.getBounds();

  let x = Math.round(trayBounds.x + trayBounds.width / 2 - width / 2);
  x = Math.max(display.workArea.x + 8, Math.min(x, display.workArea.x + display.workArea.width - width - 8));

  const y = process.platform === 'darwin'
    ? Math.round(trayBounds.y + trayBounds.height + 4)
    : Math.round(display.workArea.y + display.workArea.height - panel.getBounds().height - 8);

  panel.setPosition(x, y, false);
}

function createTray({ onVisibilityChange }) {
  const icon = nativeImage.createFromDataURL(ICON_DATA_URL);
  icon.setTemplateImage(true);

  const tray = new Tray(icon);
  tray.setToolTip('LiveWatcher');

  const panel = createPanel();

  // A confirmation dialog steals focus from the panel, and hide-on-blur would
  // then tear the panel out from under its own dialog. The main process raises
  // this flag around any dialog it opens.
  let suppressHide = false;

  panel.on('blur', () => {
    if (!suppressHide) panel.hide();
  });

  const toggle = () => {
    if (panel.isVisible()) {
      panel.hide();
      return;
    }
    positionPanel(panel, tray.getBounds());
    panel.show();
    panel.focus();
  };

  tray.on('click', toggle);
  tray.on('right-click', toggle);
  panel.on('show', () => onVisibilityChange(true));
  panel.on('hide', () => onVisibilityChange(false));

  return {
    tray,
    panel,
    toggle,
    setSuppressHide: (value) => {
      suppressHide = value;
    }
  };
}

module.exports = { createTray, positionPanel, PANEL_WIDTH };
```

- [ ] **Step 2: Write a minimal panel page**

Create `src/renderer/index.html`. It gets its real content in Task 12; for now it only has to prove the window opens.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; script-src 'self';" />
    <title>LiveWatcher</title>
  </head>
  <body>
    <main id="app">Loading…</main>
  </body>
</html>
```

- [ ] **Step 3: Write the app entry point**

Create `src/main/index.js`:

```js
'use strict';

const { app } = require('electron');
const { createTray } = require('./tray.js');

let trayHandle = null;

if (process.platform === 'darwin' && app.dock) app.dock.hide();

app.whenReady().then(() => {
  trayHandle = createTray({ onVisibilityChange: () => {} });
});

// A tray app has no windows to keep alive, so the default quit-on-close is wrong.
app.on('window-all-closed', (event) => event.preventDefault());
```

- [ ] **Step 4: Run the app and verify**

Run: `npm start`
Expected, all four:
1. A small circular icon appears in the macOS menu bar.
2. No icon appears in the Dock.
3. Clicking the menu bar icon opens a 360px-wide panel directly under it reading "Loading…".
4. Clicking anywhere else hides the panel.

Press `Ctrl+C` in the terminal to quit.

- [ ] **Step 5: Commit**

```bash
git add src/main/index.js src/main/tray.js src/renderer/index.html
git commit -m "[Add] tray icon and frameless panel window with blur-to-hide"
```

---

## Task 11: IPC bridge and poll loop

Connects the pure modules from Tasks 2–9 to the window from Task 10.

**Files:**
- Create: `src/preload.js`
- Create: `src/main/ipc.js`
- Modify: `src/main/index.js` (full rewrite, shown below)

- [ ] **Step 1: Write the preload bridge**

Create `src/preload.js`. Only these seven channels cross the boundary; the renderer gets no other access.

```js
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('liveWatcher', {
  onSnapshot: (handler) => {
    ipcRenderer.on('snapshot', (_event, payload) => handler(payload));
  },
  refresh: () => ipcRenderer.send('refresh'),
  openPort: (port) => ipcRenderer.send('open-port', port),
  copyUrl: (port) => ipcRenderer.send('copy-url', port),
  stopServer: (payload) => ipcRenderer.invoke('stop-server', payload),
  setSetting: (key, value) => ipcRenderer.invoke('set-setting', { key, value }),
  quit: () => ipcRenderer.send('quit')
});
```

- [ ] **Step 2: Write the IPC handlers**

Create `src/main/ipc.js`:

```js
'use strict';

const { ipcMain, shell, clipboard, dialog, app } = require('electron');
const { checkKillGuards, getOwnerUid, terminate } = require('./kill.js');

function registerIpc({ panel, store, refreshNow, setSuppressHide }) {
  ipcMain.on('refresh', () => refreshNow());
  ipcMain.on('open-port', (_event, port) => shell.openExternal(`http://localhost:${port}`));
  ipcMain.on('copy-url', (_event, port) => clipboard.writeText(`http://localhost:${port}`));
  ipcMain.on('quit', () => app.quit());

  ipcMain.handle('set-setting', (_event, { key, value }) => {
    store.set(key, value);
    // Running from source would otherwise register the Electron binary itself
    // as a login item, which is never what the developer wants.
    if (key === 'openAtLogin' && app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: value, openAsHidden: true });
    }
    return store.all();
  });

  ipcMain.handle('stop-server', async (_event, { pid, port, processName }) => {
    const ownerUid = await getOwnerUid(pid);
    const currentUid = process.platform === 'win32' ? null : process.getuid();

    const guard = checkKillGuards({ pid, processName, ownerUid, currentUid });
    if (!guard.allowed) return { ok: false, reason: guard.reason };

    setSuppressHide(true);
    try {
      const confirmation = await dialog.showMessageBox(panel, {
        type: 'warning',
        buttons: ['Cancel', 'Stop server'],
        defaultId: 0,
        cancelId: 0,
        message: `Stop ${processName} on port ${port}?`,
        detail: `This sends SIGTERM to PID ${pid}. Unsaved work in that process will be lost.`
      });
      if (confirmation.response !== 1) return { ok: false, reason: null };

      const result = await terminate({ pid });
      if (!result.ok) return { ok: false, reason: result.reason };

      if (result.stillAlive) {
        const force = await dialog.showMessageBox(panel, {
          type: 'warning',
          buttons: ['Leave it running', 'Force kill'],
          defaultId: 0,
          cancelId: 0,
          message: `${processName} ignored the stop request.`,
          detail: 'Force killing sends SIGKILL, which gives the process no chance to clean up.'
        });
        if (force.response === 1) await terminate({ pid, force: true });
      }
    } finally {
      setSuppressHide(false);
    }

    refreshNow();
    return { ok: true, reason: null };
  });
}

module.exports = { registerIpc };
```

- [ ] **Step 3: Rewrite the entry point with the poll loop**

Replace the whole of `src/main/index.js`:

```js
'use strict';

const path = require('node:path');
const { app } = require('electron');

const { createTray } = require('./tray.js');
const { registerIpc } = require('./ipc.js');
const { createStore } = require('./store.js');
const { listPorts } = require('./scanner/index.js');
const { probeAll } = require('./probe.js');
const { classify } = require('./classify.js');
const { createTracker, snapshotFingerprint } = require('./state.js');

let panel = null;
let store = null;
let timer = null;
let panelVisible = false;
let lastFingerprint = null;
let lastPayload = { dev: [], other: [], error: null };

const tracker = createTracker();

async function collect() {
  const raw = await listPorts();
  const probes = await probeAll(raw.map((row) => row.port), {
    timeoutMs: store.get('probeTimeoutMs')
  });

  const enriched = raw.map((row) => ({ ...row, ...probes.get(row.port) }));
  const tracked = tracker.update(enriched);

  return classify(tracked, { devRanges: store.get('devRanges') });
}

async function refreshNow() {
  let payload;

  try {
    const { dev, other } = await collect();
    payload = { dev, other, error: null };
  } catch (error) {
    // Keep the previous list on screen rather than blanking it; a failed scan is
    // far more likely to be a transient lsof hiccup than every server vanishing.
    payload = { ...lastPayload, error: `Scan failed: ${error.message}` };
  }

  const fingerprint = snapshotFingerprint([...payload.dev, ...payload.other]) + String(payload.error);
  if (fingerprint === lastFingerprint) return;

  lastFingerprint = fingerprint;
  lastPayload = payload;

  if (panel && !panel.isDestroyed()) {
    panel.webContents.send('snapshot', { ...payload, settings: store.all(), now: Date.now() });
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

  const handle = createTray({
    onVisibilityChange: (visible) => {
      panelVisible = visible;
      rescheduleTimer();
      if (visible) refreshNow();
    }
  });
  panel = handle.panel;

  registerIpc({ panel, store, refreshNow, setSuppressHide: handle.setSuppressHide });

  panel.webContents.on('did-finish-load', refreshNow);
  rescheduleTimer();
  refreshNow();
});

app.on('window-all-closed', (event) => event.preventDefault());
```

- [ ] **Step 4: Verify the app still starts cleanly**

Run: `npm start`, then click the tray icon.

Expected: the app starts with no error dialog and no stack trace in the terminal, and the panel opens showing "Loading…". The placeholder text is correct at this stage — the renderer that consumes the snapshot is written in Task 12. Any `Error:` in the terminal means an IPC handler is misregistered or a module path is wrong; fix it before continuing.

- [ ] **Step 5: Verify the snapshot payload itself**

The panel cannot show the data yet, so check it from the main process instead. Run this one-off script, which exercises the exact same pipeline without Electron:

```bash
node -e "
const { listPorts } = require('./src/main/scanner/index.js');
const { probeAll } = require('./src/main/probe.js');
const { classify } = require('./src/main/classify.js');
listPorts().then(async (raw) => {
  const probes = await probeAll(raw.map((r) => r.port));
  const enriched = raw.map((r) => ({ ...r, ...probes.get(r.port) }));
  const { dev, other } = classify(enriched);
  console.table(dev.map((e) => ({ port: e.port, proc: e.processName, kind: e.kind, status: e.httpStatus, title: e.title })));
  console.log('other:', other.length);
});
"
```

Expected: a table of your real dev servers with `kind: 'http'` and a status code for anything serving web pages. Confirm `ControlCenter` is **not** in the dev table.

- [ ] **Step 6: Commit**

```bash
git add src/preload.js src/main/ipc.js src/main/index.js
git commit -m "[Add] IPC bridge and adaptive poll loop feeding snapshots to the panel"
```

---

## Task 12: Panel interface

**Files:**
- Modify: `src/renderer/index.html` (full rewrite)
- Create: `src/renderer/panel.css`
- Create: `src/renderer/panel.js`

- [ ] **Step 1: Rewrite the panel markup**

Replace the whole of `src/renderer/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'self'; script-src 'self';"
    />
    <link rel="stylesheet" href="panel.css" />
    <title>LiveWatcher</title>
  </head>
  <body>
    <header class="bar">
      <h1>LiveWatcher</h1>
      <span class="count" id="count"></span>
      <button class="icon-button" id="refresh" title="Refresh now" aria-label="Refresh now">&#8635;</button>
    </header>

    <p class="banner" id="banner" hidden></p>

    <ul class="list" id="dev-list"></ul>
    <p class="empty" id="empty" hidden>No local servers running.</p>

    <section class="other">
      <button class="other-toggle" id="other-toggle" aria-expanded="false">
        <span class="chevron" id="chevron">&#8250;</span>
        <span id="other-label">Other listening ports</span>
      </button>
      <ul class="list" id="other-list" hidden></ul>
    </section>

    <footer class="bar footer">
      <label class="toggle">
        <input type="checkbox" id="login" />
        <span>Launch at login</span>
      </label>
      <button class="text-button" id="quit">Quit</button>
    </footer>

    <script src="panel.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Write the stylesheet**

Create `src/renderer/panel.css`. Dark by default, following the reference screenshot; the light variant comes from `prefers-color-scheme`. No colour is pure `#000` or `#fff`.

```css
:root {
  --bg: #1c1b19;
  --surface: #262421;
  --surface-hover: #302d29;
  --text: #f0ede6;
  --muted: #a29b8f;
  --subtle: #6f675c;
  --border: #35322d;
  --live: #5ac47d;
  --warn: #e0a44a;
  --idle: #6f675c;
  --danger: #cf2d56;
  --radius: 8px;
}

@media (prefers-color-scheme: light) {
  :root {
    --bg: #f2f1ed;
    --surface: #e8e6e0;
    --surface-hover: #ddd9d1;
    --text: #26251e;
    --muted: #5f5a50;
    --subtle: #8b857a;
    --border: #d4d0c7;
    --live: #2f8f52;
    --warn: #a76f14;
    --idle: #8b857a;
  }
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 13px/1.4 -apple-system, "Segoe UI", system-ui, sans-serif;
  user-select: none;
  overflow: hidden auto;
  max-height: 620px;
}

.bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}

.bar h1 { margin: 0; font-size: 13px; font-weight: 600; letter-spacing: -0.1px; }
.count { margin-left: auto; color: var(--muted); font-size: 11px; }

.icon-button, .text-button {
  background: none;
  border: 0;
  color: var(--muted);
  cursor: pointer;
  border-radius: 6px;
  padding: 4px 6px;
  font-size: 13px;
  transition: background 150ms ease, color 150ms ease;
}

.icon-button:hover, .text-button:hover { background: var(--surface-hover); color: var(--text); }

.banner {
  margin: 0;
  padding: 8px 12px;
  background: color-mix(in srgb, var(--danger) 16%, var(--bg));
  color: var(--text);
  font-size: 11px;
  border-bottom: 1px solid var(--border);
}

.list { list-style: none; margin: 0; padding: 4px 0; }

.row {
  display: grid;
  grid-template-columns: 12px 1fr auto;
  align-items: start;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--radius);
  margin: 0 6px;
  transition: background 150ms ease;
}

/* Grid items default to min-width: auto, so the nowrap meta line refuses to
   shrink below its content and shoves the uptime column off the panel. */
.row > div { min-width: 0; }

.row:hover { background: var(--surface); }

.dot {
  width: 8px;
  height: 8px;
  margin-top: 5px;
  border-radius: 9999px;
  background: var(--idle);
}

.dot.live { background: var(--live); }
.dot.warn { background: var(--warn); }

.addr { font-size: 13px; font-weight: 500; letter-spacing: -0.1px; }
.meta {
  font-family: ui-monospace, "SF Mono", "JetBrains Mono", monospace;
  font-size: 11px;
  color: var(--muted);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.right { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
.uptime { font-family: ui-monospace, "SF Mono", monospace; font-size: 11px; color: var(--subtle); }

.actions { display: flex; gap: 2px; opacity: 0; transition: opacity 150ms ease; }
.row:hover .actions, .row:focus-within .actions { opacity: 1; }
.actions button.stop:hover { color: var(--danger); }

.other { border-top: 1px solid var(--border); }

.other-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: 0;
  color: var(--muted);
  cursor: pointer;
  padding: 8px 12px;
  font-size: 11px;
  text-align: left;
}

.other-toggle:hover { color: var(--text); }
.chevron { display: inline-block; transition: transform 150ms ease; }
.chevron.open { transform: rotate(90deg); }

.footer { border-bottom: 0; border-top: 1px solid var(--border); }
.toggle { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--muted); cursor: pointer; }
.footer .text-button { margin-left: auto; }

.empty { padding: 20px 12px; text-align: center; color: var(--subtle); font-size: 12px; }

@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; }
}
```

- [ ] **Step 3: Write the renderer script**

Create `src/renderer/panel.js`. `formatUptime` is duplicated here rather than imported because the sandboxed renderer cannot `require` from `src/main`; the copy is four lines and the main-process version stays the tested one.

```js
'use strict';

const dom = {
  count: document.getElementById('count'),
  banner: document.getElementById('banner'),
  devList: document.getElementById('dev-list'),
  otherList: document.getElementById('other-list'),
  otherToggle: document.getElementById('other-toggle'),
  otherLabel: document.getElementById('other-label'),
  chevron: document.getElementById('chevron'),
  empty: document.getElementById('empty'),
  refresh: document.getElementById('refresh'),
  login: document.getElementById('login'),
  quit: document.getElementById('quit')
};

let otherOpen = false;

function formatUptime(elapsedMs) {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${totalSeconds}s`;
}

function dotClass(entry) {
  if (entry.kind !== 'http') return 'warn';
  return entry.httpStatus >= 200 && entry.httpStatus < 400 ? 'live' : 'warn';
}

function metaLine(entry) {
  const parts = [];
  if (entry.title) parts.push(entry.title);
  if (entry.framework) parts.push(entry.framework);
  parts.push(`${entry.processName} (pid ${entry.pid})`);
  return parts.join(' · ');
}

function actionButton({ label, title, className, onClick }) {
  const button = document.createElement('button');
  button.className = `icon-button ${className}`;
  button.textContent = label;
  button.title = title;
  button.setAttribute('aria-label', title);
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

function buildRow(entry, now) {
  const row = document.createElement('li');
  row.className = 'row';

  const dot = document.createElement('span');
  dot.className = `dot ${dotClass(entry)}`;

  const middle = document.createElement('div');
  const addr = document.createElement('div');
  addr.className = 'addr';
  addr.textContent = `localhost:${entry.port}`;
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = metaLine(entry);
  middle.append(addr, meta);

  const right = document.createElement('div');
  right.className = 'right';
  const uptime = document.createElement('span');
  uptime.className = 'uptime';
  uptime.textContent = entry.kind === 'http' ? formatUptime(now - entry.firstSeenAt) : '—';

  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.append(
    actionButton({
      label: '↗',
      title: 'Open in browser',
      className: 'open',
      onClick: () => window.liveWatcher.openPort(entry.port)
    }),
    actionButton({
      label: '⧉',
      title: 'Copy URL',
      className: 'copy',
      onClick: () => window.liveWatcher.copyUrl(entry.port)
    }),
    actionButton({
      label: '■',
      title: 'Stop server',
      className: 'stop',
      onClick: async () => {
        const result = await window.liveWatcher.stopServer({
          pid: entry.pid,
          port: entry.port,
          processName: entry.processName
        });
        if (!result.ok && result.reason) showBanner(result.reason);
      }
    })
  );

  right.append(uptime, actions);
  row.append(dot, middle, right);
  row.addEventListener('dblclick', () => window.liveWatcher.openPort(entry.port));

  return row;
}

function showBanner(message) {
  dom.banner.textContent = message;
  dom.banner.hidden = false;
}

function render({ dev, other, error, settings, now }) {
  dom.banner.hidden = !error;
  if (error) dom.banner.textContent = error;

  dom.count.textContent = dev.length === 1 ? '1 live' : `${dev.length} live`;
  dom.empty.hidden = dev.length > 0;

  dom.devList.replaceChildren(...dev.map((entry) => buildRow(entry, now)));
  dom.otherList.replaceChildren(...other.map((entry) => buildRow(entry, now)));
  dom.otherLabel.textContent = `Other listening ports (${other.length})`;
  dom.login.checked = Boolean(settings.openAtLogin);
}

dom.otherToggle.addEventListener('click', () => {
  otherOpen = !otherOpen;
  dom.otherList.hidden = !otherOpen;
  dom.chevron.classList.toggle('open', otherOpen);
  dom.otherToggle.setAttribute('aria-expanded', String(otherOpen));
});

dom.refresh.addEventListener('click', () => window.liveWatcher.refresh());
dom.quit.addEventListener('click', () => window.liveWatcher.quit());
dom.login.addEventListener('change', () => {
  window.liveWatcher.setSetting('openAtLogin', dom.login.checked);
});

window.liveWatcher.onSnapshot(render);
```

- [ ] **Step 4: Run the app and verify the interface**

Start two servers in separate terminals so there is something real to look at:

```bash
python3 -m http.server 8000
```

Run: `npm start`, then click the tray icon. Expected, all six:
1. The panel lists `localhost:8000` with a green dot.
2. The header count reads at least "1 live".
3. Hovering a row reveals three buttons on the right; the uptime climbs on each refresh.
4. Clicking `↗` opens the server in the default browser.
5. Clicking `⧉` copies the URL — paste somewhere to confirm it reads `http://localhost:8000`.
6. Expanding "Other listening ports" reveals system ports, and `ControlCenter` on port 5000 appears **there**, not in the dev list.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/index.html src/renderer/panel.css src/renderer/panel.js
git commit -m "[Add] panel interface with live rows, hover actions, and collapsible other ports"
```

---

## Task 13: Verify the destructive path

No new code unless a defect surfaces. This task exists because the kill path is the one place the app can lose someone's work, and unit tests cannot prove the wiring is right.

- [ ] **Step 0: Confirm the panel stays open on a real tray click**

Programmatic verification during Task 10 found that `toggle()` — which calls `panel.show()` then `panel.focus()` — can be followed by an immediate real `blur`, hiding the panel instantly, when the app is not the frontmost application (as happens when launching from a terminal). Showing without `focus()` did not reproduce it, and the panel stayed visible when left idle, so this is likely an artifact of launching from a terminal rather than a defect.

Clicking the tray icon should make the app frontmost first, so this must be confirmed by hand: run `npm start`, click the tray icon, and leave the pointer still. The panel must stay open until you click elsewhere. If it vanishes on its own within a second, the fix is to call `app.focus({ steal: true })` before `panel.show()` in `toggle()`; add a note and re-verify.

- [ ] **Step 1: Start a disposable server**

Run in a separate terminal: `python3 -m http.server 8000`

- [ ] **Step 2: Stop it from the panel**

Run `npm start`, open the panel, hover the `localhost:8000` row, click `■`.
Expected: a confirmation dialog naming **port 8000**, the process name, and the PID. Click Cancel — the server must still be running.

- [ ] **Step 3: Confirm the stop**

Click `■` again, this time confirm.
Expected: the Python process exits, its terminal returns to a prompt, and the row disappears from the panel within 5 seconds.

- [ ] **Step 4: Verify a system process is refused**

Expand "Other listening ports", find a row owned by a system daemon such as `ControlCenter` or `rapportd`, click `■`.
Expected: **no confirmation dialog appears.** A red banner reads that the process is protected or the PID is a system process. The daemon keeps running.

- [ ] **Step 5: Record the result**

If every step behaved as described, commit nothing and move on. If any step failed, fix the defect, add a regression test to `test/kill.test.js` covering it, and commit with a `[Fix]` prefix.

---

## Task 14: Packaging and auto-start

**Files:**
- Modify: `package.json` (add the `build` block shown below)
- Create: `build/entitlements.mac.plist`

- [ ] **Step 1: Add the electron-builder configuration**

Add this top-level `"build"` key to `package.json`, alongside `"scripts"`. `LSUIElement` is what keeps the app out of the Dock in the packaged build — the `app.dock.hide()` call only covers `npm start`.

```json
"build": {
  "appId": "com.hue.livewatcher",
  "productName": "LiveWatcher",
  "files": ["src/**/*", "package.json"],
  "directories": { "output": "dist" },
  "mac": {
    "target": [{ "target": "dmg", "arch": ["arm64"] }],
    "category": "public.app-category.developer-tools",
    "extendInfo": { "LSUIElement": 1 }
  },
  "win": {
    "target": [{ "target": "nsis", "arch": ["x64"] }]
  },
  "nsis": {
    "oneClick": false,
    "allowToChangeInstallationDirectory": true
  }
}
```

- [ ] **Step 2: Build the macOS package**

Run: `npm run dist`
Expected: `dist/LiveWatcher-0.1.0-arm64.dmg` exists. The build is unsigned, which is fine for personal use.

- [ ] **Step 3: Install and verify auto-start**

Open the `.dmg`, drag `LiveWatcher.app` to `/Applications`, and launch it. Expected:
1. The tray icon appears; nothing appears in the Dock.
2. The panel lists real servers.
3. **System Settings → General → Login Items** lists LiveWatcher under "Open at Login".
4. Toggling "Launch at login" off in the panel removes it from that list; toggling it on puts it back.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "[Chore] add electron-builder config for dmg and nsis targets"
```

---

## Task 15: Documentation and session record

**Files:**
- Create: `README.md`
- Create: `docs/current-session.md`

- [ ] **Step 1: Write the README**

Create `README.md`:

````markdown
# LiveWatcher

A menu bar (macOS) and system tray (Windows) tool that lists the local servers
currently listening on this machine, and lets you open, copy, or stop each one.

## Development

```bash
npm install
npm start     # run from source
npm test      # unit tests (node --test)
npm run dist  # build the installer into dist/
```

## How it finds servers

`lsof -nP -iTCP -sTCP:LISTEN -F pcn` on macOS, `netstat -ano` joined with
`tasklist` on Windows. Each listening port is then probed over HTTP to read its
status code, page title, and framework header.

A port is shown as a dev server when it falls inside a configured dev range
(3000–3999, 5000–5999, 8000–8999, and others) **or** its process is a known dev
runtime — unless the process is a system daemon, which always sorts into "Other
listening ports". That last rule matters on stock macOS, where ControlCenter
binds ports 5000 and 7000 for AirPlay Receiver.

## Known limitations

- The Windows scanner is unit-tested against recorded fixtures but has not been
  run on a real Windows machine.
- Uptime counts from when LiveWatcher first saw the port, not from when the
  process actually started.
- There is no settings screen yet. Everything except "Launch at login" is edited
  by hand in `~/Library/Application Support/LiveWatcher/settings.json`
  (`%APPDATA%\LiveWatcher\settings.json` on Windows); restart the app after
  editing it.
````

- [ ] **Step 2: Write the session record**

Create `docs/current-session.md`:

```markdown
# Current session

**Preferred model:** claude-opus-5

**Project:** LiveWatcher — Electron tray tool listing live local servers.

**Status:** Tasks 1–15 of `docs/superpowers/plans/2026-08-13-livewatcher.md` complete.

**Open items:**
- Windows scanner unverified on real hardware (fixtures only).
- No settings UI; dev ranges and poll intervals are edited in settings.json.
- Up/down notifications deliberately deferred; would need debouncing against
  hot-reload restarts before they are useful.
```

- [ ] **Step 3: Run the full suite one last time**

Run: `npm test`
Expected: PASS, 52 tests, 0 failures.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/current-session.md
git commit -m "[Docs] add README and session record for LiveWatcher"
```

---

## Definition of done

- [ ] `npm test` passes with zero failures
- [ ] `npm start` shows real dev servers in the panel within 15 seconds of launching one
- [ ] A server started with `python3 -m http.server 8000` appears and, when stopped externally, disappears within 15 seconds
- [ ] Stopping a server from the panel prompts for confirmation and actually kills the process
- [ ] Stopping a system daemon is refused without a prompt
- [ ] `ControlCenter` on port 5000 appears under "Other listening ports", never as a dev server
- [ ] The packaged `.dmg` installs, runs with no Dock icon, and registers under Login Items
