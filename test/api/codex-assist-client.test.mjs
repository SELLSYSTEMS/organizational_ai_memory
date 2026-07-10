import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createCodexAssistClient } from '../../app/lib/codex-assist-client.mjs';

const recommendation = {
  assets: [{ asset_key: 'workflow:task_start_v1' }],
};

test('disabled Spark client returns deterministic fallback metadata', async () => {
  const client = createCodexAssistClient({ enabled: false });
  const result = await client.explain({ taskKey: 'task', request: 'help', recommendation });

  assert.deepEqual(result, {
    status: 'fallback',
    authoritative: false,
    model: 'gpt-5.3-codex-spark',
    explanation: null,
    selected_asset_keys: ['workflow:task_start_v1'],
    fallback_reason: 'disabled',
  });
});

test('Spark client accepts only the bounded sidecar response contract', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'oam-codex-client-'));
  const socketPath = path.join(directory, 'assist.sock');
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      status: 'generated',
      model: 'gpt-5.3-codex-spark',
      explanation: 'Start with the stored workflow.',
      ignored: 'not propagated',
    }));
  });
  await new Promise((resolve) => server.listen(socketPath, resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });

  const client = createCodexAssistClient({ enabled: true, socketPath, timeoutMs: 1_000 });
  const result = await client.explain({ taskKey: 'task', request: 'help', recommendation });

  assert.equal(result.status, 'generated');
  assert.equal(result.authoritative, false);
  assert.equal(result.explanation, 'Start with the stored workflow.');
  assert.deepEqual(result.selected_asset_keys, ['workflow:task_start_v1']);
  assert.equal('ignored' in result, false);
});

test('Spark client fails closed without changing selected records', async () => {
  const client = createCodexAssistClient({
    enabled: true,
    socketPath: '/tmp/does-not-exist/oam-codex.sock',
    timeoutMs: 50,
  });
  const result = await client.explain({ taskKey: 'task', request: 'help', recommendation });

  assert.equal(result.status, 'fallback');
  assert.equal(result.fallback_reason, 'unavailable');
  assert.deepEqual(result.selected_asset_keys, ['workflow:task_start_v1']);
});
