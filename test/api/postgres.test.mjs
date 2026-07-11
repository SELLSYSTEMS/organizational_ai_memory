import assert from 'node:assert/strict';
import test from 'node:test';
import { createPostgresPool } from '../../app/lib/postgres.mjs';

test('application PostgreSQL adapter requires an explicit database and workload identity', async () => {
  await assert.rejects(
    createPostgresPool({ PGHOST: '127.0.0.1' }),
    /database_connection_config_required/,
  );
});

test('application PostgreSQL adapter does not consult the legacy platform environment', async () => {
  const pool = await createPostgresPool({
    PGHOST: '127.0.0.1',
    PGPORT: '1',
    PGDATABASE: 'explicit_database',
    PGUSER: 'explicit_workload',
    PGPASSWORD: 'not-a-live-credential',
  });
  try {
    assert.equal(pool.options.database, 'explicit_database');
    assert.equal(pool.options.user, 'explicit_workload');
    assert.equal(pool.options.port, 1);
  } finally {
    await pool.end();
  }
});
