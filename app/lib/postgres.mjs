function parsePort(value) {
  const parsed = Number.parseInt(value || '5432', 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : 5432;
}

export async function createPostgresPool(env = process.env, options = {}) {
  if (!env || typeof env !== 'object') throw new TypeError('Database environment is required.');
  if (!env.DATABASE_URL && (!env.PGDATABASE || !env.PGUSER)) {
    throw new Error('database_connection_config_required');
  }
  let pg;
  try {
    pg = await import('pg');
  } catch (error) {
    throw new Error('postgres_driver_unavailable', { cause: error });
  }
  const { Pool } = pg.default ?? pg;

  const connection = env.DATABASE_URL
    ? { connectionString: env.DATABASE_URL }
    : {
        host: env.PGHOST || '127.0.0.1',
        port: parsePort(env.PGPORT),
        database: env.PGDATABASE,
        user: env.PGUSER,
        password: env.PGPASSWORD || '',
      };

  return new Pool({
    ...connection,
    application_name: options.applicationName || 'organizational-ai-memory-api',
    max: 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 3_000,
    statement_timeout: 5_000,
    query_timeout: 6_000,
  });
}
