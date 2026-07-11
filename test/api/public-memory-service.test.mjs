import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildEvidence,
  buildPublicSnapshot,
  retrievePublicMemory,
} from '../../app/lib/public-memory-service.mjs';

function rawFixture() {
  return {
    thread: {
      id: 'thread-id',
      thread_key: 'oam_public_demo_v1',
      title: 'Public demo',
      scope_kind: 'project_memory',
      source_system: 'public_safe_synthetic_demo',
      language_code: 'en',
      description: 'Public-safe fixture.',
      review_status: 'approved_for_public_demo',
      source_classification: 'public_safe',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-02-01T00:00:00Z',
    },
    turns: [
      {
        id: 'turn-old-id',
        source_turn_id: 'turn-old',
        actor_role: 'client',
        actor_key: 'team:demo',
        turn_kind: 'message',
        sent_at: '2026-01-01T00:00:00Z',
        text: 'The initial budget is 3000 USD per month.',
      },
      {
        id: 'turn-new-id',
        source_turn_id: 'turn-new',
        actor_role: 'client',
        actor_key: 'team:demo',
        turn_kind: 'message',
        sent_at: '2026-02-01T00:00:00Z',
        text: 'The budget is now 4500 USD per month.',
      },
      {
        id: 'turn-deadline-old-id',
        source_turn_id: 'turn-deadline-old',
        actor_role: 'client',
        actor_key: 'team:demo',
        turn_kind: 'message',
        sent_at: '2026-01-02T00:00:00Z',
        text: 'The initial target date is August 15, 2026.',
      },
      {
        id: 'turn-deadline-id',
        source_turn_id: 'turn-deadline',
        actor_role: 'client',
        actor_key: 'team:demo',
        turn_kind: 'message',
        sent_at: '2026-02-02T00:00:00Z',
        text: 'The target date is August 29, 2026.',
      },
    ],
    observations: [
      {
        id: 'observation-old-id',
        observation_key: 'observation:budget:old',
        observation_kind: 'budget_fact',
        subject_key: 'project:demo',
        actor_key: 'team:demo',
        observed_at: '2026-01-01T00:00:00Z',
        salience: '0.94',
        confidence: '0.92',
        observation_text: 'Budget stated: 3000 USD per month.',
        source_turn_ids: ['turn-old'],
        review_status: 'auto_curated',
      },
      {
        id: 'observation-new-id',
        observation_key: 'observation:budget:new',
        observation_kind: 'budget_fact',
        subject_key: 'project:demo',
        actor_key: 'team:demo',
        observed_at: '2026-02-01T00:00:00Z',
        salience: '0.94',
        confidence: '0.92',
        observation_text: 'Budget stated: 4500 USD per month.',
        source_turn_ids: ['turn-new'],
        review_status: 'auto_curated',
      },
      {
        id: 'observation-deadline-old-id',
        observation_key: 'observation:deadline:old',
        observation_kind: 'deadline_fact',
        subject_key: 'project:demo',
        actor_key: 'team:demo',
        observed_at: '2026-01-02T00:00:00Z',
        salience: '0.86',
        confidence: '0.85',
        observation_text: 'Requested deadline: August 15, 2026.',
        source_turn_ids: ['turn-deadline-old'],
        review_status: 'auto_curated',
      },
      {
        id: 'observation-deadline-id',
        observation_key: 'observation:deadline:new',
        observation_kind: 'deadline_fact',
        subject_key: 'project:demo',
        actor_key: 'team:demo',
        observed_at: '2026-02-02T00:00:00Z',
        salience: '0.86',
        confidence: '0.85',
        observation_text: 'Requested deadline: August 29, 2026.',
        source_turn_ids: ['turn-deadline'],
        review_status: 'auto_curated',
      },
    ],
    facts: [
      {
        id: 'fact-budget-old-id',
        fact_key: 'fact:budget:old',
        subject_key: 'project:demo',
        predicate: 'budget',
        object_value: '3000 USD per month',
        object_payload: { amount: '3000', currency: 'USD' },
        confidence: '0.92',
        provenance_kind: 'observation_derived',
        source_turn_ids: ['turn-old'],
        source_observation_ids: ['observation-old-id'],
        review_status: 'auto_curated',
        valid_from: '2026-01-01T00:00:00Z',
        valid_to: '2026-02-01T00:00:00Z',
        superseded_by_fact_id: 'fact-budget-new-id',
        is_current: false,
      },
      {
        id: 'fact-budget-new-id',
        fact_key: 'fact:budget:new',
        subject_key: 'project:demo',
        predicate: 'budget',
        object_value: '4500 USD per month',
        object_payload: { amount: '4500', currency: 'USD' },
        confidence: '0.92',
        provenance_kind: 'observation_derived',
        source_turn_ids: ['turn-new'],
        source_observation_ids: ['observation-new-id'],
        review_status: 'auto_curated',
        valid_from: '2026-02-01T00:00:00Z',
        valid_to: null,
        superseded_by_fact_id: null,
        is_current: true,
      },
      {
        id: 'fact-deadline-old-id',
        fact_key: 'fact:deadline:old',
        subject_key: 'project:demo',
        predicate: 'desired_deadline',
        object_value: 'August 15, 2026',
        object_payload: {},
        confidence: '0.85',
        provenance_kind: 'observation_derived',
        source_turn_ids: ['turn-deadline-old'],
        source_observation_ids: ['observation-deadline-old-id'],
        review_status: 'auto_curated',
        valid_from: '2026-01-02T00:00:00Z',
        valid_to: '2026-02-02T00:00:00Z',
        superseded_by_fact_id: 'fact-deadline-id',
        is_current: false,
      },
      {
        id: 'fact-deadline-id',
        fact_key: 'fact:deadline:new',
        subject_key: 'project:demo',
        predicate: 'desired_deadline',
        object_value: 'August 29, 2026',
        object_payload: {},
        confidence: '0.85',
        provenance_kind: 'observation_derived',
        source_turn_ids: ['turn-deadline'],
        source_observation_ids: ['observation-deadline-id'],
        review_status: 'auto_curated',
        valid_from: '2026-02-02T00:00:00Z',
        valid_to: null,
        superseded_by_fact_id: null,
        is_current: true,
      },
    ],
    supersessions: [
      {
        previous_fact_id: 'fact-budget-old-id',
        new_fact_id: 'fact-budget-new-id',
        reason: 'superseded_budget',
        created_at: '2026-02-01T00:00:00Z',
      },
      {
        previous_fact_id: 'fact-deadline-old-id',
        new_fact_id: 'fact-deadline-id',
        reason: 'superseded_desired_deadline',
        created_at: '2026-02-02T00:00:00Z',
      },
    ],
    summaries: [
      {
        id: 'summary-id',
        summary_key: 'summary:running',
        summary_scope: 'running',
        summary_text: 'The current budget is 4500 USD per month.',
        turn_count: 3,
        source_turn_ids: ['turn-old', 'turn-new', 'turn-deadline'],
        quality_label: 'deterministic',
        review_status: 'auto_curated',
        updated_at: '2026-02-02T00:00:00Z',
      },
    ],
    reflections: [
      {
        id: 'reflection-id',
        reflection_key: 'reflection:latest',
        reflection_scope: 'latest_thread_state',
        reflection_text: 'The project retained its prior budget as temporal history.',
        supporting_observation_ids: ['observation-old-id', 'observation-new-id'],
        supporting_fact_ids: ['fact-budget-old-id', 'fact-budget-new-id'],
        confidence: '0.82',
        review_status: 'auto_curated',
        updated_at: '2026-02-02T00:00:00Z',
      },
    ],
  };
}

test('buildPublicSnapshot resolves fact -> observation -> source turn provenance', () => {
  const snapshot = buildPublicSnapshot(rawFixture());
  const currentBudget = snapshot.facts.find((fact) => fact.fact_key === 'fact:budget:new');
  const oldBudget = snapshot.facts.find((fact) => fact.fact_key === 'fact:budget:old');

  assert.equal(currentBudget.provenance.observations[0].observation_key, 'observation:budget:new');
  assert.equal(
    currentBudget.provenance.observations[0].source_turns[0].source_turn_id,
    'turn-new',
  );
  assert.equal(oldBudget.temporal_status, 'superseded');
  assert.equal(oldBudget.supersession.superseded_by.fact_key, 'fact:budget:new');
  assert.equal(currentBudget.supersession.supersedes[0].reason, 'superseded_budget');
  assert.equal('id' in currentBudget, false);
});

test('changed budget query returns only the current and superseded budget facts', () => {
  const result = retrievePublicMemory(buildPublicSnapshot(rawFixture()), 'What changed about the budget?');

  assert.equal(result.status, 'grounded');
  assert.deepEqual(result.retrieved_context.facts.map((fact) => fact.predicate), ['budget', 'budget']);
  assert.deepEqual(result.retrieved_context.facts.map((fact) => fact.is_current), [true, false]);
  assert.match(result.answer, /4500 USD/);
  assert.match(result.answer, /3000 USD/);
  assert.deepEqual(result.retrieval.semantic, { status: 'unavailable' });
});

test('unknown query returns no grounded memory and no unrelated context', () => {
  const result = retrievePublicMemory(buildPublicSnapshot(rawFixture()), 'zyzzyva quux frobnicate');

  assert.equal(result.status, 'no_grounded_memory');
  assert.equal(result.answer, 'No grounded public memory matched that query.');
  assert.deepEqual(result.retrieved_context.facts, []);
  assert.deepEqual(result.retrieved_context.observations, []);
  assert.deepEqual(result.retrieved_context.summaries, []);
  assert.deepEqual(result.retrieved_context.reflections, []);
  assert.equal(result.retrieved_context.assembled_text, '');
});

test('capability intent never falls through to unrelated temporal facts', () => {
  const queries = [
    'What prompt should I use before contacting a new B2B lead?',
    'Show me the candidate onboarding workflow',
    'Which reusable agent playbook should I start with?',
  ];

  for (const query of queries) {
    const result = retrievePublicMemory(buildPublicSnapshot(rawFixture()), query);
    assert.equal(result.status, 'no_grounded_memory', query);
    assert.equal(result.retrieval.reason, 'capability_intent', query);
    assert.equal(result.retrieval.suggested_endpoint, '/api/public/capability-search');
    assert.deepEqual(result.retrieved_context.facts, []);
    assert.deepEqual(result.retrieved_context.observations, []);
  }
});

test('history language without a recognized fact concept returns no temporal fallback', () => {
  const queries = [
    'What changed before?',
    'Show previous information about zyzzyva',
    'What was the old process?',
  ];

  for (const query of queries) {
    const result = retrievePublicMemory(buildPublicSnapshot(rawFixture()), query);
    assert.equal(result.status, 'no_grounded_memory', query);
    assert.deepEqual(result.retrieved_context.facts, [], query);
    assert.deepEqual(result.retrieved_context.observations, [], query);
  }
});

test('current fact queries do not include superseded facts or their observations', () => {
  const result = retrievePublicMemory(buildPublicSnapshot(rawFixture()), 'What is the current budget?');

  assert.equal(result.status, 'grounded');
  assert.deepEqual(result.retrieved_context.facts.map((fact) => fact.object_value), [
    '4500 USD per month',
  ]);
  assert.deepEqual(result.retrieved_context.observations.map((observation) => observation.observation_key), [
    'observation:budget:new',
  ]);
  assert.doesNotMatch(result.retrieved_context.assembled_text, /3000/);
});

test('default demo query returns only budget and deadline with both histories', () => {
  const result = retrievePublicMemory(
    buildPublicSnapshot(rawFixture()),
    'What is the current budget and deadline, and what changed?',
  );
  const factsByPredicate = Map.groupBy(
    result.retrieved_context.facts,
    (fact) => fact.predicate,
  );

  assert.deepEqual([...factsByPredicate.keys()].sort(), ['budget', 'desired_deadline']);
  assert.deepEqual(factsByPredicate.get('budget').map((fact) => fact.is_current).sort(), [false, true]);
  assert.deepEqual(
    factsByPredicate.get('desired_deadline').map((fact) => fact.is_current).sort(),
    [false, true],
  );
});

test('recognized overview query includes bounded summary and reflection context', () => {
  const result = retrievePublicMemory(buildPublicSnapshot(rawFixture()), 'Give me an overview of the current state.');

  assert.equal(result.status, 'grounded');
  assert.equal(result.retrieved_context.summaries.length, 1);
  assert.equal(result.retrieved_context.reflections.length, 1);
});

test('evidence filter emits only the safe requested object type', () => {
  const evidence = buildEvidence(buildPublicSnapshot(rawFixture()), 'fact');

  assert.equal(evidence.filter.type, 'fact');
  assert.equal(evidence.count, 4);
  assert.ok(evidence.items.every((item) => item.type === 'fact'));
  assert.equal(evidence.items[0].provenance.observations[0].source_turns.length, 1);
});
