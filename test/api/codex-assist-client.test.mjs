import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createCodexAssistClient } from '../../app/lib/codex-assist-client.mjs';

const recommendation = {
  assets: [{
    asset_key: 'workflow:task_start_v1',
    evidence: { source_turns: [{ source_turn_id: 'st-001' }] },
  }],
};

function validPlan(overrides = {}) {
  return {
    summary: 'Start with the selected workflow.',
    steps: [{
      title: 'Apply the workflow',
      action: 'Adapt the stored steps to the bounded request.',
      asset_keys: ['workflow:task_start_v1'],
      source_turn_ids: ['st-001'],
      requires_human_review: true,
    }],
    missing_context: [],
    limitations: [],
    ...overrides,
  };
}

test('disabled Spark client returns deterministic fallback metadata', async () => {
  const client = createCodexAssistClient({ enabled: false });
  const result = await client.explain({ taskKey: 'task', request: 'help', recommendation });

  assert.deepEqual(result, {
    status: 'fallback',
    authoritative: false,
    model: 'gpt-5.3-codex-spark',
    plan: null,
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
      plan: validPlan(),
      explanation: 'This sidecar string is not trusted.',
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
  assert.match(result.explanation, /assets: workflow:task_start_v1/);
  assert.equal(result.plan.summary, 'Start with the selected workflow.');
  assert.deepEqual(result.selected_asset_keys, ['workflow:task_start_v1']);
  assert.equal('ignored' in result, false);
});

test('Spark client rejects malformed and unsupported citations from the sidecar', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'oam-codex-client-invalid-'));
  const socketPath = path.join(directory, 'assist.sock');
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      status: 'generated',
      model: 'gpt-5.3-codex-spark',
      plan: validPlan({
        steps: [{
          ...validPlan().steps[0],
          action: 'Use workflow:not_selected_v1 instead.',
        }],
      }),
    }));
  });
  await new Promise((resolve) => server.listen(socketPath, resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });

  const client = createCodexAssistClient({ enabled: true, socketPath, timeoutMs: 1_000 });
  const result = await client.explain({ taskKey: 'task', request: 'help', recommendation });

  assert.equal(result.status, 'fallback');
  assert.equal(result.fallback_reason, 'invalid_response');
  assert.deepEqual(result.selected_asset_keys, ['workflow:task_start_v1']);
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
