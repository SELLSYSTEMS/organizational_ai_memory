import assert from 'node:assert/strict';
import test from 'node:test';
import { createCapabilityAssistService } from '../../app/lib/capability-assist-service.mjs';

function selection() {
  return {
    scope: { pack_key: 'public-pack' },
    task: { task_key: 'research', task_title: 'Research', reason: 'Stored reason.' },
    count: 1,
    recommendations: [{
      asset_key: 'prompt:research_v2',
      evidence: { source_turns: [{ source_turn_id: 'st-001' }] },
    }],
  };
}

test('assist appends generated prose without changing deterministic selection', async () => {
  const stored = selection();
  let request;
  const service = createCapabilityAssistService({
    capabilityService: { async recommend() { return stored; } },
    codexClient: {
      async explain(input) {
        request = input;
        return {
          status: 'generated',
          authoritative: false,
          model: 'gpt-5.3-codex-spark',
          explanation: 'Begin with the stored prompt.',
          selected_asset_keys: ['prompt:research_v2'],
          fallback_reason: null,
        };
      },
    },
  });

  const result = await service.assist('research', 'Adapt for a small account.');

  assert.deepEqual(result.scope, stored.scope);
  assert.deepEqual(result.task, stored.task);
  assert.deepEqual(result.recommendations, stored.recommendations);
  assert.equal(result.interaction.status, 'generated');
  assert.equal(request.recommendation.assets, stored.recommendations);
  assert.equal(request.recommendation.recommendation_reason, 'Stored reason.');
});

test('assist keeps the stored selection when generation throws', async () => {
  const stored = selection();
  const service = createCapabilityAssistService({
    capabilityService: { async recommend() { return stored; } },
    codexClient: { async explain() { throw new Error('auth failed with secret'); } },
  });

  const result = await service.assist('research', 'Adapt it.');

  assert.deepEqual(result.recommendations, stored.recommendations);
  assert.deepEqual(result.interaction, {
    status: 'fallback',
    authoritative: false,
    model: 'gpt-5.3-codex-spark',
    explanation: null,
    selected_asset_keys: ['prompt:research_v2'],
    fallback_reason: 'unavailable',
  });
});
