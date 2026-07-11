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
      title: 'Research prompt',
      summary: 'Build a grounded research brief.',
      why_it_worked: 'It requires source evidence before generation.',
      evidence: { source_turns: [{ source_turn_id: 'st-001' }] },
    }],
  };
}

function generatedPlan(overrides = {}) {
  return {
    summary: 'Begin with the stored prompt.',
    steps: [{
      title: 'Inspect evidence',
      action: 'Use the grounded research brief as the starting point.',
      asset_keys: ['prompt:research_v2'],
      source_turn_ids: ['st-001'],
      requires_human_review: true,
    }],
    missing_context: [],
    limitations: ['This is a starting plan, not a completed task.'],
    ...overrides,
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
          plan: generatedPlan(),
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
  assert.equal(result.interaction.plan.steps[0].asset_keys[0], 'prompt:research_v2');
  assert.match(result.interaction.explanation, /assets: prompt:research_v2/);
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
  assert.equal(result.interaction.status, 'fallback');
  assert.equal(result.interaction.fallback_reason, 'unavailable');
  assert.deepEqual(result.interaction.selected_asset_keys, ['prompt:research_v2']);
  assert.deepEqual(result.interaction.plan.steps[0].asset_keys, ['prompt:research_v2']);
  assert.deepEqual(result.interaction.plan.steps[0].source_turn_ids, ['st-001']);
  assert.match(result.interaction.explanation, /deterministic plan/);
});

test('assist rejects an unsupported structured citation and falls back deterministically', async () => {
  const stored = selection();
  const service = createCapabilityAssistService({
    capabilityService: { async recommend() { return stored; } },
    codexClient: {
      async explain() {
        return {
          status: 'generated',
          model: 'gpt-5.3-codex-spark',
          plan: generatedPlan({
            steps: [{
              ...generatedPlan().steps[0],
              source_turn_ids: ['st-not-selected'],
            }],
          }),
        };
      },
    },
  });

  const result = await service.assist('research', 'Adapt it.');

  assert.equal(result.interaction.status, 'fallback');
  assert.equal(result.interaction.fallback_reason, 'invalid_response');
  assert.deepEqual(result.recommendations, stored.recommendations);
});

test('assist never exposes an arbitrary fallback reason from a client', async () => {
  const service = createCapabilityAssistService({
    capabilityService: { async recommend() { return selection(); } },
    codexClient: {
      async explain() {
        return { status: 'fallback', fallback_reason: 'secret internal auth path' };
      },
    },
  });

  const result = await service.assist('research', 'Adapt it.');
  assert.equal(result.interaction.fallback_reason, 'unavailable');
  assert.doesNotMatch(result.interaction.explanation, /secret|auth path/);
});
