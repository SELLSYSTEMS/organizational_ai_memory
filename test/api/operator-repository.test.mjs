import assert from 'node:assert/strict';
import test from 'node:test';
import { createOperatorRepository } from '../../app/lib/operator-repository.mjs';

const JOB_ID = '00000000-0000-4000-8000-000000000001';
const PRINCIPAL_ID = '00000000-0000-4000-8000-000000000002';
const DEPARTMENT_ID = '00000000-0000-4000-8000-000000000003';
const CREDENTIAL_ID = '00000000-0000-4000-8000-000000000004';
const GRANT_ID = '00000000-0000-4000-8000-000000000005';
const PLAN_ID = '00000000-0000-4000-8000-000000000006';
const PERSONAL_GRANT_ID = '00000000-0000-4000-8000-000000000009';
const POLICY_ID = '00000000-0000-4000-8000-000000000008';

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
      return { rows: [{
        id: JOB_ID,
        plan: { operation: 'provision_agent' },
        claims_personal_agent: false,
        policy_template_id: POLICY_ID,
        credential_id: CREDENTIAL_ID,
        capability_grant_id: GRANT_ID,
      }] };
    }
    if (sql.startsWith('UPDATE governance.capability_grants') && sql.includes('id = ANY')) {
      return { rows: [{ id: GRANT_ID }] };
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
  const grant = pool.calls.find((call) => call.sql.startsWith('UPDATE governance.capability_grants'));
  assert.match(membership.sql, /department_id = \$2/);
  assert.match(assignment.sql, /department_id = \$2/);
  assert.match(job.sql, /department_id = \$2/);
  assert.equal(membership.parameters[1], DEPARTMENT_ID);
  assert.equal(assignment.parameters[1], DEPARTMENT_ID);
  assert.equal(job.parameters[1], DEPARTMENT_ID);
  assert.deepEqual(grant.parameters[0], [GRANT_ID]);
  assert.equal(
    pool.calls.some((call) => call.sql.includes("capability_task_key = 'personal_context_retrieval'")),
    false,
  );
});

test('personal provisioning locks and activates both required capability grants', async () => {
  const pool = fakePool((sql) => {
    if (sql.startsWith('SELECT job.id, job.status')) {
      return { rows: [{
        id: JOB_ID,
        plan: { operation: 'provision_agent' },
        claims_personal_agent: true,
        policy_template_id: POLICY_ID,
        credential_id: CREDENTIAL_ID,
        capability_grant_id: GRANT_ID,
      }] };
    }
    if (sql.startsWith('SELECT human_principal_id, agent_principal_id')) {
      return { rows: [{ human_principal_id: PRINCIPAL_ID, agent_principal_id: PRINCIPAL_ID }] };
    }
    if (sql.startsWith('SELECT id FROM governance.capability_grants')) {
      return { rows: [{ id: PERSONAL_GRANT_ID }] };
    }
    if (sql.startsWith('UPDATE governance.capability_grants') && sql.includes('id = ANY')) {
      return { rows: [{ id: GRANT_ID }, { id: PERSONAL_GRANT_ID }] };
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

  const personalGrant = pool.calls.find(
    (call) => call.sql.startsWith('SELECT id FROM governance.capability_grants'),
  );
  assert.deepEqual(personalGrant.parameters, [
    PRINCIPAL_ID, DEPARTMENT_ID, POLICY_ID, 'draft',
  ]);
  const activated = pool.calls.find(
    (call) => call.sql.startsWith('UPDATE governance.capability_grants'),
  );
  assert.deepEqual(activated.parameters[0], [GRANT_ID, PERSONAL_GRANT_ID]);
  assert.equal(pool.calls.at(-1).sql, 'COMMIT');
});

test('personal provisioning fails closed before identity activation when its context grant is missing', async () => {
  const pool = fakePool((sql) => {
    if (sql.startsWith('SELECT job.id, job.status')) {
      return { rows: [{
        id: JOB_ID,
        plan: { operation: 'provision_agent' },
        claims_personal_agent: true,
        policy_template_id: POLICY_ID,
        credential_id: CREDENTIAL_ID,
        capability_grant_id: GRANT_ID,
      }] };
    }
    if (sql.startsWith('SELECT human_principal_id, agent_principal_id')) {
      return { rows: [{ human_principal_id: PRINCIPAL_ID, agent_principal_id: PRINCIPAL_ID }] };
    }
    return { rows: [] };
  });
  const repository = createOperatorRepository(pool);

  await assert.rejects(
    repository.stageProvisioning({
      jobId: JOB_ID,
      principalId: PRINCIPAL_ID,
      departmentId: DEPARTMENT_ID,
      planId: PLAN_ID,
    }),
    (error) => error.code === 'provisioning_conflict',
  );
  assert.equal(
    pool.calls.some((call) => call.sql.startsWith('UPDATE identity.principals')),
    false,
  );
  assert.equal(pool.calls.at(-1).sql, 'ROLLBACK');
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
  assert.match(authorization.sql, /identity\.employee_personal_agents personal_pair/);
  assert.match(authorization.sql, /personal_pair\.human_principal_id = link\.source_principal_id/);
  assert.match(authorization.sql, /FOR UPDATE OF agent, target_membership, link/);
});

test('personal credential rotation stages both capability grants as one contract', async () => {
  const actorId = '00000000-0000-4000-8000-000000000007';
  const pool = fakePool((sql) => {
    if (sql.startsWith('SELECT agent.id, agent.principal_key')) {
      return { rows: [{
        id: PRINCIPAL_ID,
        principal_key: 'agent:personal',
        status: 'draft',
        is_personal_agent: true,
      }] };
    }
    if (sql.startsWith('INSERT INTO identity.broker_credentials')) {
      return { rows: [{ id: CREDENTIAL_ID, status: 'draft' }] };
    }
    if (sql.startsWith('UPDATE identity.runtime_bindings')) return { rows: [{ id: 'binding' }] };
    if (sql.startsWith('UPDATE governance.capability_grants')) {
      return { rows: [
        { id: GRANT_ID, capability_task_key: 'website_delivery_handoff' },
        { id: PERSONAL_GRANT_ID, capability_task_key: 'personal_context_retrieval' },
      ] };
    }
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
    policy: { id: POLICY_ID, policy_hash: 'a'.repeat(64) },
    tokenSha256: 'b'.repeat(64),
    operation: 'provision_agent',
    jobType: 'linux_identity',
    plan: {
      operation: 'provision_agent',
      plan_id: PLAN_ID,
      principal_key: 'agent:personal',
      profile_key: 'memory-reuse-agent-v1',
      policy_hash: 'a'.repeat(64),
    },
    idempotencyKey: PLAN_ID,
  });

  assert.equal(job.id, JOB_ID);
  const grant = pool.calls.find((call) => call.sql.startsWith('UPDATE governance.capability_grants'));
  assert.deepEqual(grant.parameters[4], [
    'website_delivery_handoff', 'personal_context_retrieval',
  ]);
  assert.equal(pool.calls.at(-1).sql, 'COMMIT');
});

test('provisioning context requires a matching canonical pair and aligned personal grant', async () => {
  const pool = fakePool((sql) => {
    if (sql.startsWith('/* operator:provisioning-context */')) {
      return { rows: [{ principal_id: PRINCIPAL_ID, status: 'draft' }] };
    }
    return { rows: [] };
  });
  const repository = createOperatorRepository(pool);

  await repository.provisioningContext({
    principalId: PRINCIPAL_ID,
    actorPrincipalId: '00000000-0000-4000-8000-000000000007',
    departmentId: DEPARTMENT_ID,
  });

  const query = pool.calls.find((call) => call.sql.startsWith('/* operator:provisioning-context */'));
  assert.match(query.sql, /LEFT JOIN identity\.employee_personal_agents personal_pair/);
  assert.match(query.sql, /personal_pair\.human_principal_id = link\.source_principal_id/);
  assert.match(query.sql, /personal_context_grant\.status = capability_grant\.status/);
});

test('resume staging keeps every credential boundary suspended until confirmation', async () => {
  const policyId = POLICY_ID;
  const actorId = '00000000-0000-4000-8000-000000000007';
  const pool = fakePool((sql) => {
    if (sql.startsWith('SELECT agent.id, agent.principal_key')) {
      return { rows: [{
        id: PRINCIPAL_ID,
        principal_key: 'agent:bounded',
        status: 'suspended',
        is_personal_agent: false,
      }] };
    }
    if (sql.startsWith('INSERT INTO identity.broker_credentials')) {
      return { rows: [{ id: CREDENTIAL_ID, status: 'suspended' }] };
    }
    if (sql.startsWith('UPDATE identity.runtime_bindings')) return { rows: [{ id: 'binding' }] };
    if (sql.startsWith('UPDATE governance.capability_grants')) {
      return { rows: [{ id: GRANT_ID, capability_task_key: 'website_delivery_handoff' }] };
    }
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
  assert.deepEqual(grant.parameters[4], ['website_delivery_handoff']);
  const queuedPlan = pool.calls.find((call) => call.sql.startsWith('INSERT INTO identity.provisioning_jobs'));
  assert.doesNotMatch(queuedPlan.parameters[5], /broker_token/);
});

test('successful physical provisioning explicitly activates a personal pair before commit', async () => {
  const actorId = '00000000-0000-4000-8000-000000000007';
  const pool = fakePool((sql) => {
    if (sql.startsWith('SELECT id FROM identity.provisioning_jobs')) return { rows: [{ id: JOB_ID }] };
    if (sql.startsWith('UPDATE identity.provisioning_jobs')) {
      return { rows: [{ id: JOB_ID, principal_id: PRINCIPAL_ID, status: 'succeeded', revision: 3 }] };
    }
    if (sql.startsWith('SELECT human_principal_id, agent_principal_id, department_id')) {
      return { rows: [{
        human_principal_id: actorId,
        agent_principal_id: PRINCIPAL_ID,
        department_id: DEPARTMENT_ID,
        status: 'draft',
        activated_at: null,
      }] };
    }
    if (sql.includes('identity.activate_employee_personal_agent')) {
      return { rows: [{ pair: { agent_principal_id: PRINCIPAL_ID, status: 'active' } }] };
    }
    return { rows: [] };
  });
  const repository = createOperatorRepository(pool);

  const result = await repository.completeProvisioning({
    jobId: JOB_ID,
    principalId: PRINCIPAL_ID,
    departmentId: DEPARTMENT_ID,
    actorPrincipalId: actorId,
    binding: {
      osUser: 'oam-agent-proof',
      unitName: 'organizational-ai-memory-agent@proof.service',
      stateDirectory: '/var/lib/oam-agents/proof',
    },
    proof: { passed: true },
  });

  assert.equal(result.personal_agent_pair.status, 'active');
  const succeededIndex = pool.calls.findIndex((call) => call.sql.startsWith('UPDATE identity.provisioning_jobs'));
  const activationIndex = pool.calls.findIndex((call) => call.sql.includes('identity.activate_employee_personal_agent'));
  assert.ok(succeededIndex >= 0 && succeededIndex < activationIndex);
  assert.equal(pool.calls.at(-1).sql, 'COMMIT');
});

test('verification completion preserves an already-active personal pair without reactivation', async () => {
  const actorId = '00000000-0000-4000-8000-000000000007';
  const pool = fakePool((sql) => {
    if (sql.startsWith('SELECT id FROM identity.provisioning_jobs')) return { rows: [{ id: JOB_ID }] };
    if (sql.startsWith('UPDATE identity.provisioning_jobs')) {
      return { rows: [{ id: JOB_ID, principal_id: PRINCIPAL_ID, status: 'succeeded', revision: 3 }] };
    }
    if (sql.startsWith('SELECT human_principal_id, agent_principal_id, department_id')) {
      return { rows: [{
        human_principal_id: actorId,
        agent_principal_id: PRINCIPAL_ID,
        department_id: DEPARTMENT_ID,
        status: 'active',
        activated_at: '2026-07-11T00:00:00.000Z',
      }] };
    }
    return { rows: [] };
  });
  const repository = createOperatorRepository(pool);

  const result = await repository.completeProvisioning({
    jobId: JOB_ID,
    principalId: PRINCIPAL_ID,
    departmentId: DEPARTMENT_ID,
    actorPrincipalId: actorId,
    binding: {
      osUser: 'oam-agent-proof',
      unitName: 'organizational-ai-memory-agent@proof.service',
      stateDirectory: '/var/lib/oam-agents/proof',
    },
    proof: { passed: true },
  });

  assert.equal(result.personal_agent_pair.status, 'active');
  assert.equal(
    pool.calls.some((call) => call.sql.includes('identity.activate_employee_personal_agent')),
    false,
  );
  assert.equal(pool.calls.at(-1).sql, 'COMMIT');
});
