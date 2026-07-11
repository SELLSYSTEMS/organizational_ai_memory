import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createEmployeeContextPool } from './lib/employee-db-context.mjs';
import { createEmployeeRequestHandler } from './lib/employee-http.mjs';
import { createEmployeeRepository } from './lib/employee-repository.mjs';
import { createEmployeeService } from './lib/employee-service.mjs';
import { createEmployeeSessionManager } from './lib/employee-session.mjs';
import { createPostgresPool } from './lib/postgres.mjs';
import { assertLeastPrivilegeWorkload } from './lib/workload-postgres.mjs';

const appDir = path.dirname(fileURLToPath(import.meta.url));

function decimal(value, fallback, code) {
  const candidate = value === undefined || value === null || value === '' ? fallback : value;
  if ((typeof candidate !== 'string' && !Number.isInteger(candidate))
      || (typeof candidate === 'string' && !/^\d+$/.test(candidate))) {
    throw new Error(code);
  }
  return Number(candidate);
}

function port(value, fallback) {
  const parsed = decimal(value, fallback, 'employee_port_invalid');
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error('employee_port_invalid');
  }
  return parsed;
}

function sessionTtl(value) {
  const parsed = decimal(value, 1_800_000, 'employee_session_ttl_invalid');
  if (!Number.isInteger(parsed) || parsed < 60_000 || parsed > 8 * 60 * 60_000) {
    throw new Error('employee_session_ttl_invalid');
  }
  return parsed;
}

export function readEmployeeConfig(env = process.env) {
  const host = env.OAM_EMPLOYEE_HOST || '127.0.0.1';
  if (!['127.0.0.1', '::1'].includes(host)) throw new Error('employee_host_must_be_loopback');
  return Object.freeze({
    host,
    port: port(env.OAM_EMPLOYEE_PORT, 3020),
    allowedHost: env.OAM_EMPLOYEE_ALLOWED_HOST || null,
    allowedOrigin: env.OAM_EMPLOYEE_ALLOWED_ORIGIN || null,
    sessionTtlMs: sessionTtl(env.OAM_EMPLOYEE_SESSION_TTL_MS),
  });
}

function finalEmployeeConfig(env, overrides = {}) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)
      || Object.keys(overrides).some((key) => ![
        'host', 'port', 'allowedHost', 'allowedOrigin', 'sessionTtlMs',
      ].includes(key))) {
    throw new Error('employee_config_override_invalid');
  }
  const base = readEmployeeConfig(env);
  const host = overrides.host ?? base.host;
  if (!['127.0.0.1', '::1'].includes(host)) throw new Error('employee_host_must_be_loopback');
  const allowedHost = overrides.allowedHost === undefined ? base.allowedHost : overrides.allowedHost;
  const allowedOrigin = overrides.allowedOrigin === undefined ? base.allowedOrigin : overrides.allowedOrigin;
  if ((base.allowedHost !== null && allowedHost !== base.allowedHost)
      || (base.allowedOrigin !== null && allowedOrigin !== base.allowedOrigin)) {
    throw new Error('employee_production_origin_override_denied');
  }
  if (allowedHost !== null
      && (typeof allowedHost !== 'string' || !allowedHost || /[\s/:]/.test(allowedHost))) {
    throw new Error('employee_allowed_host_invalid');
  }
  if (allowedOrigin !== null) {
    try {
      const parsed = new URL(allowedOrigin);
      if (parsed.origin !== allowedOrigin || parsed.protocol !== 'https:') throw new Error();
    } catch {
      throw new Error('employee_allowed_origin_invalid');
    }
  }
  return Object.freeze({
    host,
    port: port(overrides.port, base.port),
    allowedHost,
    allowedOrigin,
    sessionTtlMs: sessionTtl(overrides.sessionTtlMs ?? base.sessionTtlMs),
  });
}

export async function createEmployeeServer(options = {}) {
  const config = finalEmployeeConfig(options.env, options.config);
  const databasePool = options.pool || await createPostgresPool(options.env, {
    applicationName: 'organizational-ai-memory-employee',
  });
  const ownsPool = !options.pool;
  try {
    if (!options.skipDatabaseRoleCheck) {
      await assertLeastPrivilegeWorkload(databasePool, {
        requiredRole: 'oam_employee_runtime',
        forbiddenRoles: ['oam_operator_runtime', 'oam_broker_runtime', 'oam_public_runtime'],
      });
    }
    const pool = createEmployeeContextPool(databasePool);
    const repository = options.repository || createEmployeeRepository(pool);
    const service = options.service || createEmployeeService({ repository });
    const sessionManager = options.sessionManager || createEmployeeSessionManager({
      ttlMs: config.sessionTtlMs,
    });
    const handler = createEmployeeRequestHandler({
      repository,
      service,
      sessionManager,
      staticDir: options.staticDir || path.join(appDir, 'employee-public'),
      allowedHost: config.allowedHost,
      allowedOrigin: config.allowedOrigin,
      sessionTtlSeconds: Math.floor(config.sessionTtlMs / 1_000),
      logger: options.logger || console,
    });
    const server = http.createServer((req, res) => handler(req, res));
    server.headersTimeout = 6_000;
    server.requestTimeout = 20_000;
    server.keepAliveTimeout = 5_000;
    server.maxRequestsPerSocket = 50;

    return {
      config,
      server,
      pool,
      async close() {
        if (server.listening) {
          await new Promise((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
          });
        }
        if (ownsPool) await databasePool.end();
      },
    };
  } catch (error) {
    if (ownsPool) await databasePool.end().catch(() => {});
    throw error;
  }
}

export async function startEmployeeServer(options = {}) {
  const app = await createEmployeeServer(options);
  try {
    await new Promise((resolve, reject) => {
      app.server.once('error', reject);
      app.server.listen(app.config.port, app.config.host, () => {
        app.server.off('error', reject);
        resolve();
      });
    });
    return app;
  } catch (error) {
    await app.close().catch(() => {});
    throw error;
  }
}

function isMain() {
  return process.argv[1]
    && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isMain()) {
  const app = await startEmployeeServer();
  console.log(`Employee workspace listening on http://${app.config.host}:${app.config.port}/workspace/`);
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    try {
      await app.close();
      process.exitCode = 0;
    } catch {
      process.exitCode = 1;
    }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
