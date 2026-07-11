import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import test from 'node:test';
import { createMemoryBrokerHandler } from '../../app/memory-broker.mjs';
import { createMemoryBrokerRepository } from '../../app/lib/memory-broker-repository.mjs';

const TOKEN = 'A'.repeat(43);
const AGENT_KEY = 'agent:00000000-0000-4000-8000-000000000001';

function request({ port, requestPath = '/v1/agent/recommendation', headers = {}, body = {} }) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: requestPath,
      method: 'POST',
      headers: {
        'content-length': Buffer.byteLength(payload),
        'content-type': 'application/json',
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        payload: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

async function serverFixture(t, repository) {
  const server = http.createServer(createMemoryBrokerHandler({
    repository,
    randomUUID: () => '00000000-0000-4000-8000-000000000099',
    logger: { error() {} },
  }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return server.address().port;
}

test('broker accepts one exact retrieval and never trusts the claimed principal as DB context', async (t) => {
  let captured;
  const port = await serverFixture(t, {
    async approvedWebsiteCapability(input) {
      captured = input;
      return {
        authorization: {
          principal_key: AGENT_KEY,
          sponsor_principal_key: 'human:sponsor',
          department_key: 'website_delivery',
          policy_hash: 'b'.repeat(64),
        },
        capability: {
          asset_key: 'prompt:website_handoff_brief_v1',
          source_turn_ids: ['turn-1'],
          provenance: [{ source_turn_id: 'turn-1' }],
        },
        audit_event_key: '00000000-0000-4000-8000-000000000088',
      };
    },
  });
  const response = await request({
    port,
    headers: { authorization: `Bearer ${TOKEN}`, 'x-oam-principal': AGENT_KEY },
    body: { task: 'website delivery handoff' },
  });
  assert.equal(response.status, 200);
  assert.equal(response.payload.authorization, 'allowed');
  assert.equal(response.payload.capability.asset_key, 'prompt:website_handoff_brief_v1');
  assert.equal(captured.tokenSha256, crypto.createHash('sha256').update(TOKEN).digest('hex'));
  assert.equal(captured.claimedPrincipalKey, AGENT_KEY);
  assert.equal('departmentId' in captured, false);
});

test('broker rejects write-shaped paths and non-exact bodies before repository access', async (t) => {
  let calls = 0;
  const port = await serverFixture(t, { async approvedWebsiteCapability() { calls += 1; } });
  const write = await request({
    port,
    requestPath: '/v1/agent/canonical-memory',
    headers: { authorization: `Bearer ${TOKEN}` },
    body: { operation: 'write' },
  });
  assert.equal(write.status, 404);
  assert.equal(write.payload.error.code, 'operation_not_allowed');

  const extra = await request({
    port,
    headers: { authorization: `Bearer ${TOKEN}` },
    body: { task: 'website delivery handoff', principal_id: AGENT_KEY },
  });
  assert.equal(extra.status, 400);
  assert.equal(calls, 0);
});

function fakeBrokerPool({ authorized = true, capability = true } = {}) {
  const calls = [];
  const client = {
    async query(sql, parameters = []) {
      const compact = sql.replace(/\s+/g, ' ').trim();
      calls.push({ sql: compact, parameters });
      if (compact.includes('broker:authorize-token-and-grant')) {
        return { rows: authorized ? [{
          credential_id: 'credential-id',
          principal_id: 'agent-id',
          principal_key: AGENT_KEY,
          sponsor_principal_id: 'sponsor-id',
          sponsor_principal_key: 'human:sponsor',
          department_id: 'department-id',
          department_key: 'website_delivery',
          policy_template_key: 'memory_reuse_agent',
          policy_template_version: 1,
          policy_hash: 'b'.repeat(64),
          capability_grant_id: 'grant-id',
          capability_task_key: 'website_delivery_handoff',
          allowed_review_statuses: ['approved'],
        }] : [] };
      }
      if (compact.includes('broker:approved-website-capability')) {
        return { rows: capability ? [{
          asset_key: 'prompt:website_handoff_brief_v1',
          asset_type: 'prompt',
          title: 'Website handoff',
          summary: 'A reviewed handoff.',
          capability_area: 'website_delivery',
          problem_solved: 'Incomplete handoffs',
          why_it_worked: 'Grounded inputs',
          owner_role: 'operator',
          consumer_roles: ['agent'],
          visibility: 'internal',
          review_status: 'approved',
          version: '1.0',
          last_validated_at: '2026-07-10',
          content_schema_version: 1,
          content_type: 'application/json',
          content_sha256: 'c'.repeat(64),
          content_body: { steps: ['inspect sources'] },
          source_evidence: [{
            observation_id: 'observation-id',
            source_turn_id: 'turn-1',
            actor_role: 'operator',
            context_scope: 'website_delivery',
            occurred_at: '2026-07-10T04:00:00Z',
            evidence_text: 'Use the source inventory first.',
          }],
        }] : [] };
      }
      if (compact.includes('audit.record_broker_interaction')) {
        return { rows: [{ event_key: 'audit-id' }] };
      }
      return { rows: [] };
    },
    release() {},
  };
  return { calls, async connect() { return client; } };
}

test('broker repository authorization query requires both assignments, sponsor allow, explicit-deny absence, and fixed grant', async () => {
  const pool = fakeBrokerPool();
  const repository = createMemoryBrokerRepository(pool);
  const result = await repository.approvedWebsiteCapability({
    tokenSha256: 'a'.repeat(64),
    claimedPrincipalKey: AGENT_KEY,
    correlationKey: 'correlation-id',
  });
  assert.equal(result.capability.governance.review_status, 'approved');
  const authorizationSql = pool.calls.find((call) => call.sql.includes('broker:authorize-token-and-grant')).sql;
  assert.match(authorizationSql, /JOIN identity\.policy_assignments agent_assignment/);
  assert.match(authorizationSql, /JOIN identity\.policy_assignments sponsor_assignment/);
  assert.match(authorizationSql, /sponsor_allow_rule\.permission_key = 'memory\.department\.read'/);
  assert.match(authorizationSql, /identity\.explicit_permission_denials/);
  assert.match(authorizationSql, /SELECT count\(\*\).*unique_link.*\) = 1/);
  assert.match(authorizationSql, /grant\.capability_task_key = \$2/);
  assert.match(authorizationSql, /activation_job\.status = 'succeeded'/);
  assert.match(authorizationSql, /activation_job\.department_id = department\.id/);
  assert.match(authorizationSql, /activation_job\.status = 'running'/);
  assert.match(authorizationSql, /now\(\) - interval '30 seconds'/);
  assert.doesNotMatch(authorizationSql, /FOR (?:UPDATE|SHARE|KEY)/);
  assert.deepEqual(
    pool.calls.find((call) => call.sql.includes('broker:authorize-token-and-grant')).parameters,
    ['a'.repeat(64), 'website_delivery_handoff'],
  );
});

for (const reason of [
  'missing agent assignment',
  'missing sponsor assignment',
  'sponsor allow missing',
  'agent explicit deny',
  'sponsor explicit deny',
  'ambiguous active sponsorship',
]) {
  test(`broker fails closed for ${reason}`, async () => {
    const pool = fakeBrokerPool({ authorized: false });
    const repository = createMemoryBrokerRepository(pool);
    await assert.rejects(
      repository.approvedWebsiteCapability({
        tokenSha256: 'a'.repeat(64),
        correlationKey: 'correlation-id',
      }),
      (error) => error.code === 'authentication_failed',
    );
    assert.equal(pool.calls.some((call) => call.sql.includes('audit.record_broker_interaction')), true);
    assert.equal(pool.calls.some((call) => call.sql === 'COMMIT'), true);
  });
}
