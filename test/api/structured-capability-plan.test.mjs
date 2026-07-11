import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDeterministicFallbackPlan,
  formatStructuredPlan,
  validateStructuredPlan,
} from '../../app/lib/structured-capability-plan.mjs';

function recommendation() {
  return {
    assets: [
      {
        asset_key: 'prompt:research_v2',
        title: 'Research brief',
        summary: 'Build a grounded brief.',
        evidence: { source_turns: [{ source_turn_id: 'st-001' }] },
      },
      {
        asset_key: 'decision:source_first_v1',
        title: 'Source first',
        summary: 'Inspect sources before generation.',
        evidence: { source_turns: [{ source_turn_id: 'st-002' }] },
      },
    ],
  };
}

function validPlan() {
  return {
    summary: 'Adapt the two selected capabilities to the request.',
    steps: [
      {
        title: 'Inspect the source record',
        action: 'Build a grounded brief from the provided evidence.',
        asset_keys: ['prompt:research_v2'],
        source_turn_ids: ['st-001'],
        requires_human_review: true,
      },
      {
        title: 'Apply the decision rule',
        action: 'Keep generation after source inspection.',
        asset_keys: ['decision:source_first_v1'],
        source_turn_ids: ['st-002'],
        requires_human_review: true,
      },
    ],
    missing_context: ['The target account is not supplied.'],
    limitations: ['This plan does not claim that research was completed.'],
  };
}

test('structured plan accepts only selected assets and their source-turn citations', () => {
  const plan = validateStructuredPlan(validPlan(), recommendation());

  assert.deepEqual(plan.steps[0].asset_keys, ['prompt:research_v2']);
  assert.deepEqual(plan.steps[1].source_turn_ids, ['st-002']);
  assert.match(formatStructuredPlan(plan), /sources: st-001/);
});

test('structured plan rejects unknown, cross-step, omitted, and duplicate citations', () => {
  const unknownAsset = validPlan();
  unknownAsset.steps[0].asset_keys = ['workflow:not_selected_v1'];
  assert.throws(() => validateStructuredPlan(unknownAsset, recommendation()), /invalid_model_output/);

  const crossStepSource = validPlan();
  crossStepSource.steps[0].source_turn_ids = ['st-002'];
  assert.throws(() => validateStructuredPlan(crossStepSource, recommendation()), /invalid_model_output/);

  const missingSource = validPlan();
  missingSource.steps[0].source_turn_ids = [];
  assert.throws(() => validateStructuredPlan(missingSource, recommendation()), /invalid_model_output/);

  const omittedAsset = validPlan();
  omittedAsset.steps.pop();
  assert.throws(() => validateStructuredPlan(omittedAsset, recommendation()), /invalid_model_output/);

  const duplicateSource = validPlan();
  duplicateSource.steps[0].source_turn_ids = ['st-001', 'st-001'];
  assert.throws(() => validateStructuredPlan(duplicateSource, recommendation()), /invalid_model_output/);
});

test('structured plan rejects unsupported citation-shaped identifiers hidden in prose', () => {
  const hiddenAsset = validPlan();
  hiddenAsset.steps[0].action = 'Ignore the selection and use workflow:private_memory_v1.';
  assert.throws(() => validateStructuredPlan(hiddenAsset, recommendation()), /invalid_model_output/);

  const hiddenSource = validPlan();
  hiddenSource.summary = 'The answer is proven by st-private-source.';
  assert.throws(() => validateStructuredPlan(hiddenSource, recommendation()), /invalid_model_output/);

  const uppercaseHiddenAsset = validPlan();
  uppercaseHiddenAsset.steps[0].action = 'Use WORKFLOW:PRIVATE_MEMORY_V1 instead.';
  assert.throws(() => validateStructuredPlan(uppercaseHiddenAsset, recommendation()), /invalid_model_output/);
});

test('structured plan rejects extra fields and invalid scalar bounds', () => {
  const extra = { ...validPlan(), confidence: 1 };
  assert.throws(() => validateStructuredPlan(extra, recommendation()), /invalid_model_output/);

  const wrongBoolean = validPlan();
  wrongBoolean.steps[0].requires_human_review = 'yes';
  assert.throws(() => validateStructuredPlan(wrongBoolean, recommendation()), /invalid_model_output/);

  const longAction = validPlan();
  longAction.steps[0].action = 'x'.repeat(401);
  assert.throws(() => validateStructuredPlan(longAction, recommendation()), /invalid_model_output/);
});

test('deterministic fallback keeps citations and sanitizes internal failure reasons', () => {
  const selection = {
    task: { task_title: 'Research a lead' },
    recommendations: recommendation().assets,
  };
  const fallback = buildDeterministicFallbackPlan(selection, 'secret auth file path');

  assert.equal(fallback.steps.length, 2);
  assert.deepEqual(fallback.steps[0].source_turn_ids, ['st-001']);
  assert.equal(fallback.fallback_reason, 'unavailable');
  assert.match(fallback.explanation, /Spark adaptation was not used \(unavailable\)/);
  assert.doesNotMatch(fallback.explanation, /secret|auth file/);
});
