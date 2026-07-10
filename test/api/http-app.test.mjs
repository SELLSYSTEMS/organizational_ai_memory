import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequestHandler } from '../../app/lib/http-app.mjs';
import { FixedWindowRateLimiter } from '../../app/lib/rate-limiter.mjs';

function memoryService(overrides = {}) {
  return {
    async readiness() {
      return { ready: true, checks: { database: 'available', public_corpus: 'available' } };
    },
    async corpus() {
      return { counts: { facts: 10 } };
    },
    async query(query) {
      return { query, status: 'grounded', answer: 'Grounded.', retrieved_context: { facts: [] } };
    },
    async evidence(type) {
      return { filter: { type }, count: 0, items: [] };
    },
    ...overrides,
  };
}

function capabilityService(overrides = {}) {
  return {
    async readiness() {
      return true;
    },
    async assets(filters) {
      return { filters, count: 0, items: [] };
    },
    async asset(assetKey) {
      return { asset: { asset_key: assetKey } };
    },
    async recommendations() {
      return { count: 0, tasks: [] };
    },
    async recommend(taskKey) {
      return { task: { task_key: taskKey }, count: 0, recommendations: [] };
    },
    async analytics() {
      return { total_assets: 0 };
    },
    ...overrides,
  };
}

async function startTestServer(t, options = {}) {
  const publicDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oam-http-test-'));
  await fs.writeFile(path.join(publicDir, 'index.html'), '<!doctype html><title>OAM test</title>');
  await fs.writeFile(path.join(publicDir, 'app.js'), 'globalThis.loaded = true;');
  await fs.writeFile(path.join(publicDir, '.env'), 'SHOULD_NOT_BE_SERVED');

  const handler = createRequestHandler({
    memoryService: options.memoryService || memoryService(),
    capabilityService: options.capabilityService || capabilityService(),
    capabilityAssistService: options.capabilityAssistService || {
      async assist(taskKey, request) {
        return { task: { task_key: taskKey }, request, interaction: { status: 'fallback' } };
      },
    },
    publicDir,
    bodyBytes: options.bodyBytes || 256,
    queryCharacters: options.queryCharacters || 40,
    assistCharacters: options.assistCharacters || 40,
    publicReadsPerMinute: options.publicReadsPerMinute || 20,
    publicQueriesPerMinute: options.publicQueriesPerMinute || 20,
    publicGenerationsPerMinute: options.publicGenerationsPerMinute || 6,
    rateLimiter: options.rateLimiter || new FixedWindowRateLimiter(),
    logger: { error() {} },
  });
  const server = http.createServer((req, res) => handler(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(publicDir, { recursive: true, force: true });
  });
  return `http://127.0.0.1:${address.port}`;
}

test('health and readiness use JSON security headers', async (t) => {
  const baseUrl = await startTestServer(t);
  const health = await fetch(`${baseUrl}/api/healthz`);
  const ready = await fetch(`${baseUrl}/api/readyz`);

  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, 'ok');
  assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
  assert.match(health.headers.get('content-security-policy'), /default-src 'none'/);
  assert.equal(ready.status, 200);
  assert.equal((await ready.json()).status, 'ready');
});

test('query accepts only a bounded JSON object containing query', async (t) => {
  let called = 0;
  const baseUrl = await startTestServer(t, {
    memoryService: memoryService({
      async query(query) {
        called += 1;
        return { query, status: 'grounded', answer: 'Grounded.' };
      },
    }),
  });
  const valid = await fetch(`${baseUrl}/api/public/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: '  current   budget  ' }),
  });
  const extraScope = await fetch(`${baseUrl}/api/public/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'budget', thread_key: 'private-thread' }),
  });
  const tooLong = await fetch(`${baseUrl}/api/public/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'x'.repeat(41) }),
  });

  assert.equal(valid.status, 200);
  assert.equal((await valid.json()).query, 'current budget');
  assert.equal(extraScope.status, 400);
  assert.equal((await extraScope.json()).error.code, 'invalid_query_request');
  assert.equal(tooLong.status, 400);
  assert.equal((await tooLong.json()).error.code, 'query_too_long');
  assert.equal(called, 1);
});

test('oversized and non-JSON request bodies are rejected before retrieval', async (t) => {
  const baseUrl = await startTestServer(t, { bodyBytes: 64 });
  const oversized = await fetch(`${baseUrl}/api/public/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'x'.repeat(100) }),
  });
  const unsupported = await fetch(`${baseUrl}/api/public/query`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: 'budget',
  });

  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).error.code, 'request_body_too_large');
  assert.equal(unsupported.status, 415);
  assert.equal((await unsupported.json()).error.code, 'unsupported_media_type');
});

test('evidence supports only the enumerated type filter', async (t) => {
  const baseUrl = await startTestServer(t);
  const valid = await fetch(`${baseUrl}/api/public/evidence?type=fact`);
  const invalid = await fetch(`${baseUrl}/api/public/evidence?type=internal`);
  const injectedScope = await fetch(`${baseUrl}/api/public/evidence?type=fact&thread=private`);

  assert.equal(valid.status, 200);
  assert.deepEqual((await valid.json()).filter, { type: 'fact' });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, 'invalid_evidence_type');
  assert.equal(injectedScope.status, 400);
  assert.equal((await injectedScope.json()).error.code, 'invalid_query_parameters');
});

test('rate limiting returns a bounded JSON error and retry metadata', async (t) => {
  const baseUrl = await startTestServer(t, { publicQueriesPerMinute: 1 });
  const options = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'budget' }),
  };
  const first = await fetch(`${baseUrl}/api/public/query`, options);
  const second = await fetch(`${baseUrl}/api/public/query`, options);

  assert.equal(first.status, 200);
  assert.equal(first.headers.get('ratelimit-remaining'), '0');
  assert.equal(second.status, 429);
  assert.equal((await second.json()).error.code, 'rate_limited');
  assert.ok(Number(second.headers.get('retry-after')) >= 1);
});

test('database errors are never included in public responses', async (t) => {
  const baseUrl = await startTestServer(t, {
    memoryService: memoryService({
      async query() {
        throw new Error('postgres password=super-secret internal_demo row');
      },
    }),
  });
  const response = await fetch(`${baseUrl}/api/public/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'budget' }),
  });
  const body = await response.text();

  assert.equal(response.status, 503);
  assert.match(body, /service_unavailable/);
  assert.doesNotMatch(body, /super-secret|internal_demo|postgres password/);
});

test('static serving uses explicit SPA fallbacks and blocks dotfiles', async (t) => {
  const baseUrl = await startTestServer(t);
  const demo = await fetch(`${baseUrl}/demo`);
  const assetsPage = await fetch(`${baseUrl}/assets`);
  const asset = await fetch(`${baseUrl}/app.js`);
  const unknown = await fetch(`${baseUrl}/not-a-route`);
  const dotfile = await fetch(`${baseUrl}/.env`);
  const unknownApi = await fetch(`${baseUrl}/api/private/memory`);

  assert.equal(demo.status, 200);
  assert.match(await demo.text(), /OAM test/);
  assert.equal(assetsPage.status, 200);
  assert.match(await assetsPage.text(), /OAM test/);
  assert.equal(demo.headers.get('x-frame-options'), 'DENY');
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type'), /text\/javascript/);
  assert.equal(unknown.status, 404);
  assert.equal(dotfile.status, 404);
  assert.equal(unknownApi.status, 404);
  assert.equal((await unknownApi.json()).error.code, 'api_route_not_found');
});

test('wrong methods return 405 with an Allow header', async (t) => {
  const baseUrl = await startTestServer(t);
  const response = await fetch(`${baseUrl}/api/public/query`);

  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'POST');
  assert.equal((await response.json()).error.code, 'method_not_allowed');
});
