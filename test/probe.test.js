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
