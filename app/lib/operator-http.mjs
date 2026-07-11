import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { IdentityDataPlaneError } from './identity-data-plane.mjs';
import { OperatorRepositoryError } from './operator-repository.mjs';
import { OperatorServiceError } from './operator-service.mjs';

const COOKIE_NAME = 'oam_operator_session';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_KEY = /^[a-z][a-z0-9_.:-]{1,159}$/;
const PRINCIPAL_KEY = /^human:[a-z0-9][a-z0-9_.-]{1,118}$/;
const API_HEADERS = Object.freeze({
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
});
const STATIC_HEADERS = Object.freeze({
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'",
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
});
const MIME_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.woff2': 'font/woff2',
});

class OperatorHttpError extends Error {
  constructor(status, code, message, headers = {}) {
    super(message);
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

function errorStatus(error) {
  if (error instanceof OperatorHttpError || error instanceof OperatorServiceError) {
    return { status: error.status, code: error.code, message: error.message, headers: error.headers || {} };
  }
  if (error instanceof IdentityDataPlaneError || error instanceof OperatorRepositoryError) {
    const conflicts = new Set([
      'principal_conflict', 'provisioning_conflict', 'upload_conflict', 'policy_changed',
    ]);
    const notFound = new Set(['principal_not_found', 'candidate_not_found']);
    return {
      status: error.code === 'permission_denied' ? 403 : notFound.has(error.code) ? 404 : conflicts.has(error.code) ? 409 : 400,
      code: error.code,
      message: error.message,
      headers: {},
    };
  }
  return {
    status: 503,
    code: 'operator_service_unavailable',
    message: 'The operator service is temporarily unavailable.',
    headers: {},
  };
}

function sendError(res, error, method) {
  const resolved = errorStatus(error);
  json(res, resolved.status, { error: { code: resolved.code, message: resolved.message } }, method, resolved.headers);
}

function exactObject(value, fields, code = 'invalid_request') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OperatorHttpError(400, code, 'Request body must be an object with the documented fields only.');
  }
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new OperatorHttpError(400, code, 'Request body fields do not match the endpoint contract.');
  }
  return value;
}

function string(value, label, { min = 1, max = 500, pattern } = {}) {
  if (typeof value !== 'string') throw new OperatorHttpError(400, 'invalid_request', `${label} must be a string.`);
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max || (pattern && !pattern.test(normalized))) {
    throw new OperatorHttpError(400, 'invalid_request', `${label} is invalid.`);
  }
  return normalized;
}

function rawText(value, label, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new OperatorHttpError(400, 'invalid_request', `${label} is invalid.`);
  }
  return value;
}

function uuid(value, label) {
  const normalized = string(value, label, { max: 36 });
  if (!UUID.test(normalized)) throw new OperatorHttpError(400, 'invalid_request', `${label} must be a UUID.`);
  return normalized.toLowerCase();
}

function integer(value, label, min = 0, max = 1_000_000) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new OperatorHttpError(400, 'invalid_request', `${label} must be an integer.`);
  }
  return value;
}

function object(value, label, maxBytes = 32_768) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OperatorHttpError(400, 'invalid_request', `${label} must be an object.`);
  }
  if (Buffer.byteLength(JSON.stringify(value)) > maxBytes) {
    throw new OperatorHttpError(413, 'request_body_too_large', `${label} is too large.`);
  }
  return value;
}

async function readJson(req, maxBytes = 65_536) {
  if (req.headers['content-encoding']) {
    throw new OperatorHttpError(415, 'content_encoding_not_supported', 'Compressed request bodies are not accepted.');
  }
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    throw new OperatorHttpError(415, 'unsupported_media_type', 'Content-Type must be application/json.');
  }
  const length = Number.parseInt(String(req.headers['content-length'] || ''), 10);
  if (Number.isFinite(length) && length > maxBytes) {
    req.resume();
    throw new OperatorHttpError(413, 'request_body_too_large', 'Request body is too large.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      req.resume();
      throw new OperatorHttpError(413, 'request_body_too_large', 'Request body is too large.');
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new OperatorHttpError(400, 'invalid_json', 'Request body must be valid JSON.');
  }
}

function isLoopback(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function operatorClientKey(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => net.isIP(value));
  return forwarded.at(-1) || req.socket.remoteAddress || 'loopback';
}

function pruneAttempts(attempts, cutoff) {
  while (attempts.length && attempts[0] < cutoff) attempts.shift();
}

function assertLoopbackRequest(req, { allowedHost, allowedOrigin }) {
  if (!isLoopback(req.socket.remoteAddress)) {
    throw new OperatorHttpError(403, 'loopback_required', 'Operator console accepts loopback requests only.');
  }
  const host = String(req.headers.host || '');
  const hostname = host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.split(':')[0];
  const loopbackHost = ['127.0.0.1', 'localhost', '::1'].includes(hostname);
  const hostAllowed = loopbackHost
    || (allowedHost !== null && host.toLowerCase() === allowedHost.toLowerCase());
  if (!hostAllowed) {
    throw new OperatorHttpError(400, 'loopback_host_required', 'Host must identify the loopback interface.');
  }
  if (req.headers.origin) {
    let origin;
    try {
      origin = new URL(String(req.headers.origin));
    } catch {
      throw new OperatorHttpError(403, 'origin_denied', 'Request origin is not allowed.');
    }
    const originAllowed = allowedOrigin
      ? origin.origin === allowedOrigin
      : origin.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(origin.hostname);
    if (!originAllowed) {
      throw new OperatorHttpError(403, 'origin_denied', 'Request origin is not allowed.');
    }
  }
  if (String(req.headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') {
    throw new OperatorHttpError(403, 'cross_site_denied', 'Cross-site requests are not allowed.');
  }
}

function parseCookie(req) {
  const header = String(req.headers.cookie || '');
  const values = header.split(';').map((item) => item.trim()).filter(Boolean);
  const matches = values.filter((item) => item.startsWith(`${COOKIE_NAME}=`));
  if (matches.length !== 1) return null;
  return matches[0].slice(COOKIE_NAME.length + 1);
}

function sessionCookie(token, maxAgeSeconds, secure, cookiePath) {
  return `${COOKIE_NAME}=${token}; Path=${cookiePath}; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}

function clearCookie(secure, cookiePath) {
  return `${COOKIE_NAME}=; Path=${cookiePath}; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
}

function noQuery(url) {
  if ([...url.searchParams.keys()].length) {
    throw new OperatorHttpError(400, 'invalid_query_parameters', 'Endpoint does not accept query parameters.');
  }
}

async function serveStatic(req, res, staticDir, url) {
  if (!['GET', 'HEAD'].includes(req.method)) return false;
  if (/%(?:2e|2f|5c|25)/i.test(url.pathname)) {
    throw new OperatorHttpError(400, 'invalid_path', 'Encoded traversal is not allowed.');
  }
  let requested;
  try {
    requested = decodeURIComponent(url.pathname);
  } catch {
    throw new OperatorHttpError(400, 'invalid_path', 'Request path is invalid.');
  }
  if (requested.includes('\u0000') || requested.includes('\\')) {
    throw new OperatorHttpError(400, 'invalid_path', 'Request path is invalid.');
  }
  if (requested === '/') requested = '/index.html';
  const segments = requested.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..' || segment.startsWith('.'))) {
    throw new OperatorHttpError(400, 'invalid_path', 'Hidden and traversal paths are not allowed.');
  }
  const root = path.resolve(staticDir);
  const filePath = path.resolve(root, `.${requested}`);
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) return false;
  const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()];
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

function auditFilters(url) {
  const allowed = new Set(['resource_type', 'resource_key', 'actor_principal_id', 'limit']);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) {
      throw new OperatorHttpError(400, 'invalid_query_parameters', 'Audit query parameters are invalid.');
    }
  }
  const resourceType = url.searchParams.get('resource_type');
  const resourceKey = url.searchParams.get('resource_key');
  const actor = url.searchParams.get('actor_principal_id');
  const limitRaw = url.searchParams.get('limit');
  return {
    resource_type: resourceType === null ? null : string(resourceType, 'resource_type', { max: 80, pattern: SAFE_KEY }),
    resource_key: resourceKey === null ? null : string(resourceKey, 'resource_key', { max: 500 }),
    actor_principal_id: actor === null ? null : uuid(actor, 'actor_principal_id'),
    limit: limitRaw === null ? 100 : integer(Number(limitRaw), 'limit', 1, 500),
  };
}

export function createOperatorRequestHandler({
  repository,
  service,
  sessionManager,
  staticDir,
  secureCookies = false,
  cookiePath = '/',
  allowedHost = null,
  allowedOrigin = null,
  sessionTtlSeconds = 1_800,
  logger = console,
} = {}) {
  if (!repository || !service || !sessionManager || !staticDir) {
    throw new TypeError('Operator handler dependencies are required.');
  }
  if (typeof cookiePath !== 'string' || !/^\/[A-Za-z0-9/_-]*$/.test(cookiePath)) {
    throw new TypeError('Operator cookie path is invalid.');
  }
  if (allowedOrigin !== null) {
    try {
      if (new URL(allowedOrigin).origin !== allowedOrigin) throw new Error();
    } catch {
      throw new TypeError('Operator allowed origin is invalid.');
    }
  }
  const failedLoginsByClient = new Map();
  const globalFailedLogins = [];

  return async function operatorRequestHandler(req, res) {
    try {
      assertLoopbackRequest(req, { allowedHost, allowedOrigin });
      if (/%(?:2e|2f|5c|25)/i.test(String(req.url || '').split('?')[0])) {
        throw new OperatorHttpError(400, 'invalid_path', 'Encoded traversal is not allowed.');
      }
      const url = new URL(req.url || '/', 'http://127.0.0.1');

      if (url.pathname === '/api/v1/session' && req.method === 'POST') {
        noQuery(url);
        const current = Date.now();
        const cutoff = current - 60_000;
        const clientKey = operatorClientKey(req);
        const clientFailedLogins = failedLoginsByClient.get(clientKey) || [];
        pruneAttempts(clientFailedLogins, cutoff);
        pruneAttempts(globalFailedLogins, cutoff);
        if (clientFailedLogins.length >= 10 || globalFailedLogins.length >= 100) {
          throw new OperatorHttpError(429, 'authentication_rate_limited', 'Too many failed sign-in attempts.', {
            'retry-after': '60',
          });
        }
        const input = exactObject(await readJson(req, 1_024), ['token']);
        const token = string(input.token, 'token', { min: 32, max: 128, pattern: /^[A-Za-z0-9_-]+$/ });
        const mapped = sessionManager.authenticate(token);
        if (!mapped) {
          clientFailedLogins.push(current);
          globalFailedLogins.push(current);
          failedLoginsByClient.set(clientKey, clientFailedLogins);
          if (failedLoginsByClient.size > 2_048) {
            const oldestKey = failedLoginsByClient.keys().next().value;
            failedLoginsByClient.delete(oldestKey);
          }
          throw new OperatorHttpError(401, 'authentication_failed', 'Operator token is invalid.');
        }
        failedLoginsByClient.delete(clientKey);
        const actor = await repository.resolveOperator(mapped);
        const issued = sessionManager.issue(actor, {
          databaseContextTokenSha256: mapped.token_sha256,
        });
        json(res, 201, {
          data: { session: issued.session, csrf_token: issued.csrfToken },
        }, req.method, {
          'set-cookie': sessionCookie(
            issued.sessionToken,
            sessionTtlSeconds,
            secureCookies,
            cookiePath,
          ),
        });
        return;
      }

      const sessionToken = parseCookie(req);
      const session = sessionManager.resolve(sessionToken);
      if (url.pathname.startsWith('/api/')) {
        if (!session) throw new OperatorHttpError(401, 'session_required', 'An authenticated operator session is required.');
        if (!['GET', 'HEAD'].includes(req.method)) {
          const csrf = String(req.headers['x-oam-csrf-token'] || '');
          if (!sessionManager.verifyCsrf(session, csrf)) {
            throw new OperatorHttpError(403, 'csrf_failed', 'CSRF token is invalid.');
          }
        }
      }

      if (url.pathname === '/api/v1/session' && req.method === 'GET') {
        noQuery(url);
        const csrfToken = sessionManager.rotateCsrf(session);
        json(res, 200, {
          data: {
            session: {
              actor: session.actor,
              created_at: new Date(session.createdAt).toISOString(),
              expires_at: new Date(session.expiresAt).toISOString(),
            },
            csrf_token: csrfToken,
          },
        }, req.method);
        return;
      }
      if (url.pathname === '/api/v1/session' && req.method === 'DELETE') {
        noQuery(url);
        sessionManager.destroy(sessionToken);
        json(res, 200, { data: { signed_out: true } }, req.method, {
          'set-cookie': clearCookie(secureCookies, cookiePath),
        });
        return;
      }
      if (url.pathname === '/api/v1/state' && req.method === 'GET') {
        noQuery(url);
        json(res, 200, { data: await service.state(session.actor) }, req.method);
        return;
      }
      const accessMatch = url.pathname.match(/^\/api\/v1\/access\/([0-9a-f-]{36})$/i);
      if (accessMatch && req.method === 'GET') {
        const allowed = new Set(['department_id']);
        for (const key of url.searchParams.keys()) {
          if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) {
            throw new OperatorHttpError(400, 'invalid_query_parameters', 'Access query accepts department_id only.');
          }
        }
        const departmentId = url.searchParams.has('department_id')
          ? uuid(url.searchParams.get('department_id'), 'department_id')
          : session.actor.department_id;
        json(res, 200, {
          data: await service.effectiveAccess(session.actor, uuid(accessMatch[1], 'principal_id'), departmentId),
        }, req.method);
        return;
      }
      if (url.pathname === '/api/v1/humans' && req.method === 'POST') {
        noQuery(url);
        const input = exactObject(await readJson(req), [
          'principal_key', 'display_name', 'external_issuer', 'external_subject', 'membership_role',
        ]);
        const role = string(input.membership_role, 'membership_role', { max: 20 });
        if (!['member', 'reviewer', 'architect'].includes(role)) {
          throw new OperatorHttpError(400, 'invalid_request', 'membership_role is unsupported.');
        }
        json(res, 201, { data: await service.createHuman(session.actor, {
          principal_key: string(input.principal_key, 'principal_key', { max: 120, pattern: PRINCIPAL_KEY }),
          display_name: string(input.display_name, 'display_name', { max: 200 }),
          external_issuer: string(input.external_issuer, 'external_issuer', { max: 500 }),
          external_subject: string(input.external_subject, 'external_subject', { max: 500 }),
          membership_role: role,
        }) }, req.method);
        return;
      }
      if (url.pathname === '/api/v1/agents' && req.method === 'POST') {
        noQuery(url);
        const input = exactObject(await readJson(req), ['display_name']);
        json(res, 201, { data: await service.createAgent(session.actor, {
          display_name: string(input.display_name, 'display_name', { max: 200 }),
        }) }, req.method);
        return;
      }
      if (url.pathname === '/api/v1/provisioning/plans' && req.method === 'POST') {
        noQuery(url);
        const input = exactObject(await readJson(req), ['principal_id', 'operation']);
        const operation = string(input.operation, 'operation', { max: 40 });
        if (!['provision_agent', 'resume_agent', 'verify_agent'].includes(operation)) {
          throw new OperatorHttpError(400, 'invalid_request', 'operation is unsupported.');
        }
        json(res, 202, { data: await service.queueProvisioning(session.actor, {
          principal_id: uuid(input.principal_id, 'principal_id'), operation,
        }) }, req.method);
        return;
      }
      const confirmMatch = url.pathname.match(/^\/api\/v1\/provisioning\/plans\/([0-9a-f-]{36})\/confirm$/i);
      if (confirmMatch && req.method === 'POST') {
        noQuery(url);
        const input = exactObject(await readJson(req), ['expected_revision']);
        json(res, 200, { data: await service.confirmProvisioning(
          session.actor,
          uuid(confirmMatch[1], 'job_id'),
          { expected_revision: integer(input.expected_revision, 'expected_revision') },
        ) }, req.method);
        return;
      }
      if (url.pathname === '/api/v1/proofs' && req.method === 'POST') {
        noQuery(url);
        const input = exactObject(await readJson(req), [
          'proof_key', 'target_kind', 'target_key', 'status', 'commands', 'evidence',
        ]);
        const targetKind = string(input.target_kind, 'target_kind', { max: 40 });
        const status = string(input.status, 'status', { max: 20 });
        if (!['principal', 'runtime_binding', 'systemd_unit', 'postgres_role', 'workspace'].includes(targetKind)) {
          throw new OperatorHttpError(400, 'invalid_request', 'target_kind is unsupported.');
        }
        if (!['passed', 'failed', 'inconclusive'].includes(status)) {
          throw new OperatorHttpError(400, 'invalid_request', 'status is unsupported.');
        }
        if (!Array.isArray(input.commands) || input.commands.length < 1 || input.commands.length > 64) {
          throw new OperatorHttpError(400, 'invalid_request', 'commands must contain between 1 and 64 entries.');
        }
        json(res, 201, { data: await service.recordProof(session.actor, {
          proof_key: string(input.proof_key, 'proof_key', { max: 120, pattern: SAFE_KEY }),
          target_kind: targetKind,
          target_key: string(input.target_key, 'target_key', { max: 500 }),
          status,
          commands: input.commands,
          evidence: object(input.evidence, 'evidence'),
        }) }, req.method);
        return;
      }
      const suspensionMatch = url.pathname.match(/^\/api\/v1\/principals\/([0-9a-f-]{36})\/suspend$/i);
      if (suspensionMatch && req.method === 'POST') {
        noQuery(url);
        const input = exactObject(await readJson(req), ['reason']);
        json(res, 200, { data: await service.suspendPrincipal(
          session.actor,
          uuid(suspensionMatch[1], 'principal_id'),
          { reason: string(input.reason, 'reason', { max: 2_000 }) },
        ) }, req.method);
        return;
      }
      if (url.pathname === '/api/v1/uploads' && req.method === 'POST') {
        noQuery(url);
        const input = exactObject(await readJson(req, 1_100_000), ['original_name', 'media_type', 'content']);
        const mediaType = string(input.media_type, 'media_type', { max: 40 });
        if (!['text/plain', 'text/markdown'].includes(mediaType)) {
          throw new OperatorHttpError(415, 'unsupported_media_type', 'Only plain text and Markdown uploads are accepted.');
        }
        const originalName = string(input.original_name, 'original_name', { max: 255 });
        if (originalName.includes('/') || originalName.includes('\\')) {
          throw new OperatorHttpError(400, 'invalid_request', 'original_name must not contain a path.');
        }
        json(res, 201, { data: await service.createUpload(session.actor, {
          original_name: originalName,
          media_type: mediaType,
          content: rawText(input.content, 'content', 1_048_576),
        }) }, req.method);
        return;
      }
      const uploadCandidateMatch = url.pathname.match(/^\/api\/v1\/uploads\/([0-9a-f-]{36})\/candidates$/i);
      if (uploadCandidateMatch && req.method === 'POST') {
        noQuery(url);
        const input = exactObject(await readJson(req), ['candidate_type', 'title', 'payload']);
        const candidateType = string(input.candidate_type, 'candidate_type', { max: 40 });
        if (!['prompt', 'workflow', 'agent', 'decision_pattern', 'best_practice'].includes(candidateType)) {
          throw new OperatorHttpError(400, 'invalid_request', 'candidate_type is unsupported.');
        }
        json(res, 201, { data: await service.createCandidate(
          session.actor,
          uuid(uploadCandidateMatch[1], 'upload_id'),
          {
            candidate_type: candidateType,
            title: string(input.title, 'title', { max: 240 }),
            payload: object(input.payload, 'payload'),
          },
        ) }, req.method);
        return;
      }
      if (url.pathname === '/api/v1/candidates' && req.method === 'GET') {
        noQuery(url);
        json(res, 200, { data: await service.candidates(session.actor) }, req.method);
        return;
      }
      const reviewMatch = url.pathname.match(/^\/api\/v1\/candidates\/([0-9a-f-]{36})\/reviews$/i);
      if (reviewMatch && req.method === 'POST') {
        noQuery(url);
        const input = exactObject(await readJson(req), ['action', 'reason', 'expected_revision']);
        const action = string(input.action, 'action', { max: 40 });
        if (!['approve_for_draft', 'reject'].includes(action)) {
          throw new OperatorHttpError(400, 'invalid_request', 'action is unsupported.');
        }
        json(res, 201, { data: await service.reviewCandidate(
          session.actor,
          uuid(reviewMatch[1], 'candidate_id'),
          {
            action,
            reason: string(input.reason, 'reason', { max: 2_000 }),
            expected_revision: integer(input.expected_revision, 'expected_revision'),
          },
        ) }, req.method);
        return;
      }
      const promoteMatch = url.pathname.match(/^\/api\/v1\/candidates\/([0-9a-f-]{36})\/promote$/i);
      if (promoteMatch && req.method === 'POST') {
        noQuery(url);
        const input = exactObject(await readJson(req), ['expected_revision']);
        json(res, 201, { data: await service.promoteCandidate(
          session.actor,
          uuid(promoteMatch[1], 'candidate_id'),
          { expected_revision: integer(input.expected_revision, 'expected_revision') },
        ) }, req.method);
        return;
      }
      if (url.pathname === '/api/v1/audit' && req.method === 'GET') {
        json(res, 200, { data: await service.audit(session.actor, auditFilters(url)) }, req.method);
        return;
      }
      if (url.pathname.startsWith('/api/')) {
        throw new OperatorHttpError(404, 'not_found', 'Operator API route not found.');
      }
      if (await serveStatic(req, res, staticDir, url)) return;
      throw new OperatorHttpError(404, 'not_found', 'Resource not found.');
    } catch (error) {
      if (!(error instanceof OperatorHttpError) && !(error instanceof OperatorServiceError)
          && !(error instanceof IdentityDataPlaneError) && !(error instanceof OperatorRepositoryError)) {
        logger.error?.('Operator request failed.', { error_name: error?.name || 'Error' });
      }
      if (!res.headersSent) sendError(res, error, req.method);
      else res.destroy();
    }
  };
}

export const operatorHttpContract = Object.freeze({ cookieName: COOKIE_NAME, isLoopback });
