import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createOperatorRequestHandler } from '../../app/lib/operator-http.mjs';
import { createOperatorSessionManager, parseCredentialMap } from '../../app/lib/operator-session.mjs';

const TOKEN = 'A'.repeat(43);

function request({ port, method = 'GET', requestPath = '/', headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: requestPath,
      method,
      headers,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({
          status: res.statusCode,
          headers: res.headers,
          payload: text ? JSON.parse(text) : null,
        });
      });
    });
    req.on('error', reject);
    if (body !== null) req.end(JSON.stringify(body));
    else req.end();
  });
}

async function fixture(t, options = {}) {
  const staticDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oam-operator-http-'));
  await fs.writeFile(path.join(staticDir, 'index.html'), '<!doctype html><title>Architect</title>');
  t.after(() => fs.rm(staticDir, { recursive: true, force: true }));
  const credentials = parseCredentialMap({
    schema_version: 1,
    credentials: [{
      token_sha256: crypto.createHash('sha256').update(TOKEN).digest('hex'),
      principal_key: 'human:architect',
      department_key: 'website_delivery',
    }],
  });
  const actor = {
    principal_id: '00000000-0000-4000-8000-000000000001',
    principal_key: 'human:architect',
    display_name: 'Architect',
    membership_role: 'architect',
    department_id: '00000000-0000-4000-8000-000000000002',
    department_key: 'website_delivery',
    department_name: 'Website Delivery',
  };
  const service = {
    async state() { return { actor, principals: [] }; },
    async createHuman() { return { id: 'human-created' }; },
    async onboardEmployee(_actor, input) {
      return {
        employee: { id: 'employee-created', display_name: input.display_name },
        personal_agent: { id: 'agent-created', display_name: input.agent_display_name },
        workspace_access: { token: 'C'.repeat(43), one_time_display: true, secret_persisted: false },
      };
    },
  };
  const handler = createOperatorRequestHandler({
    repository: {
      async resolveOperator(mapped) {
        assert.equal(mapped.principal_key, 'human:architect');
        assert.equal(mapped.department_key, 'website_delivery');
        assert.equal(mapped.principalKey, undefined);
        return actor;
      },
    },
    service,
    sessionManager: createOperatorSessionManager({ credentials }),
    staticDir,
    logger: { error() {} },
    ...options,
  });
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { port: server.address().port, actor };
}

async function login(port, headers = {}) {
  return request({
    port,
    method: 'POST',
    requestPath: '/api/v1/session',
    headers: { 'content-type': 'application/json', ...headers },
    body: { token: TOKEN },
  });
}

function cookieValue(setCookie) {
  return String(setCookie).split(';')[0];
}

test('loopback defaults accept loopback Host and reject an unconfigured Host', async (t) => {
  const app = await fixture(t);
  const signedIn = await login(app.port, { host: `127.0.0.1:${app.port}` });
  assert.equal(signedIn.status, 201);
  assert.match(signedIn.headers['set-cookie'][0], /HttpOnly; SameSite=Strict/);

  const denied = await login(app.port, { host: 'memory.sellsystems.agency' });
  assert.equal(denied.status, 400);
  assert.equal(denied.payload.error.code, 'loopback_host_required');
});

test('configured external Host and Origin produce a scoped Secure cookie', async (t) => {
  const app = await fixture(t, {
    allowedHost: 'memory.sellsystems.agency',
    allowedOrigin: 'https://memory.sellsystems.agency',
    secureCookies: true,
    cookiePath: '/architect',
  });
  const signedIn = await login(app.port, {
    host: 'memory.sellsystems.agency',
    origin: 'https://memory.sellsystems.agency',
    'sec-fetch-site': 'same-origin',
  });
  assert.equal(signedIn.status, 201);
  assert.match(signedIn.headers['set-cookie'][0], /Path=\/architect/);
  assert.match(signedIn.headers['set-cookie'][0], /; Secure$/);

  const wrongOrigin = await login(app.port, {
    host: 'memory.sellsystems.agency',
    origin: 'https://example.test',
  });
  assert.equal(wrongOrigin.status, 403);
  assert.equal(wrongOrigin.payload.error.code, 'origin_denied');
});

test('failed sign-in throttling is client-scoped with a separate global ceiling', async (t) => {
  const app = await fixture(t);
  const host = `127.0.0.1:${app.port}`;
  for (let index = 0; index < 10; index += 1) {
    const denied = await request({
      port: app.port,
      method: 'POST',
      requestPath: '/api/v1/session',
      headers: {
        host,
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.10',
      },
      body: { token: 'B'.repeat(43) },
    });
    assert.equal(denied.status, 401);
  }
  const limited = await request({
    port: app.port,
    method: 'POST',
    requestPath: '/api/v1/session',
    headers: {
      host,
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.10',
    },
    body: { token: 'B'.repeat(43) },
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.payload.error.code, 'authentication_rate_limited');

  const independentClient = await login(app.port, {
    host,
    'x-forwarded-for': '203.0.113.11',
  });
  assert.equal(independentClient.status, 201);
});

test('cross-site requests are rejected and authenticated mutations require exact JSON plus CSRF', async (t) => {
  const app = await fixture(t);
  const crossSite = await login(app.port, {
    host: `127.0.0.1:${app.port}`,
    'sec-fetch-site': 'cross-site',
  });
  assert.equal(crossSite.status, 403);

  const signedIn = await login(app.port, { host: `127.0.0.1:${app.port}` });
  const cookie = cookieValue(signedIn.headers['set-cookie'][0]);
  const csrf = signedIn.payload.data.csrf_token;
  const missingCsrf = await request({
    port: app.port,
    method: 'POST',
    requestPath: '/api/v1/humans',
    headers: {
      host: `127.0.0.1:${app.port}`,
      cookie,
      'content-type': 'application/json',
    },
    body: {},
  });
  assert.equal(missingCsrf.status, 403);
  assert.equal(missingCsrf.payload.error.code, 'csrf_failed');

  const extraField = await request({
    port: app.port,
    method: 'POST',
    requestPath: '/api/v1/humans',
    headers: {
      host: `127.0.0.1:${app.port}`,
      cookie,
      'content-type': 'application/json',
      'x-oam-csrf-token': csrf,
    },
    body: {
      principal_key: 'human:new_reviewer',
      display_name: 'New Reviewer',
      external_issuer: 'https://issuer.example',
      external_subject: 'reviewer-1',
      membership_role: 'reviewer',
      department_id: app.actor.department_id,
    },
  });
  assert.equal(extraField.status, 400);
  assert.equal(extraField.payload.error.code, 'invalid_request');
});

test('employee onboarding accepts only the bounded production form contract', async (t) => {
  const app = await fixture(t);
  const host = `127.0.0.1:${app.port}`;
  const signedIn = await login(app.port, { host });
  const headers = {
    host,
    cookie: cookieValue(signedIn.headers['set-cookie'][0]),
    'content-type': 'application/json',
    'x-oam-csrf-token': signedIn.payload.data.csrf_token,
  };
  const accepted = await request({
    port: app.port,
    method: 'POST',
    requestPath: '/api/v1/employees',
    headers,
    body: {
      display_name: 'Mai Nguyen',
      work_email: 'mai@example.com',
      job_title: 'Delivery Lead',
      agent_display_name: "Mai's Memory Agent",
    },
  });
  assert.equal(accepted.status, 201);
  assert.equal(accepted.payload.data.workspace_access.secret_persisted, false);

  const denied = await request({
    port: app.port,
    method: 'POST',
    requestPath: '/api/v1/employees',
    headers,
    body: {
      display_name: 'Mai Nguyen',
      work_email: 'mai@example.com',
      job_title: 'Delivery Lead',
      agent_display_name: "Mai's Memory Agent",
      membership_role: 'architect',
    },
  });
  assert.equal(denied.status, 400);
  assert.equal(denied.payload.error.code, 'invalid_request');
});

test('static serving rejects hidden, encoded-traversal, and unknown-extension paths', async (t) => {
  const app = await fixture(t);
  const host = `127.0.0.1:${app.port}`;
  const hidden = await request({ port: app.port, requestPath: '/.env', headers: { host } });
  assert.equal(hidden.status, 400);
  assert.equal(hidden.payload.error.code, 'invalid_path');

  const traversal = await request({
    port: app.port,
    requestPath: '/%2e%2e/secret.txt',
    headers: { host },
  });
  assert.equal(traversal.status, 400);
  assert.equal(traversal.payload.error.code, 'invalid_path');

  const unknown = await request({ port: app.port, requestPath: '/secrets.pem', headers: { host } });
  assert.equal(unknown.status, 404);
});
