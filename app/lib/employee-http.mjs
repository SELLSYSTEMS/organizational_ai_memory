import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { EmployeeRepositoryError } from './employee-repository.mjs';

const COOKIE_NAME = 'oam_employee_session';
const COOKIE_PATH = '/workspace';
const TOKEN = /^[A-Za-z0-9_-]{43,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MEMORY_TYPES = new Set(['experience', 'lesson', 'preference', 'skill', 'decision', 'pattern']);
const SENSITIVITIES = new Set(['private', 'restricted']);
const API_HEADERS = Object.freeze({
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
});
const STATIC_HEADERS = Object.freeze({
  ...API_HEADERS,
  'content-security-policy': "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'",
});
const MIME_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
});

class EmployeeHttpError extends Error {
  constructor(status, code, message, headers = {}) {
    super(message);
    this.name = 'EmployeeHttpError';
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

function send(res, status, headers, body, method = 'GET') {
  res.writeHead(status, headers);
  if (method === 'HEAD') res.end();
  else res.end(body);
}

function json(res, status, payload, method = 'GET', headers = {}) {
  const body = JSON.stringify(payload);
  send(res, status, {
    ...API_HEADERS,
    'content-length': Buffer.byteLength(body),
    'content-type': 'application/json; charset=utf-8',
    ...headers,
  }, body, method);
}

function resolvedError(error) {
  if (error instanceof EmployeeHttpError) {
    return { status: error.status, code: error.code, message: error.message, headers: error.headers || {} };
  }
  if (error instanceof EmployeeRepositoryError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      headers: error.code === 'authentication_failed' ? { 'set-cookie': clearCookie() } : {},
    };
  }
  if (error?.code === '28000') {
    return {
      status: 401,
      code: 'authentication_failed',
      message: 'Authentication is required.',
      headers: { 'set-cookie': clearCookie() },
    };
  }
  if (error?.code === '42501') {
    return { status: 403, code: 'permission_denied', message: 'This operation is not permitted.', headers: {} };
  }
  if (error?.code === '22023') {
    return { status: 400, code: 'invalid_request', message: 'The request is invalid.', headers: {} };
  }
  if (error?.code === '40001') {
    return { status: 409, code: 'revision_conflict', message: 'The record changed. Refresh and try again.', headers: {} };
  }
  if (error?.code === 'P0002') {
    return { status: 404, code: 'memory_not_found', message: 'Memory was not found.', headers: {} };
  }
  return {
    status: 503,
    code: 'employee_service_unavailable',
    message: 'The employee workspace is temporarily unavailable.',
    headers: {},
  };
}

function sendError(res, error, method) {
  const resolved = resolvedError(error);
  json(res, resolved.status, { error: { code: resolved.code, message: resolved.message } }, method, resolved.headers);
}

function exactObject(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new EmployeeHttpError(400, 'invalid_request', 'Request body must be an object.');
  }
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new EmployeeHttpError(400, 'invalid_request', 'Request body fields do not match the endpoint contract.');
  }
  return value;
}

function text(value, label, { min = 1, max = 500 } = {}) {
  if (typeof value !== 'string' || value.includes('\u0000')) {
    throw new EmployeeHttpError(400, 'invalid_request', `${label} must be text.`);
  }
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) {
    throw new EmployeeHttpError(400, 'invalid_request', `${label} is invalid.`);
  }
  return normalized;
}

function integer(value, label, min = 0, max = 2_147_483_647) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new EmployeeHttpError(400, 'invalid_request', `${label} must be a valid integer.`);
  }
  return value;
}

function uuid(value, label) {
  const normalized = text(value, label, { max: 36 });
  if (!UUID.test(normalized)) throw new EmployeeHttpError(400, 'invalid_request', `${label} must be a UUID.`);
  return normalized.toLowerCase();
}

function stringArray(value, label, { maxItems, itemMax, pattern = null } = {}) {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new EmployeeHttpError(400, 'invalid_request', `${label} must be a bounded list.`);
  }
  const normalized = value.map((item) => {
    const entry = text(item, label, { max: itemMax });
    if (pattern && !pattern.test(entry)) {
      throw new EmployeeHttpError(400, 'invalid_request', `${label} contains an invalid value.`);
    }
    return entry;
  });
  if (new Set(normalized.map((entry) => entry.toLowerCase())).size !== normalized.length) {
    throw new EmployeeHttpError(400, 'invalid_request', `${label} must not contain duplicates.`);
  }
  return normalized;
}

function evidence(value) {
  if (!Array.isArray(value) || value.length > 12 || Buffer.byteLength(JSON.stringify(value)) > 12_000) {
    throw new EmployeeHttpError(400, 'invalid_request', 'evidence must be a bounded JSON list.');
  }
  return value.map((entry) => {
    if (typeof entry === 'string') return text(entry, 'evidence', { max: 1_000 });
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new EmployeeHttpError(400, 'invalid_request', 'evidence entries must be text or simple objects.');
    }
    const keys = Object.keys(entry);
    if (!keys.length || keys.length > 6) {
      throw new EmployeeHttpError(400, 'invalid_request', 'evidence entries are invalid.');
    }
    const normalized = {};
    for (const key of keys.sort()) {
      if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) {
        throw new EmployeeHttpError(400, 'invalid_request', 'evidence field names are invalid.');
      }
      normalized[key] = text(entry[key], `evidence.${key}`, { min: 0, max: 1_000 });
    }
    return normalized;
  });
}

function profileInput(value) {
  const input = exactObject(value, [
    'job_title', 'role_summary', 'expertise', 'working_style', 'current_goals', 'boundaries',
    'expected_revision',
  ]);
  return {
    job_title: text(input.job_title, 'job_title', { max: 160 }),
    role_summary: text(input.role_summary, 'role_summary', { min: 0, max: 2_000 }),
    expertise: stringArray(input.expertise, 'expertise', { maxItems: 24, itemMax: 120 }),
    working_style: text(input.working_style, 'working_style', { min: 0, max: 2_000 }),
    current_goals: stringArray(input.current_goals, 'current_goals', { maxItems: 12, itemMax: 240 }),
    boundaries: text(input.boundaries, 'boundaries', { min: 0, max: 2_000 }),
    expected_revision: integer(input.expected_revision, 'expected_revision', 0, 1_000_000),
  };
}

function memoryInput(value, { update = false } = {}) {
  const fields = [
    'type', 'title', 'content', 'context', 'why_it_worked', 'evidence', 'tags', 'sensitivity',
  ];
  if (update) fields.push('expected_revision');
  const input = exactObject(value, fields);
  const type = text(input.type, 'type', { max: 20 });
  const sensitivity = text(input.sensitivity, 'sensitivity', { max: 20 });
  if (!MEMORY_TYPES.has(type)) throw new EmployeeHttpError(400, 'invalid_request', 'type is unsupported.');
  if (!SENSITIVITIES.has(sensitivity)) {
    throw new EmployeeHttpError(400, 'invalid_request', 'sensitivity is unsupported.');
  }
  return {
    type,
    title: text(input.title, 'title', { max: 200 }),
    content: text(input.content, 'content', { max: 12_000 }),
    context: text(input.context, 'context', { min: 0, max: 4_000 }),
    why_it_worked: text(input.why_it_worked, 'why_it_worked', { min: 0, max: 4_000 }),
    evidence: evidence(input.evidence),
    tags: stringArray(input.tags, 'tags', {
      maxItems: 16,
      itemMax: 40,
      pattern: /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/,
    }),
    sensitivity,
    ...(update ? {
      expected_revision: integer(input.expected_revision, 'expected_revision', 1, 1_000_000),
    } : {}),
  };
}

async function readJson(req, maxBytes = 32_768) {
  if (req.headers['content-encoding']) {
    throw new EmployeeHttpError(415, 'content_encoding_not_supported', 'Compressed request bodies are not accepted.');
  }
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (contentType !== 'application/json' && !contentType.startsWith('application/json;')) {
    throw new EmployeeHttpError(415, 'unsupported_media_type', 'Content-Type must be application/json.');
  }
  const length = Number.parseInt(String(req.headers['content-length'] || ''), 10);
  if (Number.isFinite(length) && length > maxBytes) {
    req.resume();
    throw new EmployeeHttpError(413, 'request_body_too_large', 'Request body is too large.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      req.resume();
      throw new EmployeeHttpError(413, 'request_body_too_large', 'Request body is too large.');
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new EmployeeHttpError(400, 'invalid_json', 'Request body must be valid JSON.');
  }
}

function isLoopback(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function clientKey(req, { requireProxyClient = false } = {}) {
  if (requireProxyClient) {
    const proxyClient = String(req.headers['x-real-ip'] || '').trim();
    if (!net.isIP(proxyClient)) {
      throw new EmployeeHttpError(400, 'request_denied', 'Request is not allowed.');
    }
    return proxyClient;
  }
  const header = String(req.headers['x-forwarded-for'] || '').trim();
  if (header) {
    const forwarded = header.split(',').map((entry) => entry.trim());
    if (!forwarded.length || forwarded.some((entry) => !net.isIP(entry))) {
      throw new EmployeeHttpError(400, 'request_denied', 'Request is not allowed.');
    }
    return forwarded.at(-1);
  }
  return req.socket.remoteAddress || 'loopback';
}

function assertRequestContext(req, { allowedHost, allowedOrigin }) {
  if (!isLoopback(req.socket.remoteAddress)) {
    throw new EmployeeHttpError(403, 'request_denied', 'Request is not allowed.');
  }
  const host = String(req.headers.host || '');
  const hostname = host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.split(':')[0];
  const hostAllowed = allowedHost !== null
    ? host.toLowerCase() === allowedHost.toLowerCase()
    : ['127.0.0.1', 'localhost', '::1'].includes(hostname);
  if (!hostAllowed) throw new EmployeeHttpError(400, 'request_denied', 'Request is not allowed.');
  const originHeader = req.headers.origin;
  if (originHeader !== undefined) {
    let origin;
    try {
      origin = new URL(String(originHeader));
    } catch {
      throw new EmployeeHttpError(403, 'origin_denied', 'Request origin is not allowed.');
    }
    const originAllowed = allowedOrigin
      ? origin.origin === allowedOrigin
      : ['127.0.0.1', 'localhost', '::1'].includes(origin.hostname);
    if (!originAllowed) throw new EmployeeHttpError(403, 'origin_denied', 'Request origin is not allowed.');
  } else if (allowedOrigin && !['GET', 'HEAD'].includes(req.method)) {
    throw new EmployeeHttpError(403, 'origin_denied', 'Request origin is not allowed.');
  }
  if (String(req.headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') {
    throw new EmployeeHttpError(403, 'cross_site_denied', 'Cross-site requests are not allowed.');
  }
}

function parseCookie(req) {
  const values = String(req.headers.cookie || '').split(';').map((entry) => entry.trim()).filter(Boolean);
  const matches = values.filter((entry) => entry.startsWith(`${COOKIE_NAME}=`));
  return matches.length === 1 ? matches[0].slice(COOKIE_NAME.length + 1) : null;
}

function sessionCookie(token, maxAgeSeconds) {
  return `${COOKIE_NAME}=${token}; Path=${COOKIE_PATH}; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}; Secure`;
}

function clearCookie() {
  return `${COOKIE_NAME}=; Path=${COOKIE_PATH}; HttpOnly; SameSite=Strict; Max-Age=0; Secure`;
}

function noQuery(url) {
  if ([...url.searchParams.keys()].length) {
    throw new EmployeeHttpError(400, 'invalid_query_parameters', 'Endpoint does not accept query parameters.');
  }
}

function normalizedApiPath(pathname) {
  return pathname.startsWith('/workspace/api/') ? pathname.slice(COOKIE_PATH.length) : pathname;
}

async function serveStatic(req, res, staticDir, url) {
  const mountedPath = url.pathname === COOKIE_PATH || url.pathname.startsWith(`${COOKIE_PATH}/`);
  const trustedStrippedPrefix = String(req.headers['x-forwarded-prefix'] || '') === COOKIE_PATH;
  if (!['GET', 'HEAD'].includes(req.method) || (!mountedPath && !trustedStrippedPrefix)) return false;
  if (url.pathname === COOKIE_PATH) {
    send(res, 308, { ...STATIC_HEADERS, location: `${COOKIE_PATH}/`, 'content-length': '0' }, '', req.method);
    return true;
  }
  if (/%(?:2e|2f|5c|25)/i.test(url.pathname)) {
    throw new EmployeeHttpError(400, 'invalid_path', 'Request path is invalid.');
  }
  let requested;
  try {
    requested = decodeURIComponent(mountedPath
      ? url.pathname.slice(COOKIE_PATH.length)
      : url.pathname);
  } catch {
    throw new EmployeeHttpError(400, 'invalid_path', 'Request path is invalid.');
  }
  if (requested.includes('\u0000') || requested.includes('\\')) {
    throw new EmployeeHttpError(400, 'invalid_path', 'Request path is invalid.');
  }
  if (requested === '/') requested = '/index.html';
  const segments = requested.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..' || segment.startsWith('.'))) {
    throw new EmployeeHttpError(400, 'invalid_path', 'Request path is invalid.');
  }
  const root = path.resolve(staticDir);
  let filePath = path.resolve(root, `.${requested}`);
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) return false;
  let contentType = MIME_TYPES[path.extname(filePath).toLowerCase()];
  if (!contentType && !path.extname(filePath)) {
    filePath = path.join(root, 'index.html');
    contentType = MIME_TYPES['.html'];
  }
  if (!contentType) return false;
  let content;
  try {
    content = await fs.readFile(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'EISDIR') return false;
    throw error;
  }
  send(res, 200, {
    ...STATIC_HEADERS,
    'content-length': content.length,
    'content-type': contentType,
  }, content, req.method);
  return true;
}

function pruneAttempts(attempts, cutoff) {
  while (attempts.length && attempts[0] < cutoff) attempts.shift();
}

function knownMethods(apiPath) {
  if (apiPath === '/api/readyz') return ['GET'];
  if (apiPath === '/api/v1/session') return ['GET', 'POST', 'DELETE'];
  if (apiPath === '/api/v1/workspace') return ['GET'];
  if (apiPath === '/api/v1/profile') return ['PUT'];
  if (/^\/api\/v1\/profile\/(?:share|unshare)$/.test(apiPath)) return ['POST'];
  if (apiPath === '/api/v1/memories') return ['POST'];
  if (/^\/api\/v1\/memories\/[0-9a-f-]{36}$/i.test(apiPath)) return ['PUT'];
  if (/^\/api\/v1\/memories\/[0-9a-f-]{36}\/(?:share|unshare)$/i.test(apiPath)) return ['POST'];
  if (apiPath === '/api/v1/agent-context') return ['POST'];
  return null;
}

export function createEmployeeRequestHandler({
  repository,
  service,
  sessionManager,
  staticDir,
  allowedHost = null,
  allowedOrigin = null,
  sessionTtlSeconds = 1_800,
  logger = console,
} = {}) {
  if (!repository || !service || !sessionManager || !staticDir) {
    throw new TypeError('Employee handler dependencies are required.');
  }
  if (allowedOrigin !== null) {
    try {
      if (new URL(allowedOrigin).origin !== allowedOrigin) throw new Error();
    } catch {
      throw new TypeError('Employee allowed origin is invalid.');
    }
  }
  const failedLoginsByClient = new Map();
  const globalFailedLogins = [];
  const successfulLoginsByClient = new Map();
  const successfulLoginsByPrincipal = new Map();

  return async function employeeRequestHandler(req, res) {
    let sessionToken = null;
    try {
      assertRequestContext(req, { allowedHost, allowedOrigin });
      if (/%(?:2e|2f|5c|25)/i.test(String(req.url || '').split('?')[0])) {
        throw new EmployeeHttpError(400, 'invalid_path', 'Request path is invalid.');
      }
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const apiPath = normalizedApiPath(url.pathname);

      if (apiPath === '/api/readyz' && req.method === 'GET') {
        noQuery(url);
        const ready = await repository.readiness();
        json(res, ready ? 200 : 503, {
          status: ready ? 'ready' : 'not_ready',
          checks: { database: ready ? 'available' : 'unavailable' },
        }, req.method);
        return;
      }

      if (apiPath === '/api/v1/session' && req.method === 'POST') {
        noQuery(url);
        const current = Date.now();
        const cutoff = current - 60_000;
        const key = clientKey(req, { requireProxyClient: allowedHost !== null });
        const clientAttempts = failedLoginsByClient.get(key) || [];
        const clientSuccesses = successfulLoginsByClient.get(key) || [];
        const recordAuthenticationFailure = () => {
          clientAttempts.push(current);
          globalFailedLogins.push(current);
          failedLoginsByClient.set(key, clientAttempts);
          if (failedLoginsByClient.size > 2_048) {
            failedLoginsByClient.delete(failedLoginsByClient.keys().next().value);
          }
        };
        pruneAttempts(clientAttempts, cutoff);
        pruneAttempts(clientSuccesses, cutoff);
        pruneAttempts(globalFailedLogins, cutoff);
        if (clientAttempts.length >= 10 || globalFailedLogins.length >= 100
            || clientSuccesses.length >= 20) {
          throw new EmployeeHttpError(429, 'authentication_rate_limited', 'Too many sign-in attempts.', {
            'retry-after': '60',
          });
        }
        const input = exactObject(await readJson(req, 1_024), ['token']);
        const token = input.token;
        if (typeof token !== 'string' || !TOKEN.test(token)) {
          recordAuthenticationFailure();
          throw new EmployeeHttpError(401, 'authentication_failed', 'Authentication failed.');
        }
        const tokenSha256 = crypto.createHash('sha256').update(token).digest('hex');
        let actor;
        try {
          actor = await repository.resolveWorkspaceToken(tokenSha256);
        } catch (error) {
          const authenticationFailed = error?.code === '28000'
            || (error instanceof EmployeeRepositoryError && error.code === 'authentication_failed');
          if (!authenticationFailed) throw error;
          recordAuthenticationFailure();
          throw new EmployeeHttpError(401, 'authentication_failed', 'Authentication failed.');
        }
        const principalSuccesses = successfulLoginsByPrincipal.get(actor.principal_id) || [];
        pruneAttempts(principalSuccesses, cutoff);
        if (principalSuccesses.length >= 10) {
          throw new EmployeeHttpError(429, 'authentication_rate_limited', 'Too many sign-in attempts.', {
            'retry-after': '60',
          });
        }
        clientSuccesses.push(current);
        principalSuccesses.push(current);
        successfulLoginsByClient.set(key, clientSuccesses);
        successfulLoginsByPrincipal.set(actor.principal_id, principalSuccesses);
        if (successfulLoginsByClient.size > 2_048) {
          successfulLoginsByClient.delete(successfulLoginsByClient.keys().next().value);
        }
        if (successfulLoginsByPrincipal.size > 4_096) {
          successfulLoginsByPrincipal.delete(successfulLoginsByPrincipal.keys().next().value);
        }
        const issued = sessionManager.issue(actor, { databaseContextTokenSha256: tokenSha256 });
        json(res, 201, { data: { session: issued.session, csrf_token: issued.csrfToken } }, req.method, {
          'set-cookie': sessionCookie(issued.sessionToken, sessionTtlSeconds),
        });
        return;
      }

      sessionToken = parseCookie(req);
      const session = sessionManager.resolve(sessionToken);
      if (apiPath.startsWith('/api/')) {
        if (!session) {
          throw new EmployeeHttpError(401, 'authentication_failed', 'Authentication is required.', {
            'set-cookie': clearCookie(),
          });
        }
        if (!['GET', 'HEAD'].includes(req.method)) {
          const csrf = String(req.headers['x-oam-csrf-token'] || '');
          if (!sessionManager.verifyCsrf(session, csrf)) {
            throw new EmployeeHttpError(403, 'csrf_failed', 'CSRF token is invalid.');
          }
        }
      }

      if (apiPath === '/api/v1/session' && req.method === 'GET') {
        noQuery(url);
        await service.validateSession(session.actor);
        const csrfToken = sessionManager.csrfToken(sessionToken);
        json(res, 200, { data: {
          session: {
            actor: session.actor,
            created_at: new Date(session.createdAt).toISOString(),
            expires_at: new Date(session.expiresAt).toISOString(),
          },
          csrf_token: csrfToken,
        } }, req.method);
        return;
      }
      if (apiPath === '/api/v1/session' && req.method === 'DELETE') {
        noQuery(url);
        sessionManager.destroy(sessionToken);
        json(res, 200, { data: { signed_out: true } }, req.method, { 'set-cookie': clearCookie() });
        return;
      }
      if (apiPath === '/api/v1/workspace' && req.method === 'GET') {
        noQuery(url);
        json(res, 200, { data: await service.workspace(session.actor) }, req.method);
        return;
      }
      if (apiPath === '/api/v1/profile' && req.method === 'PUT') {
        noQuery(url);
        json(res, 200, {
          data: await service.updateProfile(session.actor, profileInput(await readJson(req, 65_536))),
        }, req.method);
        return;
      }
      const profileVisibilityMatch = apiPath.match(/^\/api\/v1\/profile\/(share|unshare)$/);
      if (profileVisibilityMatch && req.method === 'POST') {
        noQuery(url);
        const input = exactObject(await readJson(req, 1_024), ['expected_revision']);
        const expectedRevision = integer(
          input.expected_revision,
          'expected_revision',
          1,
          1_000_000,
        );
        const result = profileVisibilityMatch[1] === 'share'
          ? await service.shareProfile(session.actor, expectedRevision)
          : await service.unshareProfile(session.actor, expectedRevision);
        json(res, 200, { data: result }, req.method);
        return;
      }
      if (apiPath === '/api/v1/memories' && req.method === 'POST') {
        noQuery(url);
        json(res, 201, {
          data: await service.createMemory(session.actor, memoryInput(await readJson(req, 131_072))),
        }, req.method);
        return;
      }
      const memoryMatch = apiPath.match(/^\/api\/v1\/memories\/([0-9a-f-]{36})$/i);
      if (memoryMatch && req.method === 'PUT') {
        noQuery(url);
        json(res, 200, { data: await service.updateMemory(
          session.actor,
          uuid(memoryMatch[1], 'memory_id'),
          memoryInput(await readJson(req, 131_072), { update: true }),
        ) }, req.method);
        return;
      }
      const visibilityMatch = apiPath.match(/^\/api\/v1\/memories\/([0-9a-f-]{36})\/(share|unshare)$/i);
      if (visibilityMatch && req.method === 'POST') {
        noQuery(url);
        const input = exactObject(await readJson(req, 1_024), ['expected_revision']);
        const result = visibilityMatch[2] === 'share'
          ? await service.shareMemory(
              session.actor,
              uuid(visibilityMatch[1], 'memory_id'),
              integer(input.expected_revision, 'expected_revision', 1, 1_000_000),
            )
          : await service.unshareMemory(
              session.actor,
              uuid(visibilityMatch[1], 'memory_id'),
              integer(input.expected_revision, 'expected_revision', 1, 1_000_000),
            );
        json(res, 200, { data: result }, req.method);
        return;
      }
      if (apiPath === '/api/v1/agent-context' && req.method === 'POST') {
        noQuery(url);
        const input = exactObject(await readJson(req, 4_096), ['query']);
        json(res, 200, { data: await service.agentContext(
          session.actor,
          text(input.query, 'query', { min: 2, max: 200 }),
        ) }, req.method);
        return;
      }

      if (apiPath.startsWith('/api/')) {
        const allowed = knownMethods(apiPath);
        if (allowed) {
          throw new EmployeeHttpError(405, 'method_not_allowed', 'Method is not allowed.', {
            allow: allowed.join(', '),
          });
        }
        throw new EmployeeHttpError(404, 'not_found', 'Employee API route not found.');
      }
      if (await serveStatic(req, res, staticDir, url)) return;
      throw new EmployeeHttpError(404, 'not_found', 'Resource not found.');
    } catch (error) {
      if ((error?.code === '28000'
          || (error instanceof EmployeeRepositoryError && error.code === 'authentication_failed'))
          && sessionToken) sessionManager.destroy(sessionToken);
      const known = error instanceof EmployeeHttpError || error instanceof EmployeeRepositoryError
        || ['22023', '28000', '40001', '42501', 'P0002'].includes(error?.code);
      if (!known) {
        logger.error?.('Employee request failed.', {
          error_name: error?.name || 'Error',
          method: req.method,
        });
      }
      if (!res.headersSent) sendError(res, error, req.method);
      else res.destroy();
    }
  };
}

export const employeeHttpContract = Object.freeze({
  cookieName: COOKIE_NAME,
  cookiePath: COOKIE_PATH,
  memoryTypes: Object.freeze([...MEMORY_TYPES]),
  sensitivities: Object.freeze([...SENSITIVITIES]),
});
