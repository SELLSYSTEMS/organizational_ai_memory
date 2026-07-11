import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildSparkPrompt,
  CODEX_SPARK_MODEL,
  createCodexSparkRunner,
} from '../../app/lib/codex-spark-runner.mjs';

function selectedRecommendation() {
  return {
    assets: [{
      asset_key: 'workflow:task_start_v1',
      title: 'Task start workflow',
      evidence: { source_turns: [{ source_turn_id: 'st-001' }] },
    }],
  };
}

function validPlan() {
  return {
    summary: 'Start from the selected workflow.',
    steps: [{
      title: 'Apply the workflow',
      action: 'Adapt the stored sequence to the bounded request.',
      asset_keys: ['workflow:task_start_v1'],
      source_turn_ids: ['st-001'],
      requires_human_review: true,
    }],
    missing_context: [],
    limitations: [],
  };
}

function spawnWritingPayload(payload, capture) {
  return (binary, args, options) => {
    capture.binary = binary;
    capture.args = args;
    capture.options = options;
    const child = new EventEmitter();
    child.pid = 424242;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = {
      end(prompt) {
        capture.prompt = prompt;
        const outputPath = args[args.indexOf('--output-last-message') + 1];
        fs.writeFile(outputPath, JSON.stringify(payload), 'utf8')
          .then(() => child.emit('close', 0, null), (error) => child.emit('error', error));
      },
    };
    return child;
  };
}

test('checked-in Spark output schema uses the supported Responses schema subset', async () => {
  const schema = JSON.parse(await fs.readFile(
    new URL('../../deploy/codex/explanation.schema.json', import.meta.url),
    'utf8',
  ));
  const inspect = (value) => {
    if (!value || typeof value !== 'object') return;
    assert.equal('uniqueItems' in value, false);
    Object.values(value).forEach(inspect);
  };
  inspect(schema);
});

test('Spark prompt contains only the bounded selected asset projection', () => {
  const prompt = buildSparkPrompt({
    taskKey: 'prepare_lead_research',
    request: 'Adapt this for a small account.',
    recommendation: {
      recommendation_reason: 'The stored workflow fits this task.',
      private_tenant: 'must-not-leak',
      assets: [{
        asset_key: 'prompt:lead_research_brief_v2',
        asset_type: 'prompt',
        title: 'Lead research brief',
        summary: 'Build a concise research brief.',
        secret: 'must-not-leak',
        evidence: {
          source_turns: [{ source_turn_id: 'st-001', observation_id: 'obs-1', excerpt: 'Validated in a prior run.' }],
        },
      }],
    },
  });

  assert.equal(CODEX_SPARK_MODEL, 'gpt-5.3-codex-spark');
  assert.match(prompt, /prompt:lead_research_brief_v2/);
  assert.match(prompt, /st-001/);
  assert.match(prompt, /untrusted quoted data/);
  assert.doesNotMatch(prompt, /private_tenant|must-not-leak/);
});

test('Spark prompt caps assets and user-controlled text', () => {
  const prompt = buildSparkPrompt({
    taskKey: 'x'.repeat(200),
    request: 'y'.repeat(800),
    recommendation: {
      assets: Array.from({ length: 12 }, (_, index) => ({
        asset_key: `workflow:item_${index}`,
        summary: 'z'.repeat(900),
      })),
    },
  });
  const context = JSON.parse(prompt.match(/STORED CONTEXT: (.+)$/s)[1]);

  assert.equal([...context.task_key].length, 80);
  assert.equal(context.selected_assets.length, 9);
  assert.equal([...context.selected_assets[0].summary].length, 700);
  assert.equal([...prompt.match(/USER REQUEST: (.+)\n\nSTORED CONTEXT:/s)[1]].length, 500);
});

test('Spark runner fails before spawning when the isolated account is not authenticated', async () => {
  const runner = createCodexSparkRunner({
    workspace: '/tmp',
    schemaPath: '/tmp/schema.json',
    runtimeDirectory: '/tmp',
    authPath: '/tmp/oam-codex-missing-auth/auth.json',
    spawnImpl() {
      assert.fail('Codex must not spawn without an isolated auth file.');
    },
  });

  await assert.rejects(
    runner.explain({ taskKey: 'task', request: 'help', recommendation: { assets: [] } }),
    /codex_auth_unavailable/,
  );
});

test('Spark runner requests the pinned model and validates the structured output file', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'oam-spark-runner-'));
  const authPath = path.join(directory, 'auth.json');
  await fs.writeFile(authPath, '{}');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const capture = {};
  const runner = createCodexSparkRunner({
    workspace: directory,
    schemaPath: path.join(directory, 'schema.json'),
    runtimeDirectory: directory,
    authPath,
    spawnImpl: spawnWritingPayload(validPlan(), capture),
  });

  const result = await runner.explain({
    taskKey: 'task_start',
    request: 'Adapt it.',
    recommendation: selectedRecommendation(),
  });

  assert.equal(capture.args[capture.args.indexOf('-m') + 1], CODEX_SPARK_MODEL);
  assert.equal(capture.args[capture.args.indexOf('-s') + 1], 'read-only');
  assert.ok(capture.args.includes('--output-schema'));
  assert.ok(capture.args.includes('shell_tool'));
  assert.equal('PGPASSWORD' in capture.options.env, false);
  assert.match(capture.prompt, /STORED CONTEXT/);
  assert.equal(result.plan.steps[0].source_turn_ids[0], 'st-001');
  assert.match(result.explanation, /assets: workflow:task_start_v1/);
  assert.equal(
    (await fs.readdir(directory)).some((entry) => entry.startsWith('spark-')),
    false,
  );
});

test('Spark runner rejects and removes an output file with unsupported citations', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'oam-spark-runner-invalid-'));
  const authPath = path.join(directory, 'auth.json');
  await fs.writeFile(authPath, '{}');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const invalid = validPlan();
  invalid.steps[0].source_turn_ids = ['st-not-selected'];
  const runner = createCodexSparkRunner({
    workspace: directory,
    schemaPath: path.join(directory, 'schema.json'),
    runtimeDirectory: directory,
    authPath,
    spawnImpl: spawnWritingPayload(invalid, {}),
  });

  await assert.rejects(
    runner.explain({
      taskKey: 'task_start',
      request: 'Adapt it.',
      recommendation: selectedRecommendation(),
    }),
    /invalid_model_output/,
  );
  assert.equal(
    (await fs.readdir(directory)).some((entry) => entry.startsWith('spark-')),
    false,
  );
});
