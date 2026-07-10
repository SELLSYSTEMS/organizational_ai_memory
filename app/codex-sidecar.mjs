import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CODEX_SPARK_MODEL, createCodexSparkRunner } from './lib/codex-spark-runner.mjs';

const appDir = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SOCKET_PATH = '/run/organizational-ai-memory-codex/assist.sock';
const MAX_BODY_BYTES = 32_768;
const SAFE_RUNNER_ERROR_CODES = new Set([
  'codex_auth_unavailable',
  'codex_timeout',
  'codex_failed',
  'invalid_model_output',
]);

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) throw new Error('request_too_large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function validateRequest(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const keys = Object.keys(payload).sort();
  if (keys.join(',') !== 'recommendation,request,task_key') return false;
  if (typeof payload.task_key !== 'string' || !payload.task_key.trim() || [...payload.task_key].length > 80) return false;
  if (typeof payload.request !== 'string' || !payload.request.trim() || [...payload.request].length > 500) return false;
  if (!payload.recommendation || typeof payload.recommendation !== 'object' || Array.isArray(payload.recommendation)) return false;
  if (!Array.isArray(payload.recommendation.assets) || payload.recommendation.assets.length > 9) return false;
  return true;
}

export function createCodexSidecarServer({
  runner,
  logger = console,
  globalGenerationsPerMinute = 12,
  now = Date.now,
} = {}) {
  const generationLimit = Number.isInteger(globalGenerationsPerMinute)
    && globalGenerationsPerMinute >= 1
    && globalGenerationsPerMinute <= 60
    ? globalGenerationsPerMinute
    : 12;
  let active = false;
  let generationWindowStartedAt = now();
  let generationAttempts = 0;

  function consumeGenerationBudget() {
    const currentTime = now();
    if (currentTime - generationWindowStartedAt >= 60_000) {
      generationWindowStartedAt = currentTime;
      generationAttempts = 0;
    }
    if (generationAttempts >= generationLimit) return false;
    generationAttempts += 1;
    return true;
  }

  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/healthz') {
      sendJson(res, 200, { status: 'ok', model: CODEX_SPARK_MODEL });
      return;
    }
    if (req.method !== 'POST' || req.url !== '/v1/explain') {
      sendJson(res, 404, { error: { code: 'not_found', message: 'Not found.' } });
      return;
    }
    let payload;
    try {
      payload = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: { code: 'invalid_request', message: 'Invalid request.' } });
      return;
    }
    if (!validateRequest(payload)) {
      sendJson(res, 400, { error: { code: 'invalid_request', message: 'Invalid request.' } });
      return;
    }

    // Recheck after the asynchronous body read so concurrent arrivals cannot both enter the slot.
    if (active) {
      sendJson(res, 503, { error: { code: 'busy', message: 'Spark adaptation is busy.' } });
      return;
    }
    if (!consumeGenerationBudget()) {
      sendJson(res, 503, { error: { code: 'budget_exhausted', message: 'Spark adaptation is busy.' } });
      return;
    }

    active = true;
    try {
      const result = await runner.explain({
        taskKey: payload.task_key,
        request: payload.request,
        recommendation: payload.recommendation,
      });
      sendJson(res, 200, {
        status: 'generated',
        model: CODEX_SPARK_MODEL,
        explanation: result.explanation,
      });
    } catch (error) {
      const errorCode = SAFE_RUNNER_ERROR_CODES.has(error?.message)
        ? error.message
        : 'codex_failed';
      logger.error?.('Codex Spark invocation failed.', { error_code: errorCode });
      sendJson(res, 503, { error: { code: 'unavailable', message: 'Spark adaptation is unavailable.' } });
    } finally {
      active = false;
    }
  });
  server.headersTimeout = 2_000;
  server.requestTimeout = 9_000;
  server.keepAliveTimeout = 1_000;
  return server;
}

export async function startCodexSidecar(options = {}) {
  const socketPath = options.socketPath || process.env.OAM_CODEX_SOCKET_PATH || DEFAULT_SOCKET_PATH;
  const runtimeDirectory = path.dirname(socketPath);
  const workspace = options.workspace || process.env.OAM_CODEX_WORKSPACE || '/var/empty/oam-codex';
  const schemaPath = options.schemaPath
    || process.env.OAM_CODEX_SCHEMA_PATH
    || path.resolve(appDir, '../deploy/codex/explanation.schema.json');
  const runner = options.runner || createCodexSparkRunner({
    workspace,
    schemaPath,
    runtimeDirectory,
    timeoutMs: Number.parseInt(process.env.OAM_CODEX_TIMEOUT_MS || '7000', 10),
  });
  const server = createCodexSidecarServer({
    runner,
    logger: options.logger,
    globalGenerationsPerMinute: Number.parseInt(
      process.env.OAM_CODEX_GLOBAL_GENERATIONS_PER_MINUTE || '12',
      10,
    ),
  });

  await fs.mkdir(runtimeDirectory, { recursive: true, mode: 0o750 });
  await fs.rm(socketPath, { force: true });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.off('error', reject);
      resolve();
    });
  });
  await fs.chmod(socketPath, 0o660);
  return { server, socketPath };
}

function isMainModule() {
  if (!process.argv[1]) return false;
  return pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isMainModule()) {
  const app = await startCodexSidecar();
  console.log(`Codex Spark sidecar listening on ${app.socketPath}`);
  const shutdown = () => app.server.close(() => { process.exitCode = 0; });
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
