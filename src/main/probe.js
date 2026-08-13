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
