import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSparkPrompt, CODEX_SPARK_MODEL } from '../../app/lib/codex-spark-runner.mjs';

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
  const { createCodexSparkRunner } = await import('../../app/lib/codex-spark-runner.mjs');
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
