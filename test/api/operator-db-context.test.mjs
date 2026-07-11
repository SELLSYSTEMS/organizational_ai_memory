import assert from 'node:assert/strict';
import test from 'node:test';
import {
  actorWithOperatorDatabaseContext,
  createOperatorContextPool,
  wrapOperatorService,
} from '../../app/lib/operator-db-context.mjs';

function fakePool() {
  const calls = [];
  const client = {
    async query(sql, parameters = []) {
      calls.push({ sql: String(sql), parameters });
      return { rows: [{ ok: true }] };
    },
    release() {
      calls.push({ sql: 'RELEASE', parameters: [] });
    },
  };
  return {
    calls,
    async query(sql, parameters = []) {
      calls.push({ sql: String(sql), parameters });
      return { rows: [{ direct: true }] };
    },
    async connect() {
      return client;
    },
    async end() {},
  };
}

test('operator database context is hidden and established inside each service transaction', async () => {
  const tokenSha256 = 'a'.repeat(64);
  const actor = actorWithOperatorDatabaseContext(
    { principal_id: '00000000-0000-4000-8000-000000000001' },
    tokenSha256,
  );
  assert.doesNotMatch(JSON.stringify(actor), new RegExp(tokenSha256));

  const raw = fakePool();
  const pool = createOperatorContextPool(raw);
  const service = wrapOperatorService({
    async read(boundActor) {
      assert.equal(boundActor.principal_id, actor.principal_id);
      return pool.query('SELECT scoped_state FROM identity.principals');
    },
  });
  const result = await service.read(actor);
  assert.equal(result.rows[0].ok, true);
  assert.deepEqual(raw.calls.map((call) => call.sql), [
    'BEGIN',
    'SELECT identity.establish_operator_context($1)',
    'SELECT scoped_state FROM identity.principals',
    'COMMIT',
    'RELEASE',
  ]);
  assert.deepEqual(raw.calls[1].parameters, [tokenSha256]);
});

test('unbound startup and login queries do not receive an operator context', async () => {
  const raw = fakePool();
  const pool = createOperatorContextPool(raw);
  const result = await pool.query('SELECT current_user');
  assert.equal(result.rows[0].direct, true);
  assert.deepEqual(raw.calls, [{ sql: 'SELECT current_user', parameters: [] }]);
});
