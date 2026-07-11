import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createEmployeeContextPool } from '../../app/lib/employee-db-context.mjs';
import { createEmployeeRequestHandler } from '../../app/lib/employee-http.mjs';
import {
  createEmployeeRepository,
  EmployeeRepositoryError,
} from '../../app/lib/employee-repository.mjs';
import { createEmployeeService } from '../../app/lib/employee-service.mjs';
import { createEmployeeSessionManager } from '../../app/lib/employee-session.mjs';

const TOKEN = 'A'.repeat(43);
const HUMAN_ID = '00000000-0000-4000-8000-000000000001';
const DEPARTMENT_ID = '00000000-0000-4000-8000-000000000002';
const AGENT_ID = '00000000-0000-4000-8000-000000000003';
const MEMORY_ID = '00000000-0000-4000-8000-000000000004';

const actor = Object.freeze({
  principal_id: HUMAN_ID,
  principal_key: 'human:maya.chen',
  display_name: 'Maya Chen',
  membership_role: 'member',
  department_id: DEPARTMENT_ID,
  department_key: 'website_delivery',
  department_name: 'Website Delivery',
  agent_id: AGENT_ID,
  agent_key: 'agent:maya.chen',
  agent_display_name: 'Maya Personal Agent',
});

function request({ port, method = 'GET', requestPath = '/', headers = {}, body, rawBody }) {
  return new Promise((resolve, reject) => {
    const payload = rawBody !== undefined ? rawBody : body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: requestPath,
      method,
      headers: {
        ...(payload === null ? {} : {
          'content-length': Buffer.byteLength(payload),
          'content-type': 'application/json',
        }),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const responseText = Buffer.concat(chunks).toString('utf8');
        let payloadValue = null;
        try { payloadValue = responseText ? JSON.parse(responseText) : null; } catch {}
        resolve({ status: res.statusCode, headers: res.headers, text: responseText, payload: payloadValue });
      });
    });
    req.on('error', reject);
    req.end(payload);
  });
}

function cookie(setCookie) {
  return String(setCookie).split(';')[0];
}

async function fixture(t, options = {}) {
  const staticDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oam-employee-http-'));
  await fs.writeFile(path.join(staticDir, 'index.html'), '<!doctype html><title>Employee workspace</title>');
  await fs.writeFile(path.join(staticDir, 'app.js'), 'globalThis.employeeWorkspace = true;');
  await fs.writeFile(path.join(staticDir, '.env'), 'never serve this');
  t.after(() => fs.rm(staticDir, { recursive: true, force: true }));
  const calls = [];
  const repository = options.repository || {
    async readiness() { return true; },
    async resolveWorkspaceToken(tokenSha256) {
      calls.push({ method: 'resolveWorkspaceToken', tokenSha256 });
      return actor;
    },
  };
  const service = options.service || {
    async validateSession(receivedActor) {
      calls.push({ method: 'validateSession', actor: receivedActor });
      return true;
    },
    async workspace(receivedActor) {
      calls.push({ method: 'workspace', actor: receivedActor });
      return { actor, personal_agent: { id: AGENT_ID }, profile: null, memories: [] };
    },
    async updateProfile(receivedActor, input) {
      calls.push({ method: 'updateProfile', actor: receivedActor, input });
      return { revision: input.expected_revision + 1 };
    },
    async shareProfile(receivedActor, revision) {
      calls.push({ method: 'shareProfile', actor: receivedActor, revision });
      return {
        revision: revision + 1,
        sharing_scope: 'owner_and_personal_agent',
        agent_shared: true,
      };
    },
    async unshareProfile(receivedActor, revision) {
      calls.push({ method: 'unshareProfile', actor: receivedActor, revision });
      return { revision: revision + 1, sharing_scope: 'owner_only', agent_shared: false };
    },
    async createMemory(receivedActor, input) {
      calls.push({ method: 'createMemory', actor: receivedActor, input });
      const { type, ...payload } = input;
      return {
        id: MEMORY_ID,
        current_revision: 1,
        revision: 1,
        memory_type: type,
        sharing_scope: 'owner_only',
        agent_shared: false,
        ...payload,
      };
    },
    async updateMemory(receivedActor, id, input) {
      calls.push({ method: 'updateMemory', actor: receivedActor, id, input });
      return {
        id,
        current_revision: input.expected_revision + 1,
        revision: input.expected_revision + 1,
        sharing_scope: 'owner_only',
        agent_shared: false,
      };
    },
    async shareMemory(receivedActor, id, revision) {
      calls.push({ method: 'shareMemory', actor: receivedActor, id, revision });
      return {
        id,
        current_revision: revision + 1,
        revision: revision + 1,
        sharing_scope: 'owner_and_personal_agent',
        agent_shared: true,
      };
    },
    async unshareMemory(receivedActor, id, revision) {
      calls.push({ method: 'unshareMemory', actor: receivedActor, id, revision });
      return {
        id,
        current_revision: revision + 1,
        revision: revision + 1,
        sharing_scope: 'owner_only',
        agent_shared: false,
      };
    },
    async agentContext(receivedActor, query) {
      calls.push({ method: 'agentContext', actor: receivedActor, query });
      return {
        authorization: 'allowed',
        principal: { human_id: HUMAN_ID, agent_id: AGENT_ID, department_id: DEPARTMENT_ID },
        query: { text: query, limit: 10, matched_count: 1 },
        status: 'matched',
        mode: 'deterministic_personal_memory',
        answer: '1. Verify the public route\nCheck it immediately before handoff.',
        citations: [{
          memory_id: MEMORY_ID,
          title: 'Verify the public route',
          memory_type: 'experience',
          revision: 2,
          content_sha256: 'd'.repeat(64),
          excerpt: 'Check it immediately before handoff.',
          visibility: 'personal_agent',
        }],
        limitations: ['Only explicitly shared current versions were searched.'],
        items: [{ id: MEMORY_ID, revision: 2, content_sha256: 'd'.repeat(64) }],
      };
    },
  };
  const handler = createEmployeeRequestHandler({
    repository,
    service,
    sessionManager: createEmployeeSessionManager(),
    staticDir,
    logger: options.logger || { error() {} },
    ...options.handler,
  });
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { port: server.address().port, calls };
}

async function login(app, requestPath = '/api/v1/session', headers = {}) {
  return request({
    port: app.port,
    method: 'POST',
    requestPath,
    headers: { host: `127.0.0.1:${app.port}`, ...headers },
    body: { token: TOKEN },
  });
}

const profile = Object.freeze({
  job_title: 'Delivery Lead',
  role_summary: 'Ships reviewed customer websites.',
  expertise: ['Release handoffs', 'Accessibility'],
  working_style: 'Evidence before assumptions.',
  current_goals: ['Reduce release rework'],
  boundaries: 'No production writes without approval.',
  expected_revision: 0,
});

const memory = Object.freeze({
  type: 'experience',
  title: 'Verify the public route',
  content: 'Check the public hostname immediately before handoff.',
  context: 'Website release',
  why_it_worked: 'It catches reverse-proxy drift.',
  evidence: [{ kind: 'metric', note: 'Zero missed routes' }],
  tags: ['release', 'handoff'],
  sensitivity: 'private',
});

test('workspace token is hashed before repository access and session cookie is fully scoped', async (t) => {
  const app = await fixture(t);
  const response = await login(app);
  assert.equal(response.status, 201);
  assert.match(response.headers['set-cookie'][0], /oam_employee_session=/);
  assert.match(response.headers['set-cookie'][0], /Path=\/workspace/);
  assert.match(response.headers['set-cookie'][0], /HttpOnly/);
  assert.match(response.headers['set-cookie'][0], /SameSite=Strict/);
  assert.match(response.headers['set-cookie'][0], /Secure$/);
  const authCall = app.calls.find((call) => call.method === 'resolveWorkspaceToken');
  assert.equal(authCall.tokenSha256, crypto.createHash('sha256').update(TOKEN).digest('hex'));
  assert.doesNotMatch(JSON.stringify(response.payload), new RegExp(TOKEN));
  assert.doesNotMatch(JSON.stringify(response.payload), new RegExp(authCall.tokenSha256));
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('mounted API, readiness, and static workspace have secure routing and headers', async (t) => {
  const app = await fixture(t);
  const ready = await request({ port: app.port, requestPath: '/workspace/api/readyz' });
  assert.equal(ready.status, 200);
  assert.equal(ready.payload.status, 'ready');
  assert.equal(ready.headers['x-frame-options'], 'DENY');

  const redirect = await request({ port: app.port, requestPath: '/workspace' });
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.location, '/workspace/');
  const page = await request({ port: app.port, requestPath: '/workspace/' });
  assert.equal(page.status, 200);
  assert.match(page.text, /Employee workspace/);
  assert.match(page.headers['content-security-policy'], /default-src 'self'/);
  const strippedPage = await request({
    port: app.port,
    requestPath: '/',
    headers: { 'x-forwarded-prefix': '/workspace' },
  });
  assert.equal(strippedPage.status, 200);
  assert.match(strippedPage.text, /Employee workspace/);
  const asset = await request({ port: app.port, requestPath: '/workspace/app.js' });
  assert.equal(asset.status, 200);
  assert.match(asset.headers['content-type'], /javascript/);
  const hidden = await request({ port: app.port, requestPath: '/workspace/.env' });
  assert.equal(hidden.status, 400);
  const traversal = await request({ port: app.port, requestPath: '/workspace/%2e%2e/secret' });
  assert.equal(traversal.status, 400);
  const prefixConfusion = await request({ port: app.port, requestPath: '/workspace-impersonator' });
  assert.equal(prefixConfusion.status, 404);
});

test('production Host and Origin are exact and cross-site requests are denied', async (t) => {
  const app = await fixture(t, {
    handler: {
      allowedHost: 'memory.sellsystems.agency',
      allowedOrigin: 'https://memory.sellsystems.agency',
    },
  });
  const headers = {
    host: 'memory.sellsystems.agency',
    origin: 'https://memory.sellsystems.agency',
    'sec-fetch-site': 'same-origin',
    'x-real-ip': '198.51.100.20',
  };
  const accepted = await login(app, '/api/v1/session', headers);
  assert.equal(accepted.status, 201);
  const missingOrigin = await login(app, '/api/v1/session', {
    host: 'memory.sellsystems.agency',
    'x-real-ip': '198.51.100.20',
  });
  assert.equal(missingOrigin.status, 403);
  assert.equal(missingOrigin.payload.error.code, 'origin_denied');
  const crossSite = await login(app, '/api/v1/session', { ...headers, 'sec-fetch-site': 'cross-site' });
  assert.equal(crossSite.status, 403);
  const loopbackHost = await login(app, '/api/v1/session', {
    ...headers,
    host: `127.0.0.1:${app.port}`,
  });
  assert.equal(loopbackHost.status, 400);
  const missingForwardedClient = await login(app, '/api/v1/session', {
    host: 'memory.sellsystems.agency',
    origin: 'https://memory.sellsystems.agency',
  });
  assert.equal(missingForwardedClient.status, 400);
  const spoofedProxyClient = await login(app, '/api/v1/session', {
    ...headers,
    'x-real-ip': '198.51.100.20, 203.0.113.1',
  });
  assert.equal(spoofedProxyClient.status, 400);
});

test('workspace requires a session and every mutation requires current CSRF', async (t) => {
  const app = await fixture(t);
  const denied = await request({ port: app.port, requestPath: '/api/v1/workspace' });
  assert.equal(denied.status, 401);
  assert.equal(denied.payload.error.code, 'authentication_failed');
  assert.match(denied.headers['set-cookie'][0], /Max-Age=0/);

  const signedIn = await login(app);
  const sessionCookie = cookie(signedIn.headers['set-cookie'][0]);
  const csrf = signedIn.payload.data.csrf_token;
  const workspace = await request({
    port: app.port,
    requestPath: '/workspace/api/v1/workspace',
    headers: { cookie: sessionCookie },
  });
  assert.equal(workspace.status, 200);
  assert.equal(workspace.payload.data.actor.principal_id, HUMAN_ID);

  const missingCsrf = await request({
    port: app.port,
    method: 'PUT',
    requestPath: '/api/v1/profile',
    headers: { cookie: sessionCookie },
    body: profile,
  });
  assert.equal(missingCsrf.status, 403);
  assert.equal(missingCsrf.payload.error.code, 'csrf_failed');

  const updated = await request({
    port: app.port,
    method: 'PUT',
    requestPath: '/api/v1/profile',
    headers: { cookie: sessionCookie, 'x-oam-csrf-token': csrf },
    body: profile,
  });
  assert.equal(updated.status, 200);
  assert.equal(app.calls.find((call) => call.method === 'updateProfile').actor.principal_id, HUMAN_ID);
});

test('session inspection is side-effect-free and sign-out destroys the server-side session', async (t) => {
  const app = await fixture(t);
  const signedIn = await login(app);
  const sessionCookie = cookie(signedIn.headers['set-cookie'][0]);
  const firstCsrf = signedIn.payload.data.csrf_token;
  const inspected = await request({
    port: app.port,
    requestPath: '/api/v1/session',
    headers: { cookie: sessionCookie },
  });
  assert.equal(inspected.status, 200);
  assert.equal(inspected.payload.data.session.actor.agent_id, AGENT_ID);
  assert.equal(inspected.payload.data.csrf_token, firstCsrf);

  const firstTab = await request({
    port: app.port,
    method: 'PUT',
    requestPath: '/api/v1/profile',
    headers: { cookie: sessionCookie, 'x-oam-csrf-token': firstCsrf },
    body: profile,
  });
  assert.equal(firstTab.status, 200);
  const signedOut = await request({
    port: app.port,
    method: 'DELETE',
    requestPath: '/api/v1/session',
    headers: { cookie: sessionCookie, 'x-oam-csrf-token': inspected.payload.data.csrf_token },
  });
  assert.equal(signedOut.status, 200);
  assert.equal(signedOut.payload.data.signed_out, true);
  assert.match(signedOut.headers['set-cookie'][0], /Max-Age=0/);
  const after = await request({
    port: app.port,
    requestPath: '/api/v1/session',
    headers: { cookie: sessionCookie },
  });
  assert.equal(after.status, 401);
});

test('profile and memory contracts reject injected identity, extra fields, and unsafe values', async (t) => {
  const app = await fixture(t);
  const signedIn = await login(app);
  const headers = {
    cookie: cookie(signedIn.headers['set-cookie'][0]),
    'x-oam-csrf-token': signedIn.payload.data.csrf_token,
  };
  const injected = await request({
    port: app.port,
    method: 'PUT',
    requestPath: '/api/v1/profile',
    headers,
    body: { ...profile, principal_id: HUMAN_ID },
  });
  assert.equal(injected.status, 400);
  assert.equal(injected.payload.error.code, 'invalid_request');

  const injectedConsent = await request({
    port: app.port,
    method: 'POST',
    requestPath: '/api/v1/profile/share',
    headers,
    body: { expected_revision: 1, agent_id: AGENT_ID },
  });
  assert.equal(injectedConsent.status, 400);

  const unsupported = await request({
    port: app.port,
    method: 'POST',
    requestPath: '/api/v1/memories',
    headers,
    body: { ...memory, type: 'system_prompt' },
  });
  assert.equal(unsupported.status, 400);
  const duplicateTags = await request({
    port: app.port,
    method: 'POST',
    requestPath: '/api/v1/memories',
    headers,
    body: { ...memory, tags: ['Release', 'release'] },
  });
  assert.equal(duplicateTags.status, 400);
  const longTitle = await request({
    port: app.port,
    method: 'POST',
    requestPath: '/api/v1/memories',
    headers,
    body: { ...memory, title: 'x'.repeat(201) },
  });
  assert.equal(longTitle.status, 400);
  const tooManyTags = await request({
    port: app.port,
    method: 'POST',
    requestPath: '/api/v1/memories',
    headers,
    body: { ...memory, tags: Array.from({ length: 17 }, (_, index) => `tag-${index}`) },
  });
  assert.equal(tooManyTags.status, 400);
  assert.equal(app.calls.some((call) => call.method === 'createMemory'), false);
});

test('profile sharing and withdrawal are explicit revision-bound mutations', async (t) => {
  const app = await fixture(t);
  const signedIn = await login(app);
  const headers = {
    cookie: cookie(signedIn.headers['set-cookie'][0]),
    'x-oam-csrf-token': signedIn.payload.data.csrf_token,
  };
  const shared = await request({
    port: app.port,
    method: 'POST',
    requestPath: '/api/v1/profile/share',
    headers,
    body: { expected_revision: 2 },
  });
  assert.equal(shared.status, 200);
  assert.equal(shared.payload.data.agent_shared, true);
  assert.equal(shared.payload.data.revision, 3);
  const unshared = await request({
    port: app.port,
    method: 'POST',
    requestPath: '/workspace/api/v1/profile/unshare',
    headers,
    body: { expected_revision: 3 },
  });
  assert.equal(unshared.status, 200);
  assert.equal(unshared.payload.data.agent_shared, false);
  assert.equal(unshared.payload.data.revision, 4);
  assert.deepEqual(
    app.calls.filter((call) => /Profile$/.test(call.method)).map((call) => call.revision),
    [2, 3],
  );
});

test('complete memory lifecycle and deterministic agent context preserve IDs and revisions', async (t) => {
  const app = await fixture(t);
  const signedIn = await login(app);
  const headers = {
    cookie: cookie(signedIn.headers['set-cookie'][0]),
    'x-oam-csrf-token': signedIn.payload.data.csrf_token,
  };
  const created = await request({
    port: app.port,
    method: 'POST',
    requestPath: '/api/v1/memories',
    headers,
    body: memory,
  });
  assert.equal(created.status, 201);
  assert.equal(created.payload.data.id, MEMORY_ID);
  const updated = await request({
    port: app.port,
    method: 'PUT',
    requestPath: `/api/v1/memories/${MEMORY_ID}`,
    headers,
    body: { ...memory, expected_revision: 1 },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.payload.data.agent_shared, false);
  assert.equal(updated.payload.data.sharing_scope, 'owner_only');
  const shared = await request({
    port: app.port,
    method: 'POST',
    requestPath: `/api/v1/memories/${MEMORY_ID}/share`,
    headers,
    body: { expected_revision: 2 },
  });
  assert.equal(shared.payload.data.agent_shared, true);
  const unshared = await request({
    port: app.port,
    method: 'POST',
    requestPath: `/api/v1/memories/${MEMORY_ID}/unshare`,
    headers,
    body: { expected_revision: 3 },
  });
  assert.equal(unshared.payload.data.agent_shared, false);
  const context = await request({
    port: app.port,
    method: 'POST',
    requestPath: '/api/v1/agent-context',
    headers,
    body: { query: 'prepare a safe release' },
  });
  assert.equal(context.status, 200);
  assert.equal(context.payload.data.principal.agent_id, AGENT_ID);
  assert.equal(context.payload.data.status, 'matched');
  assert.equal(context.payload.data.mode, 'deterministic_personal_memory');
  assert.equal(context.payload.data.citations[0].memory_id, MEMORY_ID);
  assert.equal(context.payload.data.citations[0].revision, 2);
  assert.equal(context.payload.data.citations[0].content_sha256.length, 64);
});

test('handler, service, repository, and context pool agree on canonical v8 documents', async (t) => {
  const calls = [];
  const workspaceDocument = {
    schema_version: 1,
    principal: {
      id: HUMAN_ID,
      principal_key: 'human:maya.chen',
      display_name: 'Maya Chen',
      status: 'active',
      membership_role: 'member',
    },
    department: {
      id: DEPARTMENT_ID,
      department_key: 'website_delivery',
      display_name: 'Website Delivery',
      status: 'active',
    },
    agent: {
      id: AGENT_ID,
      principal_key: 'agent:maya.chen',
      display_name: 'Maya Personal Agent',
      status: 'active',
      pair_status: 'active',
    },
    profile: null,
    memories: [{
      id: MEMORY_ID,
      memory_type: 'experience',
      title: 'Verify the public route',
      content: 'Check it immediately before handoff.',
      context: 'Website release',
      why_it_worked: 'It catches proxy drift.',
      evidence: ['Observed in the release proof.'],
      tags: ['release'],
      sensitivity: 'private',
      sharing_scope: 'owner_and_personal_agent',
      agent_shared: true,
      current_revision: 2,
      revision: 2,
      content_sha256: 'd'.repeat(64),
    }],
  };
  const contextDocument = {
    schema_version: 1,
    authorization: 'allowed',
    principal: { human_id: HUMAN_ID, department_id: DEPARTMENT_ID, agent_id: AGENT_ID },
    query: { text: 'safe release', limit: 10, matched_count: 1 },
    items: [{
      ...workspaceDocument.memories[0],
      source_type: 'memory',
      citation: {
        source_type: 'memory', source_id: MEMORY_ID, memory_id: MEMORY_ID,
        revision: 2, content_sha256: 'd'.repeat(64),
      },
    }],
    citations: [{
      source_type: 'memory', source_id: MEMORY_ID, memory_id: MEMORY_ID,
      revision: 2, content_sha256: 'd'.repeat(64),
    }],
    audit_event_key: '00000000-0000-4000-8000-000000000005',
  };
  const client = {
    async query(sql, parameters = []) {
      calls.push({ sql, parameters });
      if (String(sql).includes('employee:workspace')) return { rows: [{ data: workspaceDocument }] };
      if (String(sql).includes('employee:agent-context')) return { rows: [{ data: contextDocument }] };
      return { rows: [] };
    },
    release() {},
  };
  const rawPool = {
    async connect() { return client; },
    async query(sql, parameters = []) {
      calls.push({ sql, parameters });
      if (String(sql).includes('employee:resolve-workspace-token')) return { rows: [actor] };
      return { rows: [{ ready: true }] };
    },
  };
  const repository = createEmployeeRepository(createEmployeeContextPool(rawPool));
  const app = await fixture(t, {
    repository,
    service: createEmployeeService({ repository }),
  });
  const signedIn = await login(app);
  const headers = {
    cookie: cookie(signedIn.headers['set-cookie'][0]),
    'x-oam-csrf-token': signedIn.payload.data.csrf_token,
  };
  const workspace = await request({
    port: app.port,
    requestPath: '/api/v1/workspace',
    headers,
  });
  assert.equal(workspace.status, 200);
  assert.equal(workspace.payload.data.memories[0].content_sha256, 'd'.repeat(64));
  const context = await request({
    port: app.port,
    method: 'POST',
    requestPath: '/api/v1/agent-context',
    headers,
    body: { query: 'safe release' },
  });
  assert.equal(context.status, 200);
  assert.equal(context.payload.data.status, 'matched');
  assert.equal(context.payload.data.citations[0].memory_id, MEMORY_ID);
  assert.match(context.payload.data.answer, /Why it worked: It catches proxy drift/);
  assert.equal(
    calls.filter((call) => String(call.sql).includes('establish_employee_context')).length,
    2,
  );
  assert.doesNotMatch(JSON.stringify(calls), new RegExp(TOKEN));
});

test('valid multibyte memory content fits the endpoint transport bound', async (t) => {
  const app = await fixture(t);
  const signedIn = await login(app);
  const response = await request({
    port: app.port,
    method: 'POST',
    requestPath: '/api/v1/memories',
    headers: {
      cookie: cookie(signedIn.headers['set-cookie'][0]),
      'x-oam-csrf-token': signedIn.payload.data.csrf_token,
    },
    body: { ...memory, content: '\u1ed5'.repeat(12_000) },
  });
  assert.equal(response.status, 201);
  assert.equal(response.payload.data.content.length, 12_000);
});

test('wrong methods, query parameters, content type, and oversized bodies fail before service calls', async (t) => {
  const app = await fixture(t);
  const signedIn = await login(app);
  const sessionCookie = cookie(signedIn.headers['set-cookie'][0]);
  const wrongMethod = await request({
    port: app.port,
    requestPath: '/api/v1/profile',
    headers: { cookie: sessionCookie },
  });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.allow, 'PUT');

  const query = await request({
    port: app.port,
    requestPath: '/api/v1/workspace?principal_id=someone-else',
    headers: { cookie: sessionCookie },
  });
  assert.equal(query.status, 400);
  const unsupported = await request({
    port: app.port,
    method: 'POST',
    requestPath: '/api/v1/agent-context',
    headers: {
      cookie: sessionCookie,
      'content-type': 'text/plain',
      'x-oam-csrf-token': signedIn.payload.data.csrf_token,
    },
    rawBody: 'query',
  });
  assert.equal(unsupported.status, 415);
  const oversized = await request({
    port: app.port,
    method: 'POST',
    requestPath: '/api/v1/agent-context',
    headers: {
      cookie: sessionCookie,
      'x-oam-csrf-token': signedIn.payload.data.csrf_token,
    },
    body: { query: 'x'.repeat(5_000) },
  });
  assert.equal(oversized.status, 413);
  const longQuery = await request({
    port: app.port,
    method: 'POST',
    requestPath: '/api/v1/agent-context',
    headers: {
      cookie: sessionCookie,
      'x-oam-csrf-token': signedIn.payload.data.csrf_token,
    },
    body: { query: 'x'.repeat(201) },
  });
  assert.equal(longQuery.status, 400);
});

test('authentication and unexpected database failures never expose token or SQL details', async (t) => {
  const authApp = await fixture(t, {
    repository: {
      async readiness() { return true; },
      async resolveWorkspaceToken() {
        throw new EmployeeRepositoryError('authentication_failed', 'Authentication failed.', 401);
      },
    },
  });
  const denied = await login(authApp);
  assert.equal(denied.status, 401);
  assert.equal(denied.payload.error.message, 'Authentication failed.');
  assert.doesNotMatch(denied.text, new RegExp(TOKEN));

  const errors = [];
  const failingApp = await fixture(t, {
    logger: { error(record, detail) { errors.push({ record, detail }); } },
    repository: {
      async readiness() { throw new Error('password=secret SELECT personal.private_memory'); },
      async resolveWorkspaceToken() { return actor; },
    },
  });
  const failed = await request({ port: failingApp.port, requestPath: '/api/readyz' });
  assert.equal(failed.status, 503);
  assert.doesNotMatch(failed.text, /password|SELECT|private_memory|secret/i);
  assert.equal(errors[0].detail.error_name, 'Error');
});

test('database token rejection is generic and consumes the authentication budget', async (t) => {
  const rejected = Object.assign(new Error('credential row detail'), { code: '28000' });
  const app = await fixture(t, {
    repository: {
      async readiness() { return true; },
      async resolveWorkspaceToken() { throw rejected; },
    },
  });
  for (let index = 0; index < 10; index += 1) {
    const denied = await login(app, '/api/v1/session', { 'x-forwarded-for': '203.0.113.41' });
    assert.equal(denied.status, 401);
    assert.equal(denied.payload.error.code, 'authentication_failed');
    assert.doesNotMatch(denied.text, /credential|row|detail/i);
  }
  const limited = await login(app, '/api/v1/session', { 'x-forwarded-for': '203.0.113.41' });
  assert.equal(limited.status, 429);
  assert.equal(limited.payload.error.code, 'authentication_rate_limited');
});

test('malformed workspace tokens are generic and consume the authentication budget', async (t) => {
  const app = await fixture(t);
  for (let index = 0; index < 10; index += 1) {
    const denied = await request({
      port: app.port,
      method: 'POST',
      requestPath: '/api/v1/session',
      headers: { 'x-forwarded-for': '203.0.113.40' },
      body: { token: `not-valid-${index}` },
    });
    assert.equal(denied.status, 401);
    assert.equal(denied.payload.error.code, 'authentication_failed');
  }
  const limited = await request({
    port: app.port,
    method: 'POST',
    requestPath: '/api/v1/session',
    headers: { 'x-forwarded-for': '203.0.113.40' },
    body: { token: TOKEN },
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.payload.error.code, 'authentication_rate_limited');
});

test('successful sign-ins are principal-bounded and do not erase failed attempts', async (t) => {
  const principalLimited = await fixture(t);
  for (let index = 0; index < 10; index += 1) {
    const accepted = await login(principalLimited, '/api/v1/session', {
      'x-forwarded-for': '203.0.113.42',
    });
    assert.equal(accepted.status, 201);
  }
  const tooManySessions = await login(principalLimited, '/api/v1/session', {
    'x-forwarded-for': '203.0.113.42',
  });
  assert.equal(tooManySessions.status, 429);

  const failureHistory = await fixture(t);
  for (let index = 0; index < 5; index += 1) {
    const denied = await request({
      port: failureHistory.port,
      method: 'POST',
      requestPath: '/api/v1/session',
      headers: { 'x-forwarded-for': '203.0.113.43' },
      body: { token: `invalid-${index}` },
    });
    assert.equal(denied.status, 401);
  }
  const accepted = await login(failureHistory, '/api/v1/session', {
    'x-forwarded-for': '203.0.113.43',
  });
  assert.equal(accepted.status, 201);
  for (let index = 5; index < 10; index += 1) {
    const denied = await request({
      port: failureHistory.port,
      method: 'POST',
      requestPath: '/api/v1/session',
      headers: { 'x-forwarded-for': '203.0.113.43' },
      body: { token: `invalid-${index}` },
    });
    assert.equal(denied.status, 401);
  }
  const stillLimited = await login(failureHistory, '/api/v1/session', {
    'x-forwarded-for': '203.0.113.43',
  });
  assert.equal(stillLimited.status, 429);
});

test('database revocation invalidates the local session and clears its cookie', async (t) => {
  const revoked = Object.assign(new Error('internal token revoked detail'), { code: '28000' });
  const app = await fixture(t, {
    service: {
      async workspace() { throw revoked; },
      async updateProfile() { throw revoked; },
      async createMemory() { throw revoked; },
      async updateMemory() { throw revoked; },
      async shareMemory() { throw revoked; },
      async unshareMemory() { throw revoked; },
      async agentContext() { throw revoked; },
    },
  });
  const signedIn = await login(app);
  const sessionCookie = cookie(signedIn.headers['set-cookie'][0]);
  const response = await request({
    port: app.port,
    requestPath: '/api/v1/workspace',
    headers: { cookie: sessionCookie },
  });
  assert.equal(response.status, 401);
  assert.equal(response.payload.error.code, 'authentication_failed');
  assert.match(response.headers['set-cookie'][0], /Max-Age=0/);
  assert.doesNotMatch(response.text, /internal|revoked|token/i);

  const repeated = await request({
    port: app.port,
    requestPath: '/api/v1/workspace',
    headers: { cookie: sessionCookie },
  });
  assert.equal(repeated.status, 401);
});

test('missing memory is a generic not-found response', async (t) => {
  const missing = Object.assign(new Error('private memory lookup detail'), { code: 'P0002' });
  const app = await fixture(t, {
    service: {
      async updateMemory() { throw missing; },
    },
  });
  const signedIn = await login(app);
  const response = await request({
    port: app.port,
    method: 'PUT',
    requestPath: `/api/v1/memories/${MEMORY_ID}`,
    headers: {
      cookie: cookie(signedIn.headers['set-cookie'][0]),
      'x-oam-csrf-token': signedIn.payload.data.csrf_token,
    },
    body: { ...memory, expected_revision: 1 },
  });
  assert.equal(response.status, 404);
  assert.equal(response.payload.error.code, 'memory_not_found');
  assert.doesNotMatch(response.text, /private|lookup|detail/i);
});
