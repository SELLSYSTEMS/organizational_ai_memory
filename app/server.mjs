import http from 'node:http';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createCapabilityMemoryRepository } from './lib/capability-memory-repository.mjs';
import { createCapabilityMemoryService } from './lib/capability-memory-service.mjs';
import { createCapabilityAssistService } from './lib/capability-assist-service.mjs';
import { createCodexAssistClient } from './lib/codex-assist-client.mjs';
import { readServerConfig } from './lib/config.mjs';
import { createRequestHandler } from './lib/http-app.mjs';
import { createPostgresPool } from './lib/postgres.mjs';
import { createPublicMemoryRepository } from './lib/public-memory-repository.mjs';
import { createPublicMemoryService } from './lib/public-memory-service.mjs';
import { createPublicIdentityProofLoader } from './lib/public-identity-proof.mjs';
import { assertLeastPrivilegeWorkload } from './lib/workload-postgres.mjs';

const appDir = path.dirname(fileURLToPath(import.meta.url));

export async function createOrganizationalMemoryServer(options = {}) {
  const config = { ...readServerConfig(options.env), ...options.config };
  const pool = options.pool || await createPostgresPool(options.env, {
    applicationName: 'organizational-ai-memory-public',
  });
  const ownsPool = !options.pool;
  if (!options.skipDatabaseRoleCheck) {
    await assertLeastPrivilegeWorkload(pool, {
      requiredRole: 'oam_public_runtime',
      forbiddenRoles: ['oam_operator_runtime', 'oam_broker_runtime'],
    });
  }
  const repository = options.repository || createPublicMemoryRepository(pool);
  const logger = options.logger || console;
  const memoryService = options.memoryService || createPublicMemoryService(repository, {
    onAuditError(error) {
      logger.error?.('Memory retrieval audit write failed.', {
        error_name: error?.name || 'Error',
      });
    },
  });
  const capabilityRepository = options.capabilityRepository || createCapabilityMemoryRepository(pool);
  const capabilityService = options.capabilityService
    || createCapabilityMemoryService(capabilityRepository);
  const codexClient = options.codexClient || createCodexAssistClient({
    enabled: config.codexAssistEnabled,
    socketPath: config.codexSocketPath,
  });
  const capabilityAssistService = options.capabilityAssistService
    || createCapabilityAssistService({ capabilityService, codexClient });
  const proofPath = options.identityProofPath
    || (options.env || process.env).OAM_PUBLIC_IDENTITY_PROOF_PATH;
  const expectedSourceSha256Path = options.expectedSourceSha256Path
    || (options.env || process.env).OAM_PUBLIC_EXPECTED_SOURCE_SHA256_PATH;
  const identityProofLoader = options.identityProofLoader
    || (proofPath && expectedSourceSha256Path
      ? createPublicIdentityProofLoader({
        filePath: proofPath,
        expectedSourceSha256Path,
      })
      : null);
  const handler = createRequestHandler({
    memoryService,
    capabilityService,
    capabilityAssistService,
    identityProofLoader,
    publicDir: options.publicDir || path.join(appDir, 'public'),
    bodyBytes: config.bodyBytes,
    queryCharacters: config.queryCharacters,
    taskKeyCharacters: config.taskKeyCharacters,
    assistCharacters: config.assistCharacters,
    publicReadsPerMinute: config.publicReadsPerMinute,
    publicQueriesPerMinute: config.publicQueriesPerMinute,
    publicGenerationsPerMinute: config.publicGenerationsPerMinute,
    rateLimiter: options.rateLimiter,
    logger,
  });

  const server = http.createServer((req, res) => {
    handler(req, res).catch((error) => {
      logger.error?.('Unhandled HTTP handler failure.', { error_name: error?.name || 'Error' });
      if (!res.headersSent) {
        const body = JSON.stringify({
          error: {
            code: 'service_unavailable',
            message: 'The memory service is temporarily unavailable.',
          },
        });
        res.writeHead(503, {
          'cache-control': 'no-store',
          'content-length': Buffer.byteLength(body),
          'content-type': 'application/json; charset=utf-8',
          'x-content-type-options': 'nosniff',
        });
        res.end(body);
      } else {
        res.destroy();
      }
    });
  });

  server.headersTimeout = 6_000;
  server.requestTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;

  return {
    server,
    config,
    pool,
    async close() {
      if (server.listening) {
        await new Promise((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
        });
      }
      if (ownsPool) await pool.end();
    },
  };
}

export async function startServer(options = {}) {
  const app = await createOrganizationalMemoryServer(options);
  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(app.config.port, app.config.host, () => {
      app.server.off('error', reject);
      resolve();
    });
  });
  return app;
}

function isMainModule() {
  if (!process.argv[1]) return false;
  return pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isMainModule()) {
  const app = await startServer();
  console.log(`Organizational AI Memory listening on http://${app.config.host}:${app.config.port}`);

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
