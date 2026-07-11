import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createMemoryBrokerRepository,
  MemoryBrokerRepositoryError,
} from './lib/memory-broker-repository.mjs';
import { createPostgresPool } from './lib/postgres.mjs';
import { assertLeastPrivilegeWorkload } from './lib/workload-postgres.mjs';

const TOKEN = /^[A-Za-z0-9_-]{43,86}$/;
const AGENT_KEY = /^agent:[a-z0-9][a-z0-9_.-]{1,118}$/;
const HEADERS = Object.freeze({
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
});

class BrokerHttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...HEADERS,
    'content-length': Buffer.byteLength(body),
    'content-type': 'application/json; charset=utf-8',
  });
  res.end(body);
}

function exactObject(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

async function readBody(req) {
  if (req.headers['content-encoding']) {
    throw new BrokerHttpError(415, 'content_encoding_not_supported', 'Compressed bodies are not accepted.');
  }
  if (String(req.headers['content-type'] || '').toLowerCase() !== 'application/json') {
    throw new BrokerHttpError(415, 'unsupported_media_type', 'Content-Type must be application/json.');
  }
  const length = Number.parseInt(String(req.headers['content-length'] || ''), 10);
  if (Number.isFinite(length) && length > 1_024) {
    req.resume();
    throw new BrokerHttpError(413, 'request_body_too_large', 'Request body is too large.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_024) {
      req.resume();
      throw new BrokerHttpError(413, 'request_body_too_large', 'Request body is too large.');
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new BrokerHttpError(400, 'invalid_json', 'Request body must be valid JSON.');
  }
}

function bearerToken(req) {
  const authorization = String(req.headers.authorization || '');
  const match = authorization.match(/^Bearer ([A-Za-z0-9_-]+)$/);
  if (!match || !TOKEN.test(match[1])) {
    throw new BrokerHttpError(401, 'authentication_failed', 'Broker credential is invalid or inactive.');
  }
  return match[1];
}

export function createMemoryBrokerHandler({ repository, randomUUID = crypto.randomUUID, logger = console } = {}) {
  if (!repository) throw new TypeError('Memory broker repository is required.');

  return async function memoryBrokerHandler(req, res) {
    try {
      if (req.method !== 'POST' || req.url !== '/v1/agent/recommendation') {
        req.resume();
        throw new BrokerHttpError(
          404,
          'operation_not_allowed',
          'Broker exposes approved capability retrieval only.',
        );
      }
      const token = bearerToken(req);
      const claimedPrincipalKey = req.headers['x-oam-principal'] === undefined
        ? null
        : String(req.headers['x-oam-principal']);
      if (claimedPrincipalKey !== null && !AGENT_KEY.test(claimedPrincipalKey)) {
        throw new BrokerHttpError(401, 'authentication_failed', 'Broker credential is invalid or inactive.');
      }
      const body = await readBody(req);
      if (!exactObject(body, ['task']) || body.task !== 'website delivery handoff') {
        throw new BrokerHttpError(
          400,
          'invalid_task_request',
          'Broker accepts only the approved website delivery handoff task.',
        );
      }
      const correlationKey = randomUUID();
      const result = await repository.approvedWebsiteCapability({
        tokenSha256: crypto.createHash('sha256').update(token).digest('hex'),
        claimedPrincipalKey,
        correlationKey,
      });
      json(res, 200, {
        schema_version: 1,
        authorization: 'allowed',
        principal: {
          principal_key: result.authorization.principal_key,
          sponsor_principal_key: result.authorization.sponsor_principal_key,
          department_key: result.authorization.department_key,
        },
        policy_hash: result.authorization.policy_hash,
        capability: result.capability,
        audit_event_key: result.audit_event_key,
        correlation_key: correlationKey,
      });
    } catch (error) {
      const known = error instanceof BrokerHttpError || error instanceof MemoryBrokerRepositoryError;
      if (!known) logger.error?.('Memory broker request failed.', { error_name: error?.name || 'Error' });
      if (!res.headersSent) {
        json(res, known ? error.status : 503, {
          error: {
            code: known ? error.code : 'broker_service_unavailable',
            message: known ? error.message : 'Memory broker is temporarily unavailable.',
          },
        });
      } else {
        res.destroy();
      }
    }
  };
}

export async function createMemoryBrokerServer(options = {}) {
  const pool = options.pool || await createPostgresPool(options.env, {
    applicationName: 'organizational-ai-memory-broker',
  });
  const ownsPool = !options.pool;
  if (!options.skipDatabaseRoleCheck) {
    await assertLeastPrivilegeWorkload(pool, {
      requiredRole: 'oam_broker_runtime',
      forbiddenRoles: ['oam_operator_runtime', 'oam_public_runtime'],
    });
  }
  const repository = options.repository || createMemoryBrokerRepository(pool);
  const handler = createMemoryBrokerHandler({ repository, logger: options.logger || console });
  const server = http.createServer((req, res) => handler(req, res));
  server.headersTimeout = 5_000;
  server.requestTimeout = 8_000;
  server.keepAliveTimeout = 3_000;
  server.maxRequestsPerSocket = 50;
  return {
    pool,
    server,
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

export async function startMemoryBroker(options = {}) {
  const socketPath = options.socketPath
    || options.env?.OAM_BROKER_SOCKET
    || process.env.OAM_BROKER_SOCKET
    || '/run/organizational-ai-memory-broker/agent.sock';
  if (!path.isAbsolute(socketPath)) throw new Error('broker_socket_must_be_absolute');
  const app = await createMemoryBrokerServer(options);
  await fs.rm(socketPath, { force: true });
  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(socketPath, () => {
      app.server.off('error', reject);
      resolve();
    });
  });
  await fs.chmod(socketPath, 0o660);
  return { ...app, socketPath };
}

function isMain() {
  return process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isMain()) {
  const app = await startMemoryBroker();
  console.log(`Organizational AI Memory broker listening on ${app.socketPath}`);
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    try {
      await app.close();
      await fs.rm(app.socketPath, { force: true });
      process.exitCode = 0;
    } catch {
      process.exitCode = 1;
    }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
