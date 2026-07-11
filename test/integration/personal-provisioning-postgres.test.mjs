import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import {
  actorWithOperatorDatabaseContext,
  createOperatorContextPool,
  runWithOperatorDatabaseContext,
} from '../../app/lib/operator-db-context.mjs';
import { createIdentityDataPlane } from '../../app/lib/identity-data-plane.mjs';
import { createOperatorRepository } from '../../app/lib/operator-repository.mjs';
import { createOperatorService } from '../../app/lib/operator-service.mjs';

const adminConnectionString = process.env.OAM_INTEGRATION_DATABASE_URL;
const operatorConnectionString = process.env.OAM_OPERATOR_INTEGRATION_DATABASE_URL;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function provisioningPlan(principalKey, policy) {
  return {
    operation: 'provision_agent',
    plan_id: crypto.randomUUID(),
    principal_key: principalKey,
    profile_key: 'memory-reuse-agent-v1',
    policy_hash: policy.policy_hash,
  };
}

async function physicallyProvision({
  repository, identityPlane, actor, principalId, principalKey, policy, suffix,
}) {
  const plan = provisioningPlan(principalKey, policy);
  const queued = await repository.queueProvisioningWithCredential({
    principalId,
    actorPrincipalId: actor.principal_id,
    departmentId: actor.department_id,
    policy,
    tokenSha256: sha256(`broker:${suffix}:${crypto.randomUUID()}`),
    operation: plan.operation,
    jobType: 'linux_identity',
    plan,
    idempotencyKey: plan.plan_id,
  });
  await identityPlane.confirmProvisioningPlan({
    jobId: queued.id,
    expectedRevision: queued.revision,
    confirmedByPrincipalId: actor.principal_id,
    departmentId: actor.department_id,
  });
  await repository.stageProvisioning({
    jobId: queued.id,
    principalId,
    departmentId: actor.department_id,
    planId: plan.plan_id,
  });
  const completed = await repository.completeProvisioning({
    jobId: queued.id,
    principalId,
    departmentId: actor.department_id,
    actorPrincipalId: actor.principal_id,
    binding: {
      osUser: `oam-agent-${suffix}`,
      unitName: `organizational-ai-memory-agent@${suffix}.service`,
      stateDirectory: `/var/lib/oam-agents/${suffix}`,
    },
    proof: {
      passed: true,
      checked_at: new Date().toISOString(),
      checks: [{ label: 'physical_principal', expected: 'active', actual: 'active', passed: true }],
    },
  });
  return { queued, completed };
}

test('real provisioning activates both personal grants and preserves the generic one-grant path', {
  skip: !adminConnectionString || !operatorConnectionString,
  timeout: 45_000,
}, async (t) => {
  const admin = new pg.Client({ connectionString: adminConnectionString });
  const operatorDatabase = new pg.Pool({ connectionString: operatorConnectionString, max: 2 });
  t.after(async () => operatorDatabase.end());
  await admin.connect();
  t.after(async () => admin.end());

  const architectResult = await admin.query(
    `SELECT principal.id AS principal_id, membership.department_id,
            credential.token_sha256
     FROM identity.principals principal
     JOIN identity.department_memberships membership
       ON membership.principal_id = principal.id
      AND membership.membership_role = 'architect'
      AND membership.status = 'active'
     JOIN identity.operator_context_credentials credential
       ON credential.principal_id = principal.id
      AND credential.department_id = membership.department_id
      AND credential.status = 'active'
     WHERE principal.principal_key = 'human:ai_architect'
     ORDER BY credential.created_at DESC LIMIT 1`,
  );
  assert.equal(architectResult.rowCount, 1);
  const architect = architectResult.rows[0];
  const actor = actorWithOperatorDatabaseContext({
    principal_id: architect.principal_id,
    department_id: architect.department_id,
  }, architect.token_sha256);
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 20);
  const humanPrincipalKey = `human:${crypto.randomUUID()}`;
  const agentPrincipalKey = `agent:${crypto.randomUUID()}`;
  const workspaceHash = sha256(`workspace:${suffix}:${crypto.randomUUID()}`);

  await admin.query('BEGIN');
  let personal;
  try {
    await admin.query('SET LOCAL SESSION AUTHORIZATION oam_operator_api');
    await admin.query('SELECT identity.establish_operator_context($1)', [architect.token_sha256]);
    const result = await admin.query(
      `SELECT identity.onboard_employee_bundle(
         $1, $2, $3, $4, $5, $6, $7, now() + interval '1 day'
      ) AS data`,
      [
        humanPrincipalKey,
        'Provisioning Contract Employee',
        `provision.${suffix}@example.com`,
        'Delivery Engineer',
        agentPrincipalKey,
        'Provisioning Contract Personal Agent',
        workspaceHash,
      ],
    );
    personal = result.rows[0].data;
    await admin.query('COMMIT');
  } catch (error) {
    await admin.query('ROLLBACK').catch(() => {});
    throw error;
  }

  const compatibilityLink = await admin.query(
    `SELECT source_principal_id, metadata
     FROM identity.principal_links
     WHERE target_principal_id = $1 AND link_kind = 'linked_agent'`,
    [personal.agent.id],
  );
  assert.equal(compatibilityLink.rowCount, 1);
  assert.equal(compatibilityLink.rows[0].source_principal_id, personal.human.id);
  assert.equal(compatibilityLink.rows[0].metadata.authority, 'employee_personal_agents');
  assert.equal(compatibilityLink.rows[0].metadata.permission_inheritance, false);

  const contextPool = createOperatorContextPool(operatorDatabase);
  const repository = createOperatorRepository(contextPool);
  const identityPlane = createIdentityDataPlane({ pool: contextPool });
  await runWithOperatorDatabaseContext(actor, async () => {
    const policy = await repository.activeAgentPolicy();
    const before = await repository.provisioningContext({
      principalId: personal.agent.id,
      actorPrincipalId: actor.principal_id,
      departmentId: actor.department_id,
    });
    assert.equal(before.is_personal_agent, true);
    assert.equal(before.capability_grant_status, 'draft');
    assert.equal(before.personal_context_grant_status, 'draft');

    const physical = await physicallyProvision({
      repository,
      identityPlane,
      actor,
      principalId: personal.agent.id,
      principalKey: personal.agent.principal_key,
      policy,
      suffix: `personal-${suffix}`,
    });
    assert.equal(physical.completed.status, 'succeeded');
    assert.equal(physical.completed.personal_agent_pair.status, 'active');

    const generic = await identityPlane.createLinkedAgentCredentialDraft({
      principalKey: `agent:generic_${suffix}`,
      displayName: 'Generic Provisioning Contract Agent',
      ownerPrincipalId: actor.principal_id,
      requestedByPrincipalId: actor.principal_id,
      departmentId: actor.department_id,
      tokenSha256: sha256(`generic-bootstrap:${suffix}`),
      policyTemplateKey: policy.template_key,
      policyTemplateVersion: policy.version,
      policyHash: policy.policy_hash,
      metadata: { integration_contract: true },
    });
    const genericPhysical = await physicallyProvision({
      repository,
      identityPlane,
      actor,
      principalId: generic.id,
      principalKey: generic.principal_key,
      policy,
      suffix: `generic-${suffix}`,
    });
    assert.equal(genericPhysical.completed.status, 'succeeded');
    assert.equal(genericPhysical.completed.personal_agent_pair, null);
  });

  const personalState = await admin.query(
    `SELECT pair.status AS pair_status,
            array_agg(capability_grant.capability_task_key
                      ORDER BY capability_grant.capability_task_key) AS grant_keys,
            bool_and(capability_grant.status = 'active') AS grants_active
     FROM identity.employee_personal_agents pair
     JOIN governance.capability_grants capability_grant
       ON capability_grant.principal_id = pair.agent_principal_id
      AND capability_grant.department_id = pair.department_id
     WHERE pair.agent_principal_id = $1
     GROUP BY pair.status`,
    [personal.agent.id],
  );
  assert.deepEqual(personalState.rows[0], {
    pair_status: 'active',
    grant_keys: ['personal_context_retrieval', 'website_delivery_handoff'],
    grants_active: true,
  });
  const genericState = await admin.query(
    `SELECT array_agg(capability_grant.capability_task_key
                      ORDER BY capability_grant.capability_task_key) AS grant_keys,
            bool_and(capability_grant.status = 'active') AS grants_active
     FROM identity.principals principal
     JOIN governance.capability_grants capability_grant
       ON capability_grant.principal_id = principal.id
     WHERE principal.principal_key = $1
     GROUP BY principal.id`,
    [`agent:generic_${suffix}`],
  );
  assert.deepEqual(genericState.rows[0], {
    grant_keys: ['website_delivery_handoff'],
    grants_active: true,
  });

  const otherDepartment = await admin.query(
    `INSERT INTO identity.departments (department_key, display_name)
     VALUES ($1, 'Cross-department negative proof') RETURNING id`,
    [`provision_negative_${suffix}`],
  );
  await assert.rejects(
    admin.query(
      `INSERT INTO identity.department_memberships (
         principal_id, department_id, membership_role, status
       ) VALUES ($1, $2, 'member', 'active')`,
      [personal.agent.id, otherDepartment.rows[0].id],
    ),
    (error) => error.code === '23514'
      && /authoritative department/.test(error.message),
  );

  const enforcedPlans = [];
  const service = createOperatorService({
    identityPlane,
    repository,
    provisionerClient: {
      async execute(plan) {
        enforcedPlans.push(plan);
        return { record: {
          status: 'succeeded',
          suspension: 'enforced',
          verified: true,
          service_inactive: true,
          unit_disabled: true,
          processes_absent: true,
          account_locked: true,
          broker_group_removed: true,
          credentials_absent: true,
        } };
      },
    },
  });
  await runWithOperatorDatabaseContext(actor, () => identityPlane.suspendPrincipal({
    principalId: personal.agent.id,
    suspendedByPrincipalId: actor.principal_id,
    departmentId: actor.department_id,
    reason: 'Transient provisioning failure regression',
  }));
  await assert.rejects(
    service.queueProvisioning(actor, {
      principal_id: personal.agent.id,
      operation: 'resume_agent',
    }),
    (error) => error.code === 'personal_agent_resume_requires_workspace_reissue'
      && error.status === 409,
  );
  const offboarded = await service.suspendPrincipal(actor, personal.human.id, {
    reason: 'Employee offboarding after failed provisioning',
  });
  assert.equal(offboarded.personal_agent.already_suspended, true);
  assert.equal(enforcedPlans.length, 1);
  assert.equal(enforcedPlans[0].operation, 'suspend_agent');
  assert.equal(enforcedPlans[0].principal_key, personal.agent.principal_key);

  const terminalState = await admin.query(
    `SELECT pair.status AS pair_status,
            human.status AS human_status,
            agent.status AS agent_status,
            workspace.status AS workspace_status,
            array_agg(DISTINCT capability_grant.status ORDER BY capability_grant.status)
              AS grant_statuses
     FROM identity.employee_personal_agents pair
     JOIN identity.principals human ON human.id = pair.human_principal_id
     JOIN identity.principals agent ON agent.id = pair.agent_principal_id
     JOIN identity.employee_workspace_credentials workspace
       ON workspace.human_principal_id = pair.human_principal_id
     JOIN governance.capability_grants capability_grant
       ON capability_grant.principal_id = pair.agent_principal_id
      AND capability_grant.department_id = pair.department_id
     WHERE pair.agent_principal_id = $1
     GROUP BY pair.status, human.status, agent.status, workspace.status`,
    [personal.agent.id],
  );
  assert.deepEqual(terminalState.rows[0], {
    pair_status: 'suspended',
    human_status: 'suspended',
    agent_status: 'suspended',
    workspace_status: 'revoked',
    grant_statuses: ['suspended'],
  });
});
