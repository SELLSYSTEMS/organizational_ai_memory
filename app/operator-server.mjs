import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createIdentityDataPlane } from './lib/identity-data-plane.mjs';
import { createOperatorRequestHandler } from './lib/operator-http.mjs';
import { createOperatorRepository } from './lib/operator-repository.mjs';
import { createOperatorService } from './lib/operator-service.mjs';
import { createOperatorSessionManager, loadCredentialMap } from './lib/operator-session.mjs';
import { createOperatorContextPool } from './lib/operator-db-context.mjs';
import { createPostgresPool } from './lib/postgres.mjs';
import { createProvisionerClient } from './lib/provisioner-client.mjs';
import { assertLeastPrivilegeWorkload } from './lib/workload-postgres.mjs';

const appDir = path.dirname(fileURLToPath(import.meta.url));

function port(value, fallback) {
  const parsed = Number.parseInt(value || String(fallback), 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error('operator_port_invalid');
  }
  return parsed;
}

export function readOperatorConfig(env = process.env) {
  const host = env.OAM_OPERATOR_HOST || '127.0.0.1';
  if (!['127.0.0.1', '::1'].includes(host)) throw new Error('operator_host_must_be_loopback');
  const credentialMapPath = env.OAM_OPERATOR_CREDENTIAL_MAP
    || (env.CREDENTIALS_DIRECTORY
      ? path.join(env.CREDENTIALS_DIRECTORY, 'operator-credentials.json')
      : null);
  if (!credentialMapPath) throw new Error('operator_credential_map_required');
  const secureCookiesRaw = env.OAM_OPERATOR_SECURE_COOKIES || 'false';
  if (!['true', 'false'].includes(secureCookiesRaw)) {
    throw new Error('operator_secure_cookies_invalid');
  }
  return Object.freeze({
    host,
    port: port(env.OAM_OPERATOR_PORT, 3010),
    credentialMapPath,
    provisionerSocket: env.OAM_PROVISIONER_SOCKET || '/run/oam-provisioner/provisioner.sock',
    quarantineRoot: env.OAM_QUARANTINE_ROOT
      || '/var/lib/organizational-ai-memory-quarantine',
    ingestionPrincipalKey: env.OAM_INGESTION_PRINCIPAL_KEY || 'service:governed_ingestion',
    allowedHost: env.OAM_OPERATOR_ALLOWED_HOST || null,
    allowedOrigin: env.OAM_OPERATOR_ALLOWED_ORIGIN || null,
    secureCookies: secureCookiesRaw === 'true',
    cookiePath: env.OAM_OPERATOR_COOKIE_PATH || '/',
    sessionTtlMs: Math.min(
      8 * 60 * 60_000,
      Math.max(60_000, Number.parseInt(env.OAM_OPERATOR_SESSION_TTL_MS || '1800000', 10)),
    ),
  });
}

export async function createOperatorServer(options = {}) {
  const config = { ...readOperatorConfig(options.env), ...options.config };
  const databasePool = options.pool || await createPostgresPool(options.env, {
    applicationName: 'organizational-ai-memory-operator',
  });
  const ownsPool = !options.pool;
  if (!options.skipDatabaseRoleCheck) {
    await assertLeastPrivilegeWorkload(databasePool, {
      requiredRole: 'oam_operator_runtime',
      forbiddenRoles: ['oam_broker_runtime', 'oam_public_runtime'],
    });
  }
  const pool = createOperatorContextPool(databasePool);
  const credentials = options.credentials || await loadCredentialMap(config.credentialMapPath);
  const sessionManager = options.sessionManager || createOperatorSessionManager({
    credentials,
    ttlMs: config.sessionTtlMs,
  });
  const identityPlane = options.identityPlane || createIdentityDataPlane({ pool });
  const repository = options.repository || createOperatorRepository(pool);
  const provisionerClient = options.provisionerClient || createProvisionerClient({
    socketPath: config.provisionerSocket,
  });
  const service = options.service || createOperatorService({
    identityPlane,
    repository,
    provisionerClient,
    quarantineRoot: config.quarantineRoot,
    ingestionPrincipalKey: config.ingestionPrincipalKey,
  });
  const handler = createOperatorRequestHandler({
    repository,
    service,
    sessionManager,
    staticDir: options.staticDir || path.join(appDir, 'operator-public'),
    allowedHost: config.allowedHost,
    allowedOrigin: config.allowedOrigin,
    secureCookies: config.secureCookies,
    cookiePath: config.cookiePath,
    sessionTtlSeconds: Math.floor(config.sessionTtlMs / 1_000),
    logger: options.logger || console,
  });
  const server = http.createServer((req, res) => handler(req, res));
  server.headersTimeout = 6_000;
  server.requestTimeout = 25_000;
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
}

export async function startOperatorServer(options = {}) {
  const app = await createOperatorServer(options);
  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(app.config.port, app.config.host, () => {
      app.server.off('error', reject);
      resolve();
    });
  });
  return app;
}

function isMain() {
  return process.argv[1]
    && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isMain()) {
  const app = await startOperatorServer();
  console.log(`Architect Console listening on http://${app.config.host}:${app.config.port}`);
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
