'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { parseLsof, parseAddress, parseCommandLines } = require('../src/main/scanner/darwin.js');

const FIXTURE = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'lsof-darwin.txt'),
  'utf8'
);
const PS_FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'ps-darwin.txt'), 'utf8');

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

test('parseCommandLines maps pid to full command including args', () => {
  const map = parseCommandLines(PS_FIXTURE);
  assert.strictEqual(
    map.get(6161),
    '/Users/hue/.agentmemory/bin/iii --config /Users/hue/.nvm/versions/node/v24.13.1/lib/node_modules/@agentmemory/agentmemory/dist/iii-config.yaml'
  );
  assert.strictEqual(map.get(591), 'node server.js');
});

test('parseCommandLines returns an empty map for empty input', () => {
  assert.strictEqual(parseCommandLines('').size, 0);
});
