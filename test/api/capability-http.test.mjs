import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { HttpError } from '../../app/lib/errors.mjs';
import { createRequestHandler } from '../../app/lib/http-app.mjs';

function memoryService() {
  return {
    async readiness() {
      return { ready: true, checks: { database: 'available', public_corpus: 'available' } };
    },
    async corpus() {
      return {};
    },
    async query() {
      return {};
    },
    async evidence() {
      return {};
    },
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
      return { count: 1, tasks: [{ task_key: 'public_demo_release' }] };
    },
    async recommend(taskKey) {
      return { task: { task_key: taskKey }, count: 0, recommendations: [] };
    },
    async search(query) {
      return { query: { text: query }, status: 'no_match', resolution: { kind: 'none' } };
    },
    async analytics() {
      return { total_assets: 9 };
    },
    ...overrides,
  };
}

async function startServer(t, service = capabilityService()) {
  const publicDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oam-capability-http-'));
  await fs.writeFile(path.join(publicDir, 'index.html'), '<!doctype html><title>Capability API</title>');
  const handler = createRequestHandler({
    memoryService: memoryService(),
    capabilityService: service,
    capabilityAssistService: {
      async assist(taskKey, request) {
        return {
          task: { task_key: taskKey },
          count: 1,
          recommendations: [{ asset_key: 'workflow:public_demo_release_v1' }],
          interaction: {
            status: 'fallback',
            authoritative: false,
            model: 'gpt-5.3-codex-spark',
            explanation: null,
            selected_asset_keys: ['workflow:public_demo_release_v1'],
            fallback_reason: 'unavailable',
          },
          request,
        };
      },
    },
    identityProofLoader: {
      async read() {
        return { schema_version: 1, proof_kind: 'four_plane_identity_enforcement', overall_status: 'PASS' };
      },
    },
    publicDir,
    bodyBytes: 512,
    taskKeyCharacters: 80,
    assistCharacters: 120,
    logger: { error() {} },
  });
  const server = http.createServer((req, res) => handler(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(publicDir, { recursive: true, force: true });
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test('public access-proof endpoint is read-only, bounded, and returns the sanitized loader projection', async (t) => {
  const baseUrl = await startServer(t);
  const response = await fetch(`${baseUrl}/api/public/access-proof`);
  const head = await fetch(`${baseUrl}/api/public/access-proof`, { method: 'HEAD' });
  const query = await fetch(`${baseUrl}/api/public/access-proof?path=/etc/shadow`);
  const mutation = await fetch(`${baseUrl}/api/public/access-proof`, { method: 'POST' });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    schema_version: 1,
    proof_kind: 'four_plane_identity_enforcement',
    overall_status: 'PASS',
  });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal(query.status, 400);
  assert.equal(mutation.status, 405);
  assert.equal(mutation.headers.get('allow'), 'GET, HEAD');
});

test('asset catalog accepts only the three bounded public filters', async (t) => {
  let receivedFilters;
  const baseUrl = await startServer(t, capabilityService({
    async assets(filters) {
      receivedFilters = filters;
      return { filters, count: 0, items: [] };
    },
  }));

  const valid = await fetch(
    `${baseUrl}/api/public/assets?type=workflow&capability_area=governance&review_status=approved`,
  );
  const scopeInjection = await fetch(`${baseUrl}/api/public/assets?corpus=internal_demo`);
  const duplicate = await fetch(`${baseUrl}/api/public/assets?type=workflow&type=agent`);
  const invalidType = await fetch(`${baseUrl}/api/public/assets?type=internal`);

  assert.equal(valid.status, 200);
  assert.deepEqual(receivedFilters, {
    type: 'workflow',
    capability_area: 'governance',
    review_status: 'approved',
  });
  assert.equal(scopeInjection.status, 400);
  assert.equal((await scopeInjection.json()).error.code, 'invalid_query_parameters');
  assert.equal(duplicate.status, 400);
  assert.equal(invalidType.status, 400);
  assert.equal((await invalidType.json()).error.code, 'invalid_asset_type');
});

test('capability search accepts exactly one bounded query and no client role or scope selectors', async (t) => {
  const received = [];
  const baseUrl = await startServer(t, capabilityService({
    async search(query) {
      received.push(query);
      return { query: { text: query }, status: 'no_match', resolution: { kind: 'none' } };
    },
  }));
  const post = (body) => fetch(`${baseUrl}/api/public/capability-search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  const valid = await post({ query: '  Find   a website handoff workflow.  ' });
  const clientRole = await post({ query: 'website handoff', consumer_role: 'architect' });
  const clientScope = await post({ query: 'website handoff', corpus: 'internal_demo' });
  const empty = await post({ query: '   ' });
  const oversized = await post({ query: 'x'.repeat(321) });
  const queryString = await fetch(`${baseUrl}/api/public/capability-search?tenant=private`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'website handoff' }),
  });

  assert.equal(valid.status, 200);
  assert.equal((await valid.json()).query.text, 'Find a website handoff workflow.');
  assert.equal(clientRole.status, 400);
  assert.equal((await clientRole.json()).error.code, 'invalid_capability_search_request');
  assert.equal(clientScope.status, 400);
  assert.equal(empty.status, 400);
  assert.equal(oversized.status, 400);
  assert.equal(queryString.status, 400);
  assert.deepEqual(received, ['Find a website handoff workflow.']);
});

test('asset detail decodes a bounded key and rejects path or scope injection', async (t) => {
  const baseUrl = await startServer(t);
  const assetKey = 'workflow:linkedin_comment_research_v2';

  const valid = await fetch(`${baseUrl}/api/public/assets/${encodeURIComponent(assetKey)}`);
  const pathInjection = await fetch(`${baseUrl}/api/public/assets/workflow%3Apublic%2Finternal`);
  const queryInjection = await fetch(
    `${baseUrl}/api/public/assets/${encodeURIComponent(assetKey)}?pack_key=internal`,
  );

  assert.equal(valid.status, 200);
  assert.equal((await valid.json()).asset.asset_key, assetKey);
  assert.equal(pathInjection.status, 400);
  assert.equal((await pathInjection.json()).error.code, 'invalid_asset_key');
  assert.equal(queryInjection.status, 400);
  assert.equal((await queryInjection.json()).error.code, 'invalid_query_parameters');
});

test('recommendation selection accepts exactly one bounded task_key', async (t) => {
  let calls = 0;
  const baseUrl = await startServer(t, capabilityService({
    async recommend(taskKey) {
      calls += 1;
      return { task: { task_key: taskKey }, count: 0, recommendations: [] };
    },
  }));
  const request = (body) => fetch(`${baseUrl}/api/public/recommendations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  const valid = await request({ task_key: 'public_demo_release' });
  const extraScope = await request({ task_key: 'public_demo_release', corpus: 'internal_demo' });
  const invalidKey = await request({ task_key: "public_demo' OR 1=1" });

  assert.equal(valid.status, 200);
  assert.equal((await valid.json()).task.task_key, 'public_demo_release');
  assert.equal(extraScope.status, 400);
  assert.equal((await extraScope.json()).error.code, 'invalid_recommendation_request');
  assert.equal(invalidKey.status, 400);
  assert.equal((await invalidKey.json()).error.code, 'invalid_task_key');
  assert.equal(calls, 1);
});

test('recommendation catalog, analytics, and readiness expose their bounded routes', async (t) => {
  const baseUrl = await startServer(t);

  const recommendationCatalog = await fetch(`${baseUrl}/api/public/recommendations`);
  const analytics = await fetch(`${baseUrl}/api/public/capability-analytics`);
  const analyticsInjection = await fetch(`${baseUrl}/api/public/capability-analytics?corpus=internal`);
  const readiness = await fetch(`${baseUrl}/api/readyz`);

  assert.equal(recommendationCatalog.status, 200);
  assert.equal((await recommendationCatalog.json()).tasks[0].task_key, 'public_demo_release');
  assert.equal(analytics.status, 200);
  assert.equal((await analytics.json()).total_assets, 9);
  assert.equal(analyticsInjection.status, 400);
  assert.equal(readiness.status, 200);
  assert.equal((await readiness.json()).checks.capability_pack, 'available');
});

test('unknown recommendation tasks preserve the public 404 contract', async (t) => {
  const baseUrl = await startServer(t, capabilityService({
    async recommend() {
      throw new HttpError(404, 'task_not_found', 'Recommendation task not found.');
    },
  }));
  const response = await fetch(`${baseUrl}/api/public/recommendations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ task_key: 'not_seeded' }),
  });

  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, 'task_not_found');
});

test('capability assist accepts only task_key and request and preserves fallback records', async (t) => {
  const baseUrl = await startServer(t);
  const post = (body) => fetch(`${baseUrl}/api/public/capability-assist`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  const valid = await post({
    task_key: 'public_demo_release',
    request: '  Adapt   this for a short release. ',
  });
  const result = await valid.json();
  const scopeInjection = await post({
    task_key: 'public_demo_release',
    request: 'Adapt it.',
    corpus: 'internal_demo',
  });
  const oversized = await post({
    task_key: 'public_demo_release',
    request: 'x'.repeat(121),
  });

  assert.equal(valid.status, 200);
  assert.equal(result.request, 'Adapt this for a short release.');
  assert.equal(result.interaction.status, 'fallback');
  assert.equal(result.recommendations[0].asset_key, 'workflow:public_demo_release_v1');
  assert.equal(scopeInjection.status, 400);
  assert.equal((await scopeInjection.json()).error.code, 'invalid_capability_assist_request');
  assert.equal(oversized.status, 400);
  assert.equal((await oversized.json()).error.code, 'assist_request_too_long');
});
