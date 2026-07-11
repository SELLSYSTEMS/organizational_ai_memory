import assert from 'node:assert/strict';
import test from 'node:test';
import {
  actorWithEmployeeDatabaseContext,
  createEmployeeContextPool,
  EMPLOYEE_DATABASE_CONTEXT,
  wrapEmployeeService,
} from '../../app/lib/employee-db-context.mjs';

const TOKEN_HASH = 'a'.repeat(64);

function fakePool() {
  const calls = [];
  const client = {
    async query(sql, parameters = []) {
      calls.push({ sql, parameters });
      return { rows: [{ ok: true }] };
    },
    release(error) {
      calls.push({ sql: 'RELEASE', parameters: [], error });
    },
  };
  return {
    calls,
    async query(sql, parameters = []) {
      calls.push({ sql, parameters });
      return { rows: [{ direct: true }] };
    },
    async connect() {
      calls.push({ sql: 'CONNECT', parameters: [] });
      return client;
    },
    async end() {},
  };
}

test('employee database context is hidden, immutable, and absent from JSON', () => {
  const actor = actorWithEmployeeDatabaseContext({ principal_id: 'human-id' }, TOKEN_HASH);
  assert.equal(actor[EMPLOYEE_DATABASE_CONTEXT], TOKEN_HASH);
  assert.equal(Object.getOwnPropertyDescriptor(actor, EMPLOYEE_DATABASE_CONTEXT).enumerable, false);
  assert.doesNotMatch(JSON.stringify(actor), new RegExp(TOKEN_HASH));
  assert.equal(Object.isFrozen(actor), true);
  assert.throws(() => actorWithEmployeeDatabaseContext({}, 'not-a-hash'), /valid actor/);
});

test('wrapped employee service establishes context inside every pool transaction', async () => {
  const rawPool = fakePool();
  const pool = createEmployeeContextPool(rawPool);
  const actor = actorWithEmployeeDatabaseContext({ principal_id: 'human-id' }, TOKEN_HASH);
  const service = wrapEmployeeService({
    async workspace(_actor) {
      return pool.query('SELECT personal.employee_workspace() AS data');
    },
  });

  await service.workspace(actor);
  assert.deepEqual(rawPool.calls.map((call) => call.sql), [
    'CONNECT',
    'BEGIN',
    'SELECT identity.establish_employee_context($1)',
    'SELECT personal.employee_workspace() AS data',
    'COMMIT',
    'RELEASE',
  ]);
  assert.deepEqual(rawPool.calls[2].parameters, [TOKEN_HASH]);
});

test('unbound auth queries remain direct and bound clients require explicit BEGIN', async () => {
  const rawPool = fakePool();
  const pool = createEmployeeContextPool(rawPool);
  await pool.query('SELECT * FROM identity.resolve_employee_workspace_token($1)', [TOKEN_HASH]);
  assert.equal(rawPool.calls[0].sql.includes('resolve_employee_workspace_token'), true);
  assert.equal(rawPool.calls.some((call) => call.sql.includes('establish_employee_context')), false);

  const actor = actorWithEmployeeDatabaseContext({ principal_id: 'human-id' }, TOKEN_HASH);
  const service = wrapEmployeeService({
    async invalid(_actor) {
      const client = await pool.connect();
      try {
        return await client.query('SELECT personal.employee_workspace()');
      } finally {
        client.release();
      }
    },
  });
  await assert.rejects(service.invalid(actor), /employee_database_transaction_required/);
});

test('bound clients re-establish local database context for every transaction', async () => {
  const rawPool = fakePool();
  const pool = createEmployeeContextPool(rawPool);
  const actor = actorWithEmployeeDatabaseContext({ principal_id: 'human-id' }, TOKEN_HASH);
  const service = wrapEmployeeService({
    async twoTransactions(_actor) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT personal.employee_workspace()');
        await client.query('COMMIT');
        await assert.rejects(
          client.query('SELECT personal.employee_workspace()'),
          /employee_database_transaction_required/,
        );
        await client.query('BEGIN');
        await assert.rejects(
          client.query('COMMIT AND CHAIN'),
          /transaction_command_denied/,
        );
        await assert.rejects(
          client.query('SELECT 1; SELECT 2'),
          /multi_statement_denied/,
        );
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    },
  });
  await service.twoTransactions(actor);
  assert.equal(
    rawPool.calls.filter((call) => call.sql.includes('establish_employee_context')).length,
    2,
  );
  assert.equal(rawPool.calls.at(-1).error, undefined);
});

test('releasing a bound client with an open transaction destroys that connection', async () => {
  const rawPool = fakePool();
  const pool = createEmployeeContextPool(rawPool);
  const actor = actorWithEmployeeDatabaseContext({ principal_id: 'human-id' }, TOKEN_HASH);
  const service = wrapEmployeeService({
    async abandon(_actor) {
      const client = await pool.connect();
      await client.query('BEGIN');
      client.release();
    },
  });
  await service.abandon(actor);
  assert.match(rawPool.calls.at(-1).error?.message || '', /transaction_abandoned/);
});

test('employee service refuses an actor without a bound database token', async () => {
  const service = wrapEmployeeService({ async workspace() { return true; } });
  assert.throws(
    () => service.workspace({ principal_id: 'human-id' }),
    /employee_database_context_required/,
  );
});
