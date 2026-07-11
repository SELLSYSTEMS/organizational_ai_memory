import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { createCodexSidecarServer } from '../../app/codex-sidecar.mjs';

async function startServer(t, runner) {
  const server = createCodexSidecarServer({ runner, logger: { error() {} } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('sidecar accepts only the fixed explain payload', async (t) => {
  let received;
  const baseUrl = await startServer(t, {
    async explain(input) {
      received = input;
      return { explanation: 'Use the selected stored assets.' };
    },
  });
  const response = await fetch(`${baseUrl}/v1/explain`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      task_key: 'prepare_research',
      request: 'Adapt for this account.',
      recommendation: { assets: [{ asset_key: 'prompt:research_v2' }] },
    }),
  });

  assert.equal(response.status, 200);
  assert.equal((await response.json()).model, 'gpt-5.3-codex-spark');
  assert.equal(received.taskKey, 'prepare_research');

  const injected = await fetch(`${baseUrl}/v1/explain`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      task_key: 'prepare_research',
      request: 'Adapt.',
      recommendation: { assets: [] },
      tenant_key: 'internal',
    }),
  });
  assert.equal(injected.status, 400);
});

test('sidecar uses the public API Unicode character contract', async (t) => {
  const baseUrl = await startServer(t, {
    async explain() {
      return { explanation: 'Accepted.' };
    },
  });
  const response = await fetch(`${baseUrl}/v1/explain`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      task_key: 'task',
      request: '\u{1F642}'.repeat(500),
      recommendation: { assets: [] },
    }),
  });

  assert.equal(response.status, 200);
});

test('sidecar reports generation failures without internal detail', async (t) => {
  const logged = [];
  const server = createCodexSidecarServer({
    logger: { error(message, metadata) { logged.push({ message, metadata }); } },
    runner: {
    async explain() {
      throw new Error('secret auth token and internal path');
    },
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${baseUrl}/v1/explain`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ task_key: 'task', request: 'help', recommendation: { assets: [] } }),
  });
  const body = await response.text();

  assert.equal(response.status, 503);
  assert.match(body, /unavailable/);
  assert.doesNotMatch(body, /secret|token|internal path/);
  assert.deepEqual(logged[0].metadata, { error_code: 'codex_failed' });
  assert.doesNotMatch(JSON.stringify(logged), /secret|token|internal path/);
});

test('sidecar enforces a global generation budget below the Unix socket', async (t) => {
  let calls = 0;
  const server = createCodexSidecarServer({
    runner: { async explain() { calls += 1; return { explanation: 'Accepted.' }; } },
    globalGenerationsPerMinute: 1,
    logger: { error() {} },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const options = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ task_key: 'task', request: 'help', recommendation: { assets: [] } }),
  };

  const first = await fetch(`${baseUrl}/v1/explain`, options);
  const second = await fetch(`${baseUrl}/v1/explain`, options);

  assert.equal(first.status, 200);
  assert.equal(second.status, 503);
  assert.equal((await second.json()).error.code, 'budget_exhausted');
  assert.equal(calls, 1);
});

test('sidecar permits only one concurrent Spark invocation', async (t) => {
  let release;
  let calls = 0;
  const waiting = new Promise((resolve) => { release = resolve; });
  const baseUrl = await startServer(t, {
    async explain() {
      calls += 1;
      await waiting;
      return { explanation: 'Finished.' };
    },
  });
  const options = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ task_key: 'task', request: 'help', recommendation: { assets: [] } }),
  };

  const first = fetch(`${baseUrl}/v1/explain`, options);
  while (calls === 0) await new Promise((resolve) => setTimeout(resolve, 1));
  const second = await fetch(`${baseUrl}/v1/explain`, options);
  release();
  const firstResponse = await first;

  assert.equal(firstResponse.status, 200);
  assert.equal(second.status, 503);
  assert.equal((await second.json()).error.code, 'busy');
  assert.equal(calls, 1);
});

test('sidecar reserves the Spark slot after concurrently streamed bodies finish', async (t) => {
  let release;
  let calls = 0;
  const waiting = new Promise((resolve) => { release = resolve; });
  const baseUrl = await startServer(t, {
    async explain() {
      calls += 1;
      await waiting;
      return { explanation: 'Finished.' };
    },
  });
  const url = new URL('/v1/explain', baseUrl);
  const openRequest = () => {
    let resolveResponse;
    const response = new Promise((resolve) => { resolveResponse = resolve; });
    const req = http.request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    }, resolveResponse);
    req.write('{"task_key":"task","request":"help","recommendation":{"assets":');
    return { req, response };
  };

  const first = openRequest();
  const second = openRequest();
  first.req.end('[]}}');
  second.req.end('[]}}');
  while (calls === 0) await new Promise((resolve) => setTimeout(resolve, 1));

  const earlyResponses = await Promise.race([
    Promise.all([first.response, second.response]),
    new Promise((resolve) => setTimeout(() => resolve(null), 20)),
  ]);
  assert.equal(earlyResponses, null);
  release();
  const responses = await Promise.all([first.response, second.response]);
  const statuses = responses.map((response) => response.statusCode).sort();
  responses.forEach((response) => response.resume());

  assert.deepEqual(statuses, [200, 503]);
  assert.equal(calls, 1);
});
