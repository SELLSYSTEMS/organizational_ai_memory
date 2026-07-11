import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createEmployeeRepository,
  EmployeeRepositoryError,
} from '../../app/lib/employee-repository.mjs';

const HUMAN_ID = '00000000-0000-4000-8000-000000000001';
const DEPARTMENT_ID = '00000000-0000-4000-8000-000000000002';
const AGENT_ID = '00000000-0000-4000-8000-000000000003';
const MEMORY_ID = '00000000-0000-4000-8000-000000000004';
const TOKEN_HASH = 'a'.repeat(64);

function fakePool() {
  const calls = [];
  return {
    calls,
    async connect() { return { query() {}, release() {} }; },
    async query(sql, parameters = []) {
      const compact = sql.replace(/\s+/g, ' ').trim();
      calls.push({ sql: compact, parameters });
      if (compact.includes('employee:readiness')) return { rows: [{ ready: true }] };
      if (compact.includes('employee:resolve-workspace-token')) {
        return { rows: [{
          principal_id: HUMAN_ID,
          principal_key: 'human:maya.chen',
          display_name: 'Maya Chen',
          department_id: DEPARTMENT_ID,
          department_key: 'website_delivery',
          department_name: 'Website Delivery',
          membership_role: 'member',
          agent_id: AGENT_ID,
          agent_key: 'agent:maya.chen',
          agent_display_name: 'Maya Personal Agent',
        }] };
      }
      if (compact.includes('employee:current-context')) {
        return { rows: [{
          principal_id: HUMAN_ID,
          department_id: DEPARTMENT_ID,
          agent_id: AGENT_ID,
        }] };
      }
      return { rows: [{ data: { ok: true, marker: compact.match(/employee:[a-z-]+/)?.[0] } }] };
    },
  };
}

const memory = {
  type: 'experience',
  title: 'Release checklist',
  content: 'Check the public route before handoff.',
  context: 'Website release',
  why_it_worked: 'It catches proxy drift.',
  evidence: [{ kind: 'metric', note: 'Zero missed routes' }],
  tags: ['release'],
  sensitivity: 'private',
};

test('employee repository uses only the canonical v8 function boundary', async () => {
  const pool = fakePool();
  const repository = createEmployeeRepository(pool);
  assert.equal(await repository.readiness(), true);
  const actor = await repository.resolveWorkspaceToken(TOKEN_HASH);
  assert.equal(actor.principal_id, HUMAN_ID);
  assert.equal(actor.agent_id, AGENT_ID);
  assert.deepEqual(await repository.currentContext(), {
    principal_id: HUMAN_ID,
    department_id: DEPARTMENT_ID,
    agent_id: AGENT_ID,
  });
  await repository.workspace();
  await repository.updateProfile({
    expected_revision: 2,
    job_title: 'Delivery Lead',
    role_summary: 'Ships reviewed sites.',
    expertise: ['handoffs'],
    working_style: 'Evidence first.',
    current_goals: ['Reduce rework'],
    boundaries: 'No production writes without approval.',
  });
  await repository.shareProfile(3);
  await repository.unshareProfile(4);
  await repository.createMemory(memory);
  await repository.updateMemory(MEMORY_ID, { ...memory, expected_revision: 3 });
  await repository.shareMemory(MEMORY_ID, 4);
  await repository.unshareMemory(MEMORY_ID, 5);
  await repository.agentContext('prepare a website release', 10);

  const sql = pool.calls.map((call) => call.sql).join('\n');
  for (const expected of [
    'identity.resolve_employee_workspace_token',
    'identity.current_employee_principal_id',
    'identity.current_employee_department_id',
    'identity.current_employee_agent_id',
    'personal.employee_workspace',
    'personal.update_employee_profile',
    'personal.share_employee_profile',
    'personal.unshare_employee_profile',
    'personal.create_employee_memory',
    'personal.update_employee_memory',
    'personal.share_employee_memory',
    'personal.unshare_employee_memory',
    'personal.employee_agent_context',
  ]) assert.match(sql, new RegExp(expected.replaceAll('.', '\\.')));
  assert.doesNotMatch(sql, /FROM personal\.|INSERT INTO|UPDATE personal\.|identity\.establish_operator_context/);

  const contextCall = pool.calls.find((call) => call.sql.includes('employee:agent-context'));
  assert.deepEqual(contextCall.parameters, ['prepare a website release', 10]);
  const updateCall = pool.calls.find((call) => call.sql.includes('employee:update-memory'));
  assert.deepEqual(updateCall.parameters.slice(0, 3), [MEMORY_ID, 3, 'experience']);
  assert.deepEqual(JSON.parse(updateCall.parameters[7]), memory.evidence);
  const profileCall = pool.calls.find((call) => call.sql.includes('employee:update-profile'));
  assert.deepEqual(JSON.parse(profileCall.parameters[3]), ['handoffs']);
  assert.deepEqual(JSON.parse(profileCall.parameters[5]), ['Reduce rework']);
  assert.deepEqual(
    pool.calls.find((call) => call.sql.includes('employee:share-profile')).parameters,
    [3],
  );
  assert.deepEqual(
    pool.calls.find((call) => call.sql.includes('employee:unshare-profile')).parameters,
    [4],
  );
  const browserSuppliedIdentityParameters = pool.calls.flatMap((call) => call.parameters)
    .filter((parameter) => [HUMAN_ID, DEPARTMENT_ID, AGENT_ID].includes(parameter));
  assert.deepEqual(browserSuppliedIdentityParameters, []);
});

test('workspace-token authentication receives only SHA-256 and fails generically', async () => {
  const pool = fakePool();
  const repository = createEmployeeRepository(pool);
  await repository.resolveWorkspaceToken(TOKEN_HASH);
  const call = pool.calls.find((entry) => entry.sql.includes('resolve-workspace-token'));
  assert.deepEqual(call.parameters, [TOKEN_HASH]);
  assert.equal(call.parameters.some((value) => value === 'raw-workspace-token'), false);

  await assert.rejects(
    repository.resolveWorkspaceToken('raw-workspace-token'),
    (error) => error instanceof EmployeeRepositoryError
      && error.code === 'authentication_failed'
      && error.status === 401,
  );
});

test('repository readiness checks v8 grants and malformed documents fail as service drift', async () => {
  const notReadyPool = {
    async connect() { return { query() {}, release() {} }; },
    async query() { return { rows: [{ ready: false }] }; },
  };
  assert.equal(await createEmployeeRepository(notReadyPool).readiness(), false);

  const malformedPool = {
    async connect() { return { query() {}, release() {} }; },
    async query() { return { rows: [{}] }; },
  };
  await assert.rejects(
    createEmployeeRepository(malformedPool).workspace(),
    (error) => error.code === 'employee_service_unavailable' && error.status === 503,
  );
});
