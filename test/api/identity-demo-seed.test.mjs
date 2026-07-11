import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const seedPath = new URL('../../sql/identity_demo_seed_v1.sql', import.meta.url);

test('identity demo seed contains separate architect, reviewer, service, and immutable policy roles', async () => {
  const sql = await fs.readFile(seedPath, 'utf8');

  for (const key of [
    'human:ai_architect',
    'human:capability_reviewer',
    'service:governed_ingestion',
    'memory_reuse_agent',
    'governed_ingestion',
  ]) assert.match(sql, new RegExp(key));
  assert.match(sql, /candidate\.promote_as_draft/);
  assert.match(sql, /candidate\.review/);
  assert.match(sql, /memory\.canonical\.write', 'deny'/);
  assert.match(sql, /INSERT INTO identity\.policy_assignments/);
  assert.match(sql, /ON CONFLICT/);
});

test('identity demo seed contains no credentials, bearer tokens, or canonical-memory writes', async () => {
  const sql = await fs.readFile(seedPath, 'utf8');

  assert.doesNotMatch(sql, /token_sha256|broker_credentials|PASSWORD\s|'Bearer\s/i);
  assert.doesNotMatch(sql, /INSERT INTO memory\./);
  assert.doesNotMatch(sql, /UPDATE memory\./);
  assert.doesNotMatch(sql, /DELETE FROM memory\./);
});
