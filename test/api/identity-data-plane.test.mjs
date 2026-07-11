import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createIdentityDataPlane,
  IdentityDataPlaneError,
} from '../../app/lib/identity-data-plane.mjs';

const DEPARTMENT_ID = '00000000-0000-4000-8000-000000000001';
const HUMAN_ID = '00000000-0000-4000-8000-000000000002';
const REVIEWER_ID = '00000000-0000-4000-8000-000000000003';
const ARCHITECT_ID = '00000000-0000-4000-8000-000000000004';
const AGENT_ID = '00000000-0000-4000-8000-000000000005';
const UPLOAD_ID = '00000000-0000-4000-8000-000000000006';
const CANDIDATE_ID = '00000000-0000-4000-8000-000000000007';
const DRAFT_ID = '00000000-0000-4000-8000-000000000008';
const JOB_ID = '00000000-0000-4000-8000-000000000009';
const IDEMPOTENCY_ID = '00000000-0000-4000-8000-000000000010';
const POLICY_ID = '00000000-0000-4000-8000-000000000011';
const ASSIGNMENT_ID = '00000000-0000-4000-8000-000000000012';
const AT = new Date('2026-07-11T05:00:00Z');

function normalized(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

function fakePool(handler) {
  const calls = [];
  const query = async (sql, parameters = []) => {
    const compact = normalized(sql);
    calls.push({ sql: compact, parameters });
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(compact)) return { rows: [] };
    return handler(compact, parameters, calls);
  };
  return {
    calls,
    query,
    async connect() {
      return { query, release() {} };
    },
  };
}

function activeHuman(id, key = 'human:test') {
  return { id, principal_key: key, principal_kind: 'human', status: 'active' };
}

function activeAgent(id) {
  return { id, principal_key: 'agent:test', principal_kind: 'agent', status: 'active' };
}

function membership(id, role) {
  return {
    principal_id: id,
    department_id: DEPARTMENT_ID,
    membership_role: role,
    status: 'active',
    valid_from: '2026-07-01T00:00:00Z',
    valid_to: null,
  };
}

function authorizationHandler(principal, role, bindings = []) {
  return (sql) => {
    if (sql.includes('FROM identity.principals') && sql.includes('WHERE id = $1')) {
      return { rows: [principal] };
    }
    if (sql.includes('FROM identity.department_memberships')) {
      return { rows: [membership(principal.id, role)] };
    }
    if (sql.includes('FROM identity.runtime_bindings')) return { rows: bindings };
    return null;
  };
}

test('onboardEmployeeBundle delegates one atomic hash-only database operation', async () => {
  const workspaceHash = 'a'.repeat(64);
  const expected = {
    employee: { id: HUMAN_ID, principal_key: 'human:mai' },
    personal_agent: { id: AGENT_ID, principal_key: 'agent:mai_memory' },
    pair: { status: 'provisioning' },
  };
  const pool = fakePool((sql, parameters) => {
    if (sql.includes('identity.onboard_employee_bundle')) {
      assert.deepEqual(parameters, [
        'human:mai',
        'Mai Nguyen',
        'mai@example.com',
        'Delivery Lead',
        'agent:mai_memory',
        "Mai's Memory Agent",
        workspaceHash,
        '2026-07-18T10:00:00.000Z',
      ]);
      return { rows: [{ bundle: expected }] };
    }
    return { rows: [] };
  });
  const plane = createIdentityDataPlane({ pool });

  const result = await plane.onboardEmployeeBundle({
    humanPrincipalKey: 'human:mai',
    displayName: 'Mai Nguyen',
    workEmail: 'MAI@example.com',
    jobTitle: 'Delivery Lead',
    agentPrincipalKey: 'agent:mai_memory',
    agentDisplayName: "Mai's Memory Agent",
    workspaceTokenSha256: workspaceHash,
    workspaceExpiresAt: '2026-07-18T10:00:00.000Z',
  });

  assert.deepEqual(result, expected);
  assert.equal(pool.calls[0].sql, 'BEGIN');
  assert.equal(pool.calls.at(-1).sql, 'COMMIT');
  assert.equal(pool.calls.some((call) => call.parameters.includes?.('MAI@example.com')), false);
});

test('onboardEmployeeBundle rejects invalid work email before opening a transaction', async () => {
  const pool = fakePool(() => ({ rows: [] }));
  const plane = createIdentityDataPlane({ pool });
  await assert.rejects(
    plane.onboardEmployeeBundle({
      humanPrincipalKey: 'human:mai',
      displayName: 'Mai Nguyen',
      workEmail: 'not-an-email',
      jobTitle: 'Delivery Lead',
      agentPrincipalKey: 'agent:mai_memory',
      agentDisplayName: "Mai's Memory Agent",
      workspaceTokenSha256: 'a'.repeat(64),
      workspaceExpiresAt: '2026-07-18T10:00:00Z',
    }),
    (error) => error instanceof IdentityDataPlaneError && error.code === 'invalid_input',
  );
  assert.equal(pool.calls.length, 0);
});

test('createHuman creates a logical identity and no OS or database binding', async () => {
  const auth = authorizationHandler(activeHuman(ARCHITECT_ID, 'human:architect'), 'architect');
  const pool = fakePool((sql) => {
    if (sql.includes('identity:created-principal')) {
      return { rows: [{
        id: HUMAN_ID,
        principal_key: 'human:new_operator',
        principal_kind: 'human',
        display_name: 'New Operator',
        status: 'active',
        created_at: AT,
      }] };
    }
    const authorized = auth(sql);
    if (authorized) return authorized;
    if (sql.includes('FROM identity.policy_templates') && sql.includes('template_key = $1')) {
      return { rows: [{ id: POLICY_ID, template_key: 'member', version: 1 }] };
    }
    if (sql.includes('INSERT INTO identity.principals')) {
      return { rows: [{
        id: HUMAN_ID,
        principal_key: 'human:new_operator',
        principal_kind: 'human',
        display_name: 'New Operator',
        status: 'active',
        created_at: AT,
      }] };
    }
    if (sql.includes('INSERT INTO audit.security_events')) {
      return { rows: [{ event_key: IDEMPOTENCY_ID, occurred_at: AT }] };
    }
    if (sql.includes('INSERT INTO identity.policy_assignments')) {
      return { rows: [{
        id: ASSIGNMENT_ID,
        assignment_key: `assignment:${ASSIGNMENT_ID}`,
        principal_id: HUMAN_ID,
        department_id: DEPARTMENT_ID,
        template_id: POLICY_ID,
        status: 'active',
        valid_from: AT,
      }] };
    }
    return { rows: [] };
  });
  const ids = [HUMAN_ID, ASSIGNMENT_ID];
  const plane = createIdentityDataPlane({
    pool,
    now: () => AT,
    randomUUID: () => ids.shift(),
    requirePolicyAssignment: false,
  });

  const human = await plane.createHuman({
    principalKey: 'human:new_operator',
    displayName: 'New Operator',
    externalIssuer: 'https://identity.example.test',
    externalSubject: 'subject-123',
    departmentId: DEPARTMENT_ID,
    requestedByPrincipalId: ARCHITECT_ID,
  });

  assert.equal(human.logical_only, true);
  assert.equal(human.id, HUMAN_ID);
  assert.equal(human.principal_key, 'human:new_operator');
  assert.deepEqual(human.runtime_bindings, []);
  assert.equal(human.policy_assignments[0].template_id, POLICY_ID);
  assert.equal(pool.calls.some((call) => call.sql.includes('INSERT INTO identity.runtime_bindings')), false);
  const principalInsert = pool.calls.findIndex((call) => call.sql.includes('INSERT INTO identity.principals'));
  const membershipInsert = pool.calls.findIndex((call) => call.sql.includes('INSERT INTO identity.department_memberships'));
  const scopedRead = pool.calls.findIndex((call) => call.sql.includes('identity:created-principal'));
  assert.doesNotMatch(pool.calls[principalInsert].sql, /RETURNING/);
  assert.ok(principalInsert < membershipInsert && membershipInsert < scopedRead);
  assert.equal(pool.calls.at(-1).sql, 'COMMIT');
});

test('createLinkedAgentDraft makes an independent draft with no inherited permission', async () => {
  const pool = fakePool((sql) => {
    if (sql.includes('FROM identity.principals') && sql.includes('FOR SHARE')) {
      return { rows: [activeHuman(HUMAN_ID, 'human:owner')] };
    }
    if (sql.includes('INSERT INTO identity.principals')) {
      return { rows: [{
        id: AGENT_ID,
        principal_key: 'agent:research_assistant',
        principal_kind: 'agent',
        display_name: 'Research Assistant',
        status: 'draft',
        created_at: AT,
      }] };
    }
    if (sql.includes('INSERT INTO audit.security_events')) {
      return { rows: [{ event_key: IDEMPOTENCY_ID, occurred_at: AT }] };
    }
    return { rows: [] };
  });
  const plane = createIdentityDataPlane({ pool, now: () => AT, requirePolicyAssignment: false });

  const agent = await plane.createLinkedAgentDraft({
    principalKey: 'agent:research_assistant',
    displayName: 'Research Assistant',
    ownerPrincipalId: HUMAN_ID,
    requestedByPrincipalId: HUMAN_ID,
  });

  assert.equal(agent.status, 'draft');
  assert.equal(agent.inherits_permissions, false);
  assert.deepEqual(agent.runtime_bindings, []);
  const linkCall = pool.calls.find((call) => call.sql.includes('INSERT INTO identity.principal_links'));
  assert.ok(linkCall);
  assert.match(linkCall.parameters[2], /permission_inheritance/);
  assert.equal(pool.calls.some((call) => call.sql.includes('department_memberships') && call.sql.includes('INSERT')), false);
});

test('linked agent draft rejects creation on behalf of another human', async () => {
  const pool = fakePool(() => ({ rows: [] }));
  const plane = createIdentityDataPlane({ pool, now: () => AT, requirePolicyAssignment: false });

  await assert.rejects(
    plane.createLinkedAgentDraft({
      principalKey: 'agent:other_agent',
      displayName: 'Other Agent',
      ownerPrincipalId: HUMAN_ID,
      requestedByPrincipalId: ARCHITECT_ID,
    }),
    (error) => error instanceof IdentityDataPlaneError && error.code === 'permission_denied',
  );
  assert.equal(pool.calls.length, 0);
});

test('queue and confirm provisioning preserve an explicit confirmation gate', async () => {
  const auth = authorizationHandler(activeHuman(ARCHITECT_ID, 'human:architect'), 'architect');
  let queued = true;
  const pool = fakePool((sql) => {
    const authorized = auth(sql);
    if (authorized) return authorized;
    if (sql.includes('INSERT INTO identity.provisioning_jobs')) {
      return { rows: [{
        id: JOB_ID,
        idempotency_key: IDEMPOTENCY_ID,
        principal_id: AGENT_ID,
        job_type: 'broker_credential',
        status: 'queued',
        plan: { binding_kind: 'broker_client' },
        plan_hash: 'a'.repeat(64),
        revision: 0,
        requested_at: AT,
      }] };
    }
    if (sql.includes('UPDATE identity.provisioning_jobs')) {
      assert.equal(queued, true);
      queued = false;
      return { rows: [{
        id: JOB_ID,
        principal_id: AGENT_ID,
        job_type: 'broker_credential',
        status: 'confirmed',
        plan_hash: 'a'.repeat(64),
        revision: 1,
        confirmed_at: AT,
      }] };
    }
    return { rows: [] };
  });
  const plane = createIdentityDataPlane({ pool, now: () => AT, requirePolicyAssignment: false });

  const job = await plane.queueProvisioningPlan({
    principalId: AGENT_ID,
    jobType: 'broker_credential',
    requestedByPrincipalId: ARCHITECT_ID,
    departmentId: DEPARTMENT_ID,
    plan: { binding_kind: 'broker_client', access_mode: 'brokered' },
    idempotencyKey: IDEMPOTENCY_ID,
  });
  const confirmed = await plane.confirmProvisioningPlan({
    jobId: job.id,
    expectedRevision: job.revision,
    confirmedByPrincipalId: ARCHITECT_ID,
    departmentId: DEPARTMENT_ID,
  });

  assert.equal(job.status, 'queued');
  assert.equal(confirmed.status, 'confirmed');
  assert.equal(confirmed.revision, 1);
});

test('provisioning confirmation is bound to the queued department', async () => {
  const otherDepartment = '00000000-0000-4000-8000-000000000099';
  const baseAuth = authorizationHandler(activeHuman(ARCHITECT_ID, 'human:architect'), 'architect');
  const pool = fakePool((sql) => {
    const authorized = baseAuth(sql);
    if (authorized?.rows?.[0]?.department_id) {
      authorized.rows[0] = { ...authorized.rows[0], department_id: otherDepartment };
    }
    if (authorized) return authorized;
    if (sql.includes('UPDATE identity.provisioning_jobs')) {
      assert.match(sql, /department_id = \$4/);
      return { rows: [] };
    }
    return { rows: [] };
  });
  const plane = createIdentityDataPlane({ pool, now: () => AT, requirePolicyAssignment: false });

  await assert.rejects(
    plane.confirmProvisioningPlan({
      jobId: JOB_ID,
      expectedRevision: 0,
      confirmedByPrincipalId: ARCHITECT_ID,
      departmentId: otherDepartment,
    }),
    (error) => error instanceof IdentityDataPlaneError && error.code === 'provisioning_conflict',
  );
  const update = pool.calls.find((call) => call.sql.includes('UPDATE identity.provisioning_jobs'));
  assert.equal(update.parameters[3], otherDepartment);
});

test('quarantined candidate requires the agent own membership and broker binding', async () => {
  const broker = {
    principal_id: AGENT_ID,
    binding_kind: 'broker_client',
    binding_value: 'broker:agent-test',
    access_mode: 'brokered',
    status: 'active',
    valid_from: '2026-07-01T00:00:00Z',
    valid_to: null,
  };
  const auth = authorizationHandler(activeAgent(AGENT_ID), 'member', [broker]);
  const pool = fakePool((sql) => {
    const authorized = auth(sql);
    if (authorized) return authorized;
    if (sql.includes('FROM quarantine.uploads') && sql.includes('FOR SHARE')) {
      return { rows: [{
        id: UPLOAD_ID,
        owning_department_id: DEPARTMENT_ID,
        status: 'ready_for_review',
        sha256: 'a'.repeat(64),
        latest_scan_verdict: 'clean',
        latest_scan_sha256: 'a'.repeat(64),
      }] };
    }
    if (sql.includes('INSERT INTO quarantine.candidates')) {
      return { rows: [{
        id: CANDIDATE_ID,
        candidate_key: 'candidate:website_handoff_v2',
        candidate_type: 'prompt',
        title: 'Website handoff v2',
        content_hash: 'b'.repeat(64),
        status: 'review_pending',
        revision: 0,
        created_at: AT,
      }] };
    }
    if (sql.includes('INSERT INTO audit.security_events')) {
      return { rows: [{ event_key: IDEMPOTENCY_ID, occurred_at: AT }] };
    }
    return { rows: [] };
  });
  const plane = createIdentityDataPlane({ pool, now: () => AT, requirePolicyAssignment: false });

  const candidate = await plane.createCandidate({
    candidateKey: 'candidate:website_handoff_v2',
    uploadId: UPLOAD_ID,
    producedByPrincipalId: AGENT_ID,
    submittedByPrincipalId: HUMAN_ID,
    departmentId: DEPARTMENT_ID,
    sourceUploadSha256: 'a'.repeat(64),
    candidateType: 'prompt',
    title: 'Website handoff v2',
    candidatePayload: { template: 'Use approved evidence.' },
    evidence: [{
      evidence_kind: 'upload_text',
      evidence_ref: `sha256:${'a'.repeat(64)}`,
      excerpt: 'Approved sanitized upload.',
    }],
  });

  assert.equal(candidate.status, 'review_pending');
  assert.equal(pool.calls.filter((call) => call.sql.includes('INSERT INTO quarantine.candidate_evidence')).length, 1);
});

test('architect promotion calls the guarded function and only returns a draft', async () => {
  const auth = authorizationHandler(activeHuman(ARCHITECT_ID, 'human:architect'), 'architect');
  const pool = fakePool((sql) => {
    const authorized = auth(sql);
    if (authorized) return authorized;
    if (sql.includes('FROM quarantine.candidates') && sql.includes('owning_department_id = $2')) {
      return { rows: [{ id: CANDIDATE_ID }] };
    }
    if (sql.includes('FROM governance.promote_candidate_to_draft')) {
      return { rows: [{
        draft_id: DRAFT_ID,
        draft_key: 'draft:website_handoff_v2',
        review_status: 'draft',
        candidate_revision: 3,
      }] };
    }
    return { rows: [] };
  });
  const plane = createIdentityDataPlane({ pool, now: () => AT, requirePolicyAssignment: false });

  const result = await plane.promoteCandidateAsDraft({
    candidateId: CANDIDATE_ID,
    architectPrincipalId: ARCHITECT_ID,
    departmentId: DEPARTMENT_ID,
    expectedRevision: 2,
    idempotencyKey: IDEMPOTENCY_ID,
  });

  assert.equal(result.review_status, 'draft');
  assert.equal(pool.calls.some((call) => call.sql.includes('INSERT INTO memory.')), false);
  assert.equal(pool.calls.some((call) => call.sql.includes('promote_candidate_to_draft')), true);
});

test('suspension expires memberships, bindings, and pending provisioning in one transaction', async () => {
  const auth = authorizationHandler(activeHuman(ARCHITECT_ID, 'human:architect'), 'architect');
  const pool = fakePool((sql) => {
    const authorized = auth(sql);
    if (authorized) return authorized;
    if (sql.includes('UPDATE identity.principals')) {
      return { rows: [{
        id: AGENT_ID,
        principal_key: 'agent:research_assistant',
        principal_kind: 'agent',
        status: 'suspended',
        suspended_at: AT,
      }] };
    }
    if (sql.includes('INSERT INTO audit.security_events')) {
      return { rows: [{ event_key: IDEMPOTENCY_ID, occurred_at: AT }] };
    }
    return { rows: [] };
  });
  const plane = createIdentityDataPlane({ pool, now: () => AT, requirePolicyAssignment: false });

  const suspended = await plane.suspendPrincipal({
    principalId: AGENT_ID,
    suspendedByPrincipalId: ARCHITECT_ID,
    departmentId: DEPARTMENT_ID,
    reason: 'Agent access is no longer required.',
  });

  assert.equal(suspended.status, 'suspended');
  assert.equal(pool.calls.some((call) => call.sql.includes('UPDATE identity.department_memberships')), true);
  assert.equal(pool.calls.some((call) => call.sql.includes('UPDATE identity.runtime_bindings')), true);
  assert.equal(pool.calls.some((call) => call.sql.includes('UPDATE identity.provisioning_jobs')), true);
  assert.equal(pool.calls.at(-1).sql, 'COMMIT');
});

test('audit listing requires and filters the authenticated department', async () => {
  const pool = fakePool((sql) => {
    if (sql.includes('FROM audit.security_events')) return { rows: [] };
    return { rows: [] };
  });
  const plane = createIdentityDataPlane({ pool, now: () => AT, requirePolicyAssignment: false });

  await plane.listAudit({ departmentId: DEPARTMENT_ID, limit: 25 });
  const query = pool.calls.find((call) => call.sql.includes('FROM audit.security_events'));
  assert.match(query.sql, /WHERE department_id = \$1/);
  assert.equal(query.parameters[0], DEPARTMENT_ID);
  await assert.rejects(
    plane.listAudit({ limit: 25 }),
    (error) => error instanceof IdentityDataPlaneError && error.code === 'invalid_input',
  );
});
