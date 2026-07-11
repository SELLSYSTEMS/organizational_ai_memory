import assert from 'node:assert/strict';
import test from 'node:test';
import { createOperatorRepository } from '../../app/lib/operator-repository.mjs';

const JOB_ID = '00000000-0000-4000-8000-000000000001';
const PRINCIPAL_ID = '00000000-0000-4000-8000-000000000002';
const DEPARTMENT_ID = '00000000-0000-4000-8000-000000000003';
const CREDENTIAL_ID = '00000000-0000-4000-8000-000000000004';
const GRANT_ID = '00000000-0000-4000-8000-000000000005';
const PLAN_ID = '00000000-0000-4000-8000-000000000006';

function compact(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

function fakePool(handler) {
  const calls = [];
  const query = async (sql, parameters = []) => {
    const normalized = compact(sql);
    calls.push({ sql: normalized, parameters });
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(normalized)) return { rows: [] };
    return handler(normalized, parameters);
  };
  return {
    calls,
    query,
    async connect() { return { query, release() {} }; },
  };
}

test('provisioning stage activates only the job department', async () => {
  const pool = fakePool((sql) => {
    if (sql.startsWith('SELECT job.id, job.status')) {
      return { rows: [{ id: JOB_ID, credential_id: CREDENTIAL_ID, capability_grant_id: GRANT_ID }] };
    }
    return { rows: [] };
  });
  const repository = createOperatorRepository(pool);

  await repository.stageProvisioning({
    jobId: JOB_ID,
    principalId: PRINCIPAL_ID,
    departmentId: DEPARTMENT_ID,
    planId: PLAN_ID,
  });

  const lock = pool.calls.find((call) => call.sql.startsWith('SELECT job.id, job.status'));
  assert.match(lock.sql, /job\.department_id = \$4/);
  assert.match(lock.sql, /capability_grant\.department_id = job\.department_id/);
  assert.equal(lock.parameters[3], DEPARTMENT_ID);

  const membership = pool.calls.find((call) => call.sql.startsWith('UPDATE identity.department_memberships'));
  const assignment = pool.calls.find((call) => call.sql.startsWith('UPDATE identity.policy_assignments'));
  const job = pool.calls.find((call) => call.sql.startsWith('UPDATE identity.provisioning_jobs'));
  assert.match(membership.sql, /department_id = \$2/);
  assert.match(assignment.sql, /department_id = \$2/);
  assert.match(job.sql, /department_id = \$2/);
  assert.equal(membership.parameters[1], DEPARTMENT_ID);
  assert.equal(assignment.parameters[1], DEPARTMENT_ID);
  assert.equal(job.parameters[1], DEPARTMENT_ID);
});

test('failure handling validates job scope before global fail-closed suspension', async () => {
  const pool = fakePool((sql) => {
    if (sql.startsWith('SELECT id FROM identity.provisioning_jobs')) return { rows: [] };
    return { rows: [] };
  });
  const repository = createOperatorRepository(pool);

  await assert.rejects(
    repository.failProvisioning({
      jobId: JOB_ID,
      principalId: PRINCIPAL_ID,
      departmentId: DEPARTMENT_ID,
      actorPrincipalId: PRINCIPAL_ID,
      errorCode: 'test_failure',
    }),
    (error) => error.code === 'provisioning_conflict',
  );
  assert.equal(
    pool.calls.some((call) => call.sql.startsWith('UPDATE identity.principals')),
    false,
  );
});

test('credential staging authorizes and locks department scope before mutation', async () => {
  const pool = fakePool((sql) => {
    if (sql.startsWith('SELECT agent.id, agent.principal_key')) return { rows: [] };
    return { rows: [] };
  });
  const repository = createOperatorRepository(pool);

  await assert.rejects(
    repository.queueProvisioningWithCredential({
      principalId: PRINCIPAL_ID,
      actorPrincipalId: '00000000-0000-4000-8000-000000000007',
      departmentId: DEPARTMENT_ID,
      policy: { id: '00000000-0000-4000-8000-000000000008', policy_hash: 'a'.repeat(64) },
      tokenSha256: 'b'.repeat(64),
      operation: 'provision_agent',
      jobType: 'linux_identity',
      plan: {
        operation: 'provision_agent',
        plan_id: PLAN_ID,
        principal_key: 'agent:bounded',
        profile_key: 'memory-reuse-agent-v1',
        policy_hash: 'a'.repeat(64),
      },
      idempotencyKey: PLAN_ID,
    }),
    (error) => error.code === 'principal_not_provisionable',
  );

  assert.equal(pool.calls.some((call) => /UPDATE identity\.broker_credentials/.test(call.sql)), false);
  assert.equal(pool.calls.some((call) => /INSERT INTO identity\.broker_credentials/.test(call.sql)), false);
  assert.equal(pool.calls.some((call) => /INSERT INTO identity\.provisioning_jobs/.test(call.sql)), false);
  const authorization = pool.calls.find((call) => call.sql.startsWith('SELECT agent.id, agent.principal_key'));
  assert.match(authorization.sql, /target_membership\.department_id = \$3/);
  assert.match(authorization.sql, /FOR UPDATE OF agent, target_membership, link/);
});

test('resume staging keeps every credential boundary suspended until confirmation', async () => {
  const policyId = '00000000-0000-4000-8000-000000000008';
  const actorId = '00000000-0000-4000-8000-000000000007';
  const pool = fakePool((sql) => {
    if (sql.startsWith('SELECT agent.id, agent.principal_key')) {
      return { rows: [{ id: PRINCIPAL_ID, principal_key: 'agent:bounded', status: 'suspended' }] };
    }
    if (sql.startsWith('INSERT INTO identity.broker_credentials')) {
      return { rows: [{ id: CREDENTIAL_ID, status: 'suspended' }] };
    }
    if (sql.startsWith('UPDATE identity.runtime_bindings')) return { rows: [{ id: 'binding' }] };
    if (sql.startsWith('UPDATE governance.capability_grants')) return { rows: [{ id: GRANT_ID }] };
    if (sql.startsWith('INSERT INTO identity.provisioning_jobs')) {
      return { rows: [{ id: JOB_ID, department_id: DEPARTMENT_ID, revision: 0 }] };
    }
    return { rows: [] };
  });
  const repository = createOperatorRepository(pool);

  const job = await repository.queueProvisioningWithCredential({
    principalId: PRINCIPAL_ID,
    actorPrincipalId: actorId,
    departmentId: DEPARTMENT_ID,
    policy: { id: policyId, policy_hash: 'a'.repeat(64) },
    tokenSha256: 'b'.repeat(64),
    operation: 'resume_agent',
    jobType: 'runtime_binding',
    plan: {
      operation: 'resume_agent',
      plan_id: PLAN_ID,
      principal_key: 'agent:bounded',
      profile_key: 'memory-reuse-agent-v1',
      policy_hash: 'a'.repeat(64),
    },
    idempotencyKey: PLAN_ID,
  });

  assert.equal(job.id, JOB_ID);
  const authorization = pool.calls.find((call) => call.sql.startsWith('SELECT agent.id, agent.principal_key'));
  assert.deepEqual(authorization.parameters.slice(4), ['suspended', 'suspended']);
  const credential = pool.calls.find((call) => call.sql.startsWith('INSERT INTO identity.broker_credentials'));
  const binding = pool.calls.find((call) => call.sql.startsWith('UPDATE identity.runtime_bindings'));
  const grant = pool.calls.find((call) => call.sql.startsWith('UPDATE governance.capability_grants'));
  assert.equal(credential.parameters[5], 'suspended');
  assert.equal(binding.parameters[3], 'suspended');
  assert.equal(grant.parameters[3], 'suspended');
  const queuedPlan = pool.calls.find((call) => call.sql.startsWith('INSERT INTO identity.provisioning_jobs'));
  assert.doesNotMatch(queuedPlan.parameters[5], /broker_token/);
});
