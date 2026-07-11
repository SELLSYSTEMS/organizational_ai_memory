import assert from 'node:assert/strict';
import test from 'node:test';
import { PUBLIC_SCOPE } from '../../app/lib/config.mjs';
import { createPublicMemoryRepository } from '../../app/lib/public-memory-repository.mjs';

function fakePool() {
  const calls = [];
  return {
    calls,
    async query(sql, parameters) {
      calls.push({ sql, parameters });
      if (sql.includes('SELECT EXISTS')) return { rows: [{ public_corpus_available: true }] };
      if (sql.includes("metadata->>'description'")) {
        return {
          rows: [{
            id: 'thread-id',
            thread_key: PUBLIC_SCOPE.threadKey,
            brand_key: PUBLIC_SCOPE.brandKey,
            scope_kind: 'project_memory',
            source_system: 'public_safe_synthetic_demo',
            title: 'Public demo',
            language_code: 'en',
          }],
        };
      }
      return { rows: [] };
    },
  };
}

test('every public read query carries the pinned scope and visibility parameters', async () => {
  const pool = fakePool();
  const repository = createPublicMemoryRepository(pool);

  assert.equal(await repository.readiness(), true);
  await repository.readSnapshot();

  const expected = [
    PUBLIC_SCOPE.brandKey,
    PUBLIC_SCOPE.threadKey,
    PUBLIC_SCOPE.corpus,
    PUBLIC_SCOPE.visibility,
    PUBLIC_SCOPE.status,
  ];
  assert.equal(pool.calls.length, 8);
  for (const call of pool.calls) {
    assert.deepEqual(call.parameters, expected);
    assert.match(call.sql, /oam_public\.continuity_/);
    assert.doesNotMatch(call.sql, /\bmemory\./);
    assert.match(call.sql, /brand_key = \$1/);
    assert.match(call.sql, /thread_key = \$2/);
    assert.match(call.sql, /metadata @> jsonb_build_object/);
    assert.match(call.sql, /status = \$5/);
  }
});

test('retrieval audit is parameterized and never interpolates client query text', async () => {
  const pool = fakePool();
  const repository = createPublicMemoryRepository(pool);
  const query = "budget'); SELECT secret FROM private_table; --";

  await repository.recordRetrieval(query, { status: 'no_grounded_memory' });

  assert.equal(pool.calls.length, 1);
  assert.equal(JSON.parse(pool.calls[0].parameters[5]).query_text, query);
  assert.equal(pool.calls[0].sql.includes(query), false);
  assert.match(pool.calls[0].sql, /\$6/);
  assert.match(pool.calls[0].sql, /audit\.record_public_interaction/);
  assert.doesNotMatch(pool.calls[0].sql, /\bmemory\./);
  assert.deepEqual(pool.calls[0].parameters.slice(0, 5), [
    'public_retrieval',
    'continuity_query',
    PUBLIC_SCOPE.threadKey,
    'recorded',
    null,
  ]);
});
