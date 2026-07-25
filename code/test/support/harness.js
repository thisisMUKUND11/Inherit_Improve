/*
 * Test harness.
 *
 * Starts either system as a real child process on a real port and talks to it
 * over HTTP.
 *
 * Black box on purpose. The inherited code has no seams -- server.js opens a
 * database at import time and does everything else inside route handlers, so
 * there is nothing to inject and nothing to construct. That is the normal
 * situation when you take over a codebase, and it decides where the first
 * tests go: at the highest level you can afford, because it is the only level
 * that exists.
 *
 * The pay-off is that the same suite runs against both systems unchanged. A
 * contract test that only the new code can run proves nothing about the
 * migration.
 */
const { spawn } = require('node:child_process');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const TARGETS = ['legacy', 'refactored'];

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForReady(baseUrl, child, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no attempt made';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`process exited early (code ${child.exitCode})\n${child.stderrBuffer}`);
    }
    try {
      const res = await fetch(`${baseUrl}/api/products`);
      if (res.ok) return;
      lastError = `status ${res.status}`;
    } catch (err) {
      lastError = err.message;
    }
    await wait(100);
  }
  throw new Error(`${baseUrl} never became ready: ${lastError}\n${child.stderrBuffer}`);
}

/**
 * @param {'legacy'|'refactored'} target
 * @returns {Promise<object>} a client bound to a freshly seeded instance
 */
async function startTarget(target) {
  if (!TARGETS.includes(target)) throw new Error(`unknown target ${target}`);

  const port = await freePort();
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `orderdesk-${target}-`));
  const adminKey = target === 'legacy'
    ? 'orderdesk-admin-2019' // the committed one; that is the point
    : 'test-admin-key-that-is-at-least-32-chars';

  const entry = target === 'legacy'
    ? path.join(ROOT, 'code', 'legacy', 'server.js')
    : path.join(ROOT, 'code', 'refactored', 'src', 'main.js');

  const child = spawn(process.execPath, ['--experimental-sqlite', entry], {
    // The legacy app resolves its database path relative to the working
    // directory, because the path is hardcoded in config.json. Giving it a
    // temporary cwd is how you isolate a system that was not built to be.
    cwd: workDir,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      LOG_LEVEL: 'error',
      DATABASE_FILE: path.join(workDir, 'orderdesk.db'),
      ADMIN_API_KEY: adminKey,
      OUTBOX_POLL_MS: '150',
      OUTBOX_MAX_ATTEMPTS: '3',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stderrBuffer = '';
  child.stdout.on('data', () => {});
  child.stderr.on('data', (d) => { child.stderrBuffer += d.toString(); });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForReady(baseUrl, child);

  const request = async (method, pathname, body, headers = {}) => {
    const res = await fetch(baseUrl + pathname, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  };

  return {
    target,
    baseUrl,
    adminKey,
    workDir,

    get: (p, headers) => request('GET', p, undefined, headers),
    post: (p, body, headers) => request('POST', p, body, headers),

    products: async () => (await request('GET', '/api/products')).body,
    productById: async (id) => (await request('GET', '/api/products')).body.find((p) => p.id === id),
    quote: (body) => request('POST', '/api/quote', body),
    order: (body) => request('POST', '/api/orders', body),

    /** Admin access differs by design: query-string key vs header. */
    adminOrders: () => (target === 'legacy'
      ? request('GET', `/admin/orders?key=${adminKey}`)
      : request('GET', '/admin/orders', undefined, { 'x-admin-key': adminKey })),
    adminOutbox: () => request('GET', '/admin/outbox', undefined, { 'x-admin-key': adminKey }),

    async stop() {
      child.kill();
      await new Promise((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once('exit', resolve);
        setTimeout(resolve, 2000).unref();
      });
      try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* windows file locks */ }
    },
  };
}

/** Compare two money amounts as money: equal to the paise, float noise ignored. */
const asPaise = (n) => Math.round(Number(n) * 100);

module.exports = { startTarget, TARGETS, asPaise, ROOT, wait };
