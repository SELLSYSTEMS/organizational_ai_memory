import fs from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import { SERVICE_NAME } from './config.mjs';
import {
  CAPABILITY_ASSET_TYPES,
  CAPABILITY_REVIEW_STATUSES,
} from './capability-memory-service.mjs';
import { HttpError } from './errors.mjs';
import { EVIDENCE_TYPES } from './public-memory-service.mjs';
import { FixedWindowRateLimiter } from './rate-limiter.mjs';

const SPA_ROUTES = new Set(['/', '/demo', '/assets', '/method', '/evidence']);
const MIME_TYPES = new Map([
  ['.avif', 'image/avif'],
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.xml', 'application/xml; charset=utf-8'],
]);

const API_SECURITY_HEADERS = Object.freeze({
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
});

const STATIC_SECURITY_HEADERS = Object.freeze({
  'content-security-policy': "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'",
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
});

function writeResponse(res, status, headers, body, method = 'GET') {
  res.writeHead(status, headers);
  if (method === 'HEAD') res.end();
  else res.end(body);
}

function sendJson(res, status, payload, method = 'GET', extraHeaders = {}) {
  const body = JSON.stringify(payload);
  writeResponse(
    res,
    status,
    {
      ...API_SECURITY_HEADERS,
      'content-length': Buffer.byteLength(body),
      'content-type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
    body,
    method,
  );
}

function sendApiError(res, error, method = 'GET') {
  if (error instanceof HttpError) {
    sendJson(
      res,
      error.status,
      { error: { code: error.code, message: error.message } },
      method,
      error.headers,
    );
    return;
  }

  sendJson(
    res,
    503,
    {
      error: {
        code: 'service_unavailable',
        message: 'The memory service is temporarily unavailable.',
      },
    },
    method,
  );
}

function methodNotAllowed(allowed) {
  return new HttpError(405, 'method_not_allowed', 'Method not allowed.', {
    headers: { allow: allowed.join(', ') },
  });
}

function assertNoQueryParameters(url) {
  if ([...url.searchParams.keys()].length) {
    throw new HttpError(400, 'invalid_query_parameters', 'This endpoint does not accept query parameters.');
  }
}

function readClientIp(req) {
  const remoteAddress = req.socket.remoteAddress || 'unknown';
  const loopback = remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1';
  if (!loopback) return remoteAddress;

  const forwarded = String(req.headers['x-forwarded-for'] || '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => isIP(value));
  return forwarded.at(-1) || remoteAddress;
}

function rateLimitHeaders(decision) {
  return {
    'ratelimit-limit': String(decision.limit),
    'ratelimit-remaining': String(decision.remaining),
    'ratelimit-reset': String(Math.ceil(decision.resetAt / 1000)),
  };
}

function enforceRateLimit(req, res, limiter, routeKey, limit) {
  const decision = limiter.check(`${readClientIp(req)}:${routeKey}`, limit);
  if (decision.allowed) return rateLimitHeaders(decision);

  sendJson(
    res,
    429,
    { error: { code: 'rate_limited', message: 'Too many requests. Try again shortly.' } },
    req.method,
    {
      ...rateLimitHeaders(decision),
      'retry-after': String(decision.retryAfterSeconds),
    },
  );
  return null;
}

function readJsonBody(req, maxBytes) {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    throw new HttpError(415, 'unsupported_media_type', 'Content-Type must be application/json.');
  }

  const contentLength = Number.parseInt(String(req.headers['content-length'] || ''), 10);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    req.resume();
    throw new HttpError(413, 'request_body_too_large', 'Request body is too large.');
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let size = 0;
    const chunks = [];

    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        settled = true;
        req.resume();
        reject(new HttpError(413, 'request_body_too_large', 'Request body is too large.'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'invalid_json', 'Request body must be valid JSON.'));
      }
    });
    req.on('error', () => {
      if (settled) return;
      settled = true;
      reject(new HttpError(400, 'invalid_request_body', 'Request body could not be read.'));
    });
  });
}

function validateQueryPayload(payload, maxCharacters) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new HttpError(400, 'invalid_query_request', 'Request body must be an object containing only query.');
  }
  const keys = Object.keys(payload);
  if (keys.length !== 1 || keys[0] !== 'query' || typeof payload.query !== 'string') {
    throw new HttpError(400, 'invalid_query_request', 'Request body must contain only a string query field.');
  }

  const query = payload.query.replace(/\s+/g, ' ').trim();
  if (!query) throw new HttpError(400, 'invalid_query', 'Query must not be empty.');
  if ([...query].length > maxCharacters) {
    throw new HttpError(400, 'query_too_long', `Query must be ${maxCharacters} characters or fewer.`);
  }
  return query;
}

function validateTaskRecommendationPayload(payload, maxCharacters) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new HttpError(400, 'invalid_recommendation_request', 'Request body must be an object containing only task_key.');
  }
  const keys = Object.keys(payload);
  if (keys.length !== 1 || keys[0] !== 'task_key' || typeof payload.task_key !== 'string') {
    throw new HttpError(400, 'invalid_recommendation_request', 'Request body must contain only a string task_key field.');
  }

  const taskKey = payload.task_key.trim();
  if (!taskKey) throw new HttpError(400, 'invalid_task_key', 'task_key must not be empty.');
  if ([...taskKey].length > maxCharacters) {
    throw new HttpError(400, 'task_key_too_long', `task_key must be ${maxCharacters} characters or fewer.`);
  }
  if (!/^[a-z][a-z0-9_]*$/.test(taskKey)) {
    throw new HttpError(400, 'invalid_task_key', 'task_key must be a lowercase identifier.');
  }
  return taskKey;
}

function validateCapabilityAssistPayload(payload, taskKeyCharacters, requestCharacters) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new HttpError(
      400,
      'invalid_capability_assist_request',
      'Request body must contain only task_key and request.',
    );
  }
  const keys = Object.keys(payload).sort();
  if (
    keys.join(',') !== 'request,task_key'
    || typeof payload.task_key !== 'string'
    || typeof payload.request !== 'string'
  ) {
    throw new HttpError(
      400,
      'invalid_capability_assist_request',
      'Request body must contain only string task_key and request fields.',
    );
  }

  const taskKey = validateTaskRecommendationPayload(
    { task_key: payload.task_key },
    taskKeyCharacters,
  );
  const request = payload.request.replace(/\s+/g, ' ').trim();
  if (!request) {
    throw new HttpError(400, 'invalid_assist_request', 'request must not be empty.');
  }
  if ([...request].length > requestCharacters) {
    throw new HttpError(
      400,
      'assist_request_too_long',
      `request must be ${requestCharacters} characters or fewer.`,
    );
  }
  return { taskKey, request };
}

function capabilityAssetFilters(url) {
  const allowed = new Set(['type', 'capability_area', 'review_status']);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) {
      throw new HttpError(
        400,
        'invalid_query_parameters',
        'Assets accept only one type, capability_area, and review_status parameter.',
      );
    }
  }

  const type = url.searchParams.get('type');
  const capabilityArea = url.searchParams.get('capability_area');
  const reviewStatus = url.searchParams.get('review_status');
  if (type !== null && !CAPABILITY_ASSET_TYPES.includes(type)) {
    throw new HttpError(400, 'invalid_asset_type', 'Unsupported capability asset type.');
  }
  if (
    capabilityArea !== null
    && ([...capabilityArea].length > 80 || !/^[a-z][a-z0-9_]*$/.test(capabilityArea))
  ) {
    throw new HttpError(400, 'invalid_capability_area', 'capability_area must be a lowercase identifier.');
  }
  if (reviewStatus !== null && !CAPABILITY_REVIEW_STATUSES.includes(reviewStatus)) {
    throw new HttpError(400, 'invalid_review_status', 'Unsupported capability review status.');
  }

  return {
    type: type || null,
    capability_area: capabilityArea || null,
    review_status: reviewStatus || null,
  };
}

function capabilityAssetKey(pathname) {
  const encodedKey = pathname.slice('/api/public/assets/'.length);
  let assetKey;
  try {
    assetKey = decodeURIComponent(encodedKey);
  } catch {
    throw new HttpError(400, 'invalid_asset_key', 'Capability asset key is invalid.');
  }
  if (
    !assetKey
    || [...assetKey].length > 160
    || !/^(?:prompt|workflow|agent|decision|practice):[a-z0-9][a-z0-9_]*$/.test(assetKey)
  ) {
    throw new HttpError(400, 'invalid_asset_key', 'Capability asset key is invalid.');
  }
  return assetKey;
}

function evidenceType(url) {
  for (const key of url.searchParams.keys()) {
    if (key !== 'type' || url.searchParams.getAll(key).length !== 1) {
      throw new HttpError(400, 'invalid_query_parameters', 'Evidence accepts only one type parameter.');
    }
  }
  const type = url.searchParams.get('type') || 'all';
  if (!EVIDENCE_TYPES.includes(type)) {
    throw new HttpError(400, 'invalid_evidence_type', 'Unsupported evidence type.');
  }
  return type;
}

function normalizedSpaRoute(pathname) {
  if (pathname === '/') return '/';
  return pathname.replace(/\/+$/, '');
}

function safeStaticPath(publicDir, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;

  const segments = decoded.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '..' || segment.startsWith('.'))) return null;
  const candidate = path.resolve(publicDir, segments.join('/'));
  const root = path.resolve(publicDir);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) return null;
  return candidate;
}

async function serveStatic(req, res, url, publicDir) {
  if (!['GET', 'HEAD'].includes(req.method)) {
    sendApiError(res, methodNotAllowed(['GET', 'HEAD']), req.method);
    return;
  }

  const spaRoute = normalizedSpaRoute(url.pathname);
  const isSpaRoute = SPA_ROUTES.has(spaRoute);
  const filePath = isSpaRoute
    ? path.join(publicDir, 'index.html')
    : safeStaticPath(publicDir, url.pathname);

  if (!filePath || filePath === path.resolve(publicDir)) {
    const body = 'Not found';
    writeResponse(
      res,
      404,
      {
        ...STATIC_SECURITY_HEADERS,
        'cache-control': 'no-store',
        'content-length': Buffer.byteLength(body),
        'content-type': 'text/plain; charset=utf-8',
      },
      body,
      req.method,
    );
    return;
  }

  try {
    const [realRoot, realFilePath] = await Promise.all([
      fs.realpath(publicDir),
      fs.realpath(filePath),
    ]);
    if (realFilePath !== realRoot && !realFilePath.startsWith(`${realRoot}${path.sep}`)) {
      throw new Error('file escapes public root');
    }
    const stat = await fs.stat(realFilePath);
    if (!stat.isFile()) throw new Error('not a file');
    const body = await fs.readFile(realFilePath);
    const extension = path.extname(realFilePath).toLowerCase();
    const immutable = /[.-][a-f0-9]{8,}[.-]/i.test(path.basename(realFilePath));
    const cacheControl = extension === '.html'
      ? 'no-cache'
      : immutable
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=3600';

    writeResponse(
      res,
      200,
      {
        ...STATIC_SECURITY_HEADERS,
        'cache-control': cacheControl,
        'content-length': body.length,
        'content-type': MIME_TYPES.get(extension) || 'application/octet-stream',
      },
      body,
      req.method,
    );
  } catch {
    const body = 'Not found';
    writeResponse(
      res,
      404,
      {
        ...STATIC_SECURITY_HEADERS,
        'cache-control': 'no-store',
        'content-length': Buffer.byteLength(body),
        'content-type': 'text/plain; charset=utf-8',
      },
      body,
      req.method,
    );
  }
}

export function createRequestHandler({
  memoryService,
  capabilityService,
  capabilityAssistService,
  publicDir,
  bodyBytes = 4_096,
  queryCharacters = 500,
  taskKeyCharacters = 80,
  assistCharacters = 500,
  publicReadsPerMinute = 120,
  publicQueriesPerMinute = 30,
  publicGenerationsPerMinute = 6,
  rateLimiter = new FixedWindowRateLimiter(),
  logger = console,
}) {
  if (!memoryService) throw new TypeError('memoryService is required.');
  if (!capabilityService) throw new TypeError('capabilityService is required.');
  if (!capabilityAssistService) throw new TypeError('capabilityAssistService is required.');
  if (!publicDir) throw new TypeError('publicDir is required.');

  return async function handleRequest(req, res) {
    let url;
    try {
      url = new URL(req.url || '/', 'http://127.0.0.1');
    } catch {
      sendApiError(res, new HttpError(400, 'invalid_url', 'Invalid request URL.'), req.method);
      return;
    }

    try {
      if (url.pathname === '/api/healthz') {
        if (!['GET', 'HEAD'].includes(req.method)) throw methodNotAllowed(['GET', 'HEAD']);
        assertNoQueryParameters(url);
        sendJson(res, 200, {
          status: 'ok',
          service: SERVICE_NAME,
          time: new Date().toISOString(),
        }, req.method);
        return;
      }

      if (url.pathname === '/api/readyz') {
        if (!['GET', 'HEAD'].includes(req.method)) throw methodNotAllowed(['GET', 'HEAD']);
        assertNoQueryParameters(url);
        try {
          const [readiness, capabilityAvailable] = await Promise.all([
            memoryService.readiness(),
            capabilityService.readiness(),
          ]);
          const ready = readiness.ready && capabilityAvailable;
          sendJson(res, ready ? 200 : 503, {
            status: ready ? 'ready' : 'not_ready',
            checks: {
              ...readiness.checks,
              capability_pack: capabilityAvailable ? 'available' : 'unavailable',
            },
          }, req.method);
        } catch {
          sendJson(res, 503, {
            status: 'not_ready',
            checks: {
              database: 'unavailable',
              public_corpus: 'unavailable',
              capability_pack: 'unavailable',
            },
          }, req.method);
        }
        return;
      }

      if (url.pathname === '/api/public/corpus') {
        if (!['GET', 'HEAD'].includes(req.method)) throw methodNotAllowed(['GET', 'HEAD']);
        assertNoQueryParameters(url);
        const headers = enforceRateLimit(req, res, rateLimiter, 'public-read', publicReadsPerMinute);
        if (!headers) return;
        sendJson(res, 200, await memoryService.corpus(), req.method, headers);
        return;
      }

      if (url.pathname === '/api/public/query') {
        if (req.method !== 'POST') throw methodNotAllowed(['POST']);
        assertNoQueryParameters(url);
        const headers = enforceRateLimit(req, res, rateLimiter, 'public-query', publicQueriesPerMinute);
        if (!headers) return;
        const payload = await readJsonBody(req, bodyBytes);
        const query = validateQueryPayload(payload, queryCharacters);
        sendJson(res, 200, await memoryService.query(query), req.method, headers);
        return;
      }

      if (url.pathname === '/api/public/evidence') {
        if (!['GET', 'HEAD'].includes(req.method)) throw methodNotAllowed(['GET', 'HEAD']);
        const type = evidenceType(url);
        const headers = enforceRateLimit(req, res, rateLimiter, 'public-read', publicReadsPerMinute);
        if (!headers) return;
        sendJson(res, 200, await memoryService.evidence(type), req.method, headers);
        return;
      }

      if (url.pathname === '/api/public/assets') {
        if (!['GET', 'HEAD'].includes(req.method)) throw methodNotAllowed(['GET', 'HEAD']);
        const filters = capabilityAssetFilters(url);
        const headers = enforceRateLimit(req, res, rateLimiter, 'public-read', publicReadsPerMinute);
        if (!headers) return;
        sendJson(res, 200, await capabilityService.assets(filters), req.method, headers);
        return;
      }

      if (url.pathname.startsWith('/api/public/assets/')) {
        if (!['GET', 'HEAD'].includes(req.method)) throw methodNotAllowed(['GET', 'HEAD']);
        assertNoQueryParameters(url);
        const assetKey = capabilityAssetKey(url.pathname);
        const headers = enforceRateLimit(req, res, rateLimiter, 'public-read', publicReadsPerMinute);
        if (!headers) return;
        sendJson(res, 200, await capabilityService.asset(assetKey), req.method, headers);
        return;
      }

      if (url.pathname === '/api/public/recommendations') {
        assertNoQueryParameters(url);
        if (['GET', 'HEAD'].includes(req.method)) {
          const headers = enforceRateLimit(req, res, rateLimiter, 'public-read', publicReadsPerMinute);
          if (!headers) return;
          sendJson(res, 200, await capabilityService.recommendations(), req.method, headers);
          return;
        }
        if (req.method === 'POST') {
          const headers = enforceRateLimit(req, res, rateLimiter, 'public-query', publicQueriesPerMinute);
          if (!headers) return;
          const payload = await readJsonBody(req, bodyBytes);
          const taskKey = validateTaskRecommendationPayload(payload, taskKeyCharacters);
          sendJson(res, 200, await capabilityService.recommend(taskKey), req.method, headers);
          return;
        }
        throw methodNotAllowed(['GET', 'HEAD', 'POST']);
      }

      if (url.pathname === '/api/public/capability-assist') {
        if (req.method !== 'POST') throw methodNotAllowed(['POST']);
        assertNoQueryParameters(url);
        const headers = enforceRateLimit(
          req,
          res,
          rateLimiter,
          'public-generation',
          publicGenerationsPerMinute,
        );
        if (!headers) return;
        const payload = await readJsonBody(req, bodyBytes);
        const { taskKey, request } = validateCapabilityAssistPayload(
          payload,
          taskKeyCharacters,
          assistCharacters,
        );
        sendJson(
          res,
          200,
          await capabilityAssistService.assist(taskKey, request),
          req.method,
          headers,
        );
        return;
      }

      if (url.pathname === '/api/public/capability-analytics') {
        if (!['GET', 'HEAD'].includes(req.method)) throw methodNotAllowed(['GET', 'HEAD']);
        assertNoQueryParameters(url);
        const headers = enforceRateLimit(req, res, rateLimiter, 'public-read', publicReadsPerMinute);
        if (!headers) return;
        sendJson(res, 200, await capabilityService.analytics(), req.method, headers);
        return;
      }

      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        throw new HttpError(404, 'api_route_not_found', 'API route not found.');
      }

      await serveStatic(req, res, url, publicDir);
    } catch (error) {
      if (!(error instanceof HttpError)) {
        logger.error?.('Memory API request failed.', {
          path: url.pathname,
          error_name: error?.name || 'Error',
        });
      }
      sendApiError(res, error, req.method);
    }
  };
}
