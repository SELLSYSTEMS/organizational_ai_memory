import { createPgClient } from '../memory/_memory_runtime.mjs';

const INTERNAL_SCOPE = Object.freeze({
  brandKey: 'sell_systems_hackathon_internal',
  threadKey: 'oam_internal_eval_v1',
  corpus: 'internal_demo',
  visibility: 'internal_demo_only',
});

const client = await createPgClient();

try {
  const threadResult = await client.query(
    `
      SELECT id, thread_key, brand_key, metadata
      FROM memory.threads
      WHERE brand_key = $1
        AND thread_key = $2
        AND status = 'active'
        AND metadata->>'corpus' = $3
        AND metadata->>'visibility' = $4
      LIMIT 1
    `,
    [
      INTERNAL_SCOPE.brandKey,
      INTERNAL_SCOPE.threadKey,
      INTERNAL_SCOPE.corpus,
      INTERNAL_SCOPE.visibility,
    ],
  );

  const thread = threadResult.rows[0];
  if (!thread) throw new Error('Internal evaluation corpus is unavailable or incorrectly classified.');

  const factsResult = await client.query(
    `
      SELECT predicate, object_value, is_current, valid_from, valid_to
      FROM memory.facts
      WHERE thread_id = $1
      ORDER BY predicate, valid_from
    `,
    [thread.id],
  );
  const facts = factsResult.rows;

  const expectations = [
    { predicate: 'budget', value: '8200 EUR per month', current: true },
    { predicate: 'budget', value: '7000 EUR per month', current: false },
    { predicate: 'desired_deadline', value: 'September 16, 2026', current: true },
    { predicate: 'desired_deadline', value: 'September 2, 2026', current: false },
  ];

  const cases = expectations.map((expectation) => {
    const fact = facts.find((item) => (
      item.predicate === expectation.predicate &&
      item.object_value === expectation.value &&
      item.is_current === expectation.current
    ));
    const passed = Boolean(fact) && (expectation.current || Boolean(fact.valid_to));
    return {
      ...expectation,
      passed,
      valid_from: fact?.valid_from || null,
      valid_to: fact?.valid_to || null,
    };
  });

  const sourceIntegrityResult = await client.query(
    `
      SELECT count(*)::int AS orphan_count
      FROM memory.facts f
      CROSS JOIN LATERAL jsonb_array_elements_text(f.source_turn_ids) source_id
      LEFT JOIN memory.thread_turns tt
        ON tt.thread_id = f.thread_id
       AND tt.source_turn_id = source_id
      WHERE f.thread_id = $1
        AND tt.id IS NULL
    `,
    [thread.id],
  );
  const sourceIntegrityPassed = sourceIntegrityResult.rows[0].orphan_count === 0;
  const passed = cases.every((item) => item.passed) && sourceIntegrityPassed;

  console.log(JSON.stringify({
    scope: {
      corpus: INTERNAL_SCOPE.corpus,
      visibility: INTERNAL_SCOPE.visibility,
      route: 'local_cli_only',
    },
    fact_count: facts.length,
    cases,
    source_integrity: {
      passed: sourceIntegrityPassed,
      orphan_count: sourceIntegrityResult.rows[0].orphan_count,
    },
    passed,
  }, null, 2));

  if (!passed) process.exitCode = 1;
} finally {
  await client.end();
}
