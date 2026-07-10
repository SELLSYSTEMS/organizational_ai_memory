import { ensurePlatformEnvLoaded, loadPg } from '../../scripts/memory/_memory_runtime.mjs';

function parsePort(value) {
  const parsed = Number.parseInt(value || '5432', 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : 5432;
}

export async function createPostgresPool(env = process.env) {
  await ensurePlatformEnvLoaded();
  const { Pool } = await loadPg();

  const connection = env.DATABASE_URL
    ? { connectionString: env.DATABASE_URL }
    : {
        host: env.PGHOST || '127.0.0.1',
        port: parsePort(env.PGPORT),
        database: env.PGDATABASE || 'tg_ops',
        user: env.PGUSER || 'tg_ops',
        password: env.PGPASSWORD || '',
      };

  return new Pool({
    ...connection,
    application_name: 'organizational-ai-memory-api',
    max: 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 3_000,
    statement_timeout: 5_000,
    query_timeout: 6_000,
  });
}
