import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PERMISSIONS } from '../../app/lib/effective-permissions.mjs';
import { createOperatorService } from '../../app/lib/operator-service.mjs';

const ACTOR = Object.freeze({
  principal_id: '00000000-0000-4000-8000-000000000001',
  department_id: '00000000-0000-4000-8000-000000000002',
});

function fixtureDependencies(events, { sealFailure = false } = {}) {
  const repository = {
    async resolveIngestionService() {
      return { principal_id: '00000000-0000-4000-8000-000000000003' };
    },
    async markUploadReady(input) {
      events.push('mark-ready');
      assert.equal(input.seal.read_only_mode, '0440');
      assert.equal(input.scannerPrincipalId, '00000000-0000-4000-8000-000000000003');
      return {
        id: input.uploadId,
        status: 'ready_for_review',
        scan_finding: { verdict: 'clean' },
        seal: {
          status: input.seal.status,
          sha256: input.seal.sha256,
          size_bytes: input.seal.size_bytes,
          owner_enforced: input.seal.owner_enforced,
          read_only_mode: input.seal.read_only_mode,
        },
      };
    },
    async markUploadQuarantined() {
      events.push('mark-quarantined');
      return { status: 'quarantined' };
    },
  };
  const identityPlane = {
    async computeEffectiveAccess() {
      return {
        can(permission) {
          return permission === PERMISSIONS.QUARANTINE_SUBMIT;
        },
        runtime_findings: [],
      };
    },
    async createQuarantinedUpload(input) {
      events.push('db-received');
      return { id: '00000000-0000-4000-8000-000000000004', sha256: input.sha256 };
    },
  };
  const provisionerClient = {
    async seal(input) {
      events.push('root-seal');
      if (sealFailure) throw new Error('quarantine_hash_mismatch');
      return {
        schema_version: 1,
        status: 'sealed',
        storage_key: input.storage_key,
        sha256: input.sha256,
        size_bytes: 16,
        owner_enforced: true,
        read_only_mode: '0440',
        sealed_at: '2026-07-11T05:00:00Z',
      };
    },
  };
  return { repository, identityPlane, provisionerClient };
}

test('every sensitive operator service action fails closed before its dependency is called', async () => {
  let dependencyCalls = 0;
  const denied = new Proxy({}, {
    get() {
      return async () => {
        dependencyCalls += 1;
        throw new Error('dependency_must_not_be_called');
      };
    },
  });
  const identityPlane = {
    ...denied,
    async computeEffectiveAccess() {
      return { can: () => false, runtime_findings: [] };
    },
  };
  const service = createOperatorService({
    identityPlane,
    repository: denied,
    provisionerClient: denied,
  });
  const uuid = '00000000-0000-4000-8000-000000000099';
  const actions = [
    () => service.onboardEmployee(ACTOR, {}),
    () => service.createHuman(ACTOR, {}),
    () => service.createAgent(ACTOR, {}),
    () => service.queueProvisioning(ACTOR, {}),
    () => service.confirmProvisioning(ACTOR, uuid, {}),
    () => service.recordProof(ACTOR, {}),
    () => service.suspendPrincipal(ACTOR, uuid, {}),
    () => service.createUpload(ACTOR, {}),
    () => service.createCandidate(ACTOR, uuid, {}),
    () => service.candidates(ACTOR),
    () => service.reviewCandidate(ACTOR, uuid, {}),
    () => service.promoteCandidate(ACTOR, uuid, {}),
    () => service.audit(ACTOR, {}),
  ];
  for (const invoke of actions) {
    await assert.rejects(invoke, (error) => error.code === 'permission_denied');
  }
  assert.equal(dependencyCalls, 0);
});

test('employee onboarding returns a workspace secret once and persists only its hash', async () => {
  const now = new Date('2026-07-11T10:00:00.000Z');
  const generated = [
    '00000000-0000-4000-8000-000000000021',
    '00000000-0000-4000-8000-000000000022',
  ];
  let captured;
  const identityPlane = {
    async computeEffectiveAccess() {
      return {
        can(permission) {
          return [PERMISSIONS.PROVISIONING_CONFIRM, PERMISSIONS.PROVISIONING_QUEUE].includes(permission);
        },
        runtime_findings: [],
      };
    },
    async onboardEmployeeBundle(input) {
      captured = input;
      return {
        employee: { id: '00000000-0000-4000-8000-000000000021', display_name: 'Mai Nguyen' },
        personal_agent: { id: '00000000-0000-4000-8000-000000000022', display_name: "Mai's Memory Agent" },
        pair: { status: 'provisioning' },
      };
    },
  };
  const service = createOperatorService({
    identityPlane,
    repository: {},
    provisionerClient: {},
    now: () => now,
    randomUUID: () => generated.shift(),
  });

  const result = await service.onboardEmployee(ACTOR, {
    display_name: 'Mai Nguyen',
    work_email: 'mai@example.com',
    job_title: 'Delivery Lead',
    agent_display_name: "Mai's Memory Agent",
  });

  assert.match(result.workspace_access.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(result.workspace_access.one_time_display, true);
  assert.equal(result.workspace_access.secret_persisted, false);
  assert.equal(
    captured.workspaceTokenSha256,
    (await import('node:crypto')).createHash('sha256').update(result.workspace_access.token).digest('hex'),
  );
  assert.equal(captured.humanPrincipalKey, 'human:00000000-0000-4000-8000-000000000021');
  assert.equal(captured.agentPrincipalKey, 'agent:00000000-0000-4000-8000-000000000022');
  assert.equal(captured.workspaceExpiresAt, '2026-07-18T10:00:00.000Z');
  assert.doesNotMatch(JSON.stringify(captured), new RegExp(result.workspace_access.token));
});

test('suspending an employee fail-closes the linked agent identity and host runtime', async () => {
  const humanId = '00000000-0000-4000-8000-000000000021';
  const agentId = '00000000-0000-4000-8000-000000000022';
  const suspendedIds = [];
  const identityPlane = {
    async computeEffectiveAccess() {
      return {
        can: (permission) => permission === PERMISSIONS.PRINCIPAL_SUSPEND,
        runtime_findings: [],
      };
    },
    async suspendPrincipal(input) {
      suspendedIds.push(input.principalId);
      return {
        id: input.principalId,
        principal_key: input.principalId === agentId ? `agent:${agentId}` : 'human:mai',
        status: 'suspended',
      };
    },
  };
  const repository = {
    async personalPairForPrincipal() {
      return { human_principal_id: humanId, agent_principal_id: agentId, status: 'active' };
    },
    async provisioningContext(input) {
      assert.equal(input.principalId, agentId);
      return { principal_key: `agent:${agentId}`, policy_hash: 'a'.repeat(64) };
    },
  };
  let executedPlan;
  const provisionerClient = {
    async execute(plan) {
      executedPlan = plan;
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
  };
  const service = createOperatorService({
    identityPlane,
    repository,
    provisionerClient,
    randomUUID: () => '00000000-0000-4000-8000-000000000099',
  });

  const result = await service.suspendPrincipal(ACTOR, humanId, { reason: 'Employee offboarding' });

  assert.deepEqual(suspendedIds, [agentId, humanId]);
  assert.equal(executedPlan.operation, 'suspend_agent');
  assert.equal(executedPlan.principal_key, `agent:${agentId}`);
  assert.equal(result.principal.id, humanId);
  assert.equal(result.personal_agent.id, agentId);
  assert.equal(result.enforcement.record.verified, true);
});

test('personal agent resume is rejected before provisioning state can mutate', async () => {
  const agentId = '00000000-0000-4000-8000-000000000022';
  let queueCalls = 0;
  let provisionerCalls = 0;
  let generatedIds = 0;
  const identityPlane = {
    async computeEffectiveAccess() {
      return {
        can: (permission) => permission === PERMISSIONS.PROVISIONING_QUEUE,
        runtime_findings: [],
      };
    },
  };
  const repository = {
    async activeAgentPolicy() {
      return { id: '00000000-0000-4000-8000-000000000031', policy_hash: 'a'.repeat(64) };
    },
    async provisioningContext() {
      return {
        principal_key: `agent:${agentId}`,
        status: 'suspended',
        credential_status: 'suspended',
        capability_grant_status: 'suspended',
        policy_hash: 'a'.repeat(64),
        is_personal_agent: true,
      };
    },
    async queueProvisioningWithCredential() {
      queueCalls += 1;
      throw new Error('queue_must_not_be_called');
    },
  };
  const provisionerClient = {
    async execute() {
      provisionerCalls += 1;
      throw new Error('provisioner_must_not_be_called');
    },
  };
  const service = createOperatorService({
    identityPlane,
    repository,
    provisionerClient,
    randomUUID: () => {
      generatedIds += 1;
      return '00000000-0000-4000-8000-000000000099';
    },
  });

  await assert.rejects(
    service.queueProvisioning(ACTOR, { principal_id: agentId, operation: 'resume_agent' }),
    (error) => error.code === 'personal_agent_resume_requires_workspace_reissue'
      && error.status === 409,
  );
  assert.equal(queueCalls, 0);
  assert.equal(provisionerCalls, 0);
  assert.equal(generatedIds, 0);
});

test('employee offboarding continues when the linked personal agent is already suspended', async () => {
  const humanId = '00000000-0000-4000-8000-000000000021';
  const agentId = '00000000-0000-4000-8000-000000000022';
  const suspendedIds = [];
  const identityPlane = {
    async computeEffectiveAccess() {
      return {
        can: (permission) => permission === PERMISSIONS.PRINCIPAL_SUSPEND,
        runtime_findings: [],
      };
    },
    async suspendPrincipal(input) {
      suspendedIds.push(input.principalId);
      return {
        id: input.principalId,
        principal_key: `human:${humanId}`,
        principal_kind: 'human',
        status: 'suspended',
      };
    },
  };
  const repository = {
    async personalPairForPrincipal() {
      return {
        human_principal_id: humanId,
        agent_principal_id: agentId,
        status: 'suspended',
        agent_status: 'suspended',
        agent_principal_key: `agent:${agentId}`,
        agent_suspended_at: '2026-07-11T09:00:00.000Z',
      };
    },
    async provisioningContext(input) {
      assert.equal(input.principalId, agentId);
      return { principal_key: `agent:${agentId}`, policy_hash: 'a'.repeat(64) };
    },
  };
  let executedPlan;
  const provisionerClient = {
    async execute(plan) {
      executedPlan = plan;
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
  };
  const service = createOperatorService({
    identityPlane,
    repository,
    provisionerClient,
    randomUUID: () => '00000000-0000-4000-8000-000000000099',
  });

  const result = await service.suspendPrincipal(ACTOR, humanId, {
    reason: 'Employee offboarding after failed provisioning',
  });

  assert.deepEqual(suspendedIds, [humanId]);
  assert.equal(executedPlan.operation, 'suspend_agent');
  assert.equal(executedPlan.principal_key, `agent:${agentId}`);
  assert.equal(result.principal.id, humanId);
  assert.equal(result.personal_agent.id, agentId);
  assert.equal(result.personal_agent.already_suspended, true);
  assert.equal(result.enforcement.record.verified, true);
});

test('upload is sealed by the root allowlist before clean scan evidence and readiness', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oam-operator-upload-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const events = [];
  const service = createOperatorService({
    ...fixtureDependencies(events),
    quarantineRoot: root,
    randomUUID: () => '00000000-0000-4000-8000-000000000099',
  });
  const result = await service.createUpload(ACTOR, {
    original_name: 'handoff.md',
    media_type: 'text/markdown',
    content: '# Website handoff\n',
  });
  assert.equal(result.status, 'ready_for_review');
  assert.deepEqual(result.seal, {
    status: 'sealed',
    sha256: result.seal.sha256,
    size_bytes: 16,
    owner_enforced: true,
    read_only_mode: '0440',
  });
  assert.deepEqual(events, ['db-received', 'root-seal', 'mark-ready']);
});

test('seal failure keeps the DB upload quarantined and never records a clean finding', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oam-operator-upload-fail-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const events = [];
  const service = createOperatorService({
    ...fixtureDependencies(events, { sealFailure: true }),
    quarantineRoot: root,
    randomUUID: () => '00000000-0000-4000-8000-000000000099',
  });
  await assert.rejects(
    service.createUpload(ACTOR, {
      original_name: 'handoff.txt',
      media_type: 'text/plain',
      content: 'Website handoff\n',
    }),
    (error) => error.code === 'quarantine_seal_failed',
  );
  assert.deepEqual(events, ['db-received', 'root-seal', 'mark-quarantined']);
});

test('candidate evidence and provenance are derived from verified sealed bytes', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oam-operator-candidate-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const content = '# Sealed handoff\nUse the approved evidence and run the bounded checks.\n';
  const sha256 = (await import('node:crypto')).createHash('sha256').update(content).digest('hex');
  const storageKey = `${sha256.slice(0, 2)}/${sha256}`;
  const target = path.join(root, storageKey);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, { mode: 0o440 });
  await fs.chmod(target, 0o440);
  let captured;
  const repository = {
    async readyUpload() {
      return {
        id: '00000000-0000-4000-8000-000000000004',
        submitted_by_principal_id: ACTOR.principal_id,
        storage_key: storageKey,
        sha256,
        size_bytes: Buffer.byteLength(content),
        status: 'ready_for_review',
        latest_scan_verdict: 'clean',
        latest_scan_sha256: sha256,
      };
    },
    async resolveIngestionService() {
      return { principal_id: '00000000-0000-4000-8000-000000000003' };
    },
  };
  const identityPlane = {
    async computeEffectiveAccess() {
      return { can: (permission) => permission === PERMISSIONS.QUARANTINE_SUBMIT, runtime_findings: [] };
    },
    async createCandidate(input) {
      captured = input;
      return { id: '00000000-0000-4000-8000-000000000005', candidate_key: input.candidateKey };
    },
    async appendAudit() {},
  };
  const service = createOperatorService({
    identityPlane,
    repository,
    provisionerClient: {},
    quarantineRoot: root,
    quarantineOwnerUid: process.getuid(),
    randomUUID: () => '00000000-0000-4000-8000-000000000099',
  });

  await service.createCandidate(ACTOR, '00000000-0000-4000-8000-000000000004', {
    candidate_type: 'best_practice',
    title: 'Sealed evidence practice',
    payload: { instruction: 'Use approved evidence.' },
  });

  assert.equal(captured.submittedByPrincipalId, ACTOR.principal_id);
  assert.equal(captured.sourceUploadSha256, sha256);
  assert.deepEqual(captured.evidence, [{
    evidence_kind: 'upload_text',
    evidence_ref: `sha256:${sha256}`,
    excerpt: content.trim(),
  }]);
});

test('candidate extraction rejects writable or hash-mismatched upload files', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oam-operator-candidate-bad-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const recorded = 'trusted content\n';
  const sha256 = (await import('node:crypto')).createHash('sha256').update(recorded).digest('hex');
  const storageKey = `${sha256.slice(0, 2)}/${sha256}`;
  const target = path.join(root, storageKey);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, 'changed content\n', { mode: 0o640 });
  const repository = {
    async readyUpload() {
      return {
        id: '00000000-0000-4000-8000-000000000004',
        submitted_by_principal_id: ACTOR.principal_id,
        storage_key: storageKey,
        sha256,
        size_bytes: Buffer.byteLength(recorded),
        status: 'ready_for_review',
      };
    },
  };
  let created = false;
  const identityPlane = {
    async computeEffectiveAccess() {
      return { can: (permission) => permission === PERMISSIONS.QUARANTINE_SUBMIT, runtime_findings: [] };
    },
    async createCandidate() { created = true; },
  };
  const service = createOperatorService({
    identityPlane,
    repository,
    provisionerClient: {},
    quarantineRoot: root,
    quarantineOwnerUid: process.getuid(),
  });

  await assert.rejects(
    service.createCandidate(ACTOR, '00000000-0000-4000-8000-000000000004', {
      candidate_type: 'workflow', title: 'Rejected source', payload: {},
    }),
    (error) => error.code === 'sealed_upload_integrity_failed',
  );
  assert.equal(created, false);
});

test('late or timed-out root provisioning is followed by queued host suspension', async () => {
  const jobId = '00000000-0000-4000-8000-000000000010';
  const policyHash = 'a'.repeat(64);
  const operations = [];
  let failedInput;
  const identityPlane = {
    async computeEffectiveAccess() {
      return { can: () => true, runtime_findings: [] };
    },
    async queueProvisioningPlan(input) {
      return { id: jobId, department_id: input.departmentId, revision: 0 };
    },
    async confirmProvisioningPlan(input) {
      return { id: jobId, department_id: input.departmentId, status: 'confirmed' };
    },
  };
  const repository = {
    async activeAgentPolicy() {
      return { id: '00000000-0000-4000-8000-000000000020', template_key: 'memory_reuse_agent', version: 1, policy_hash: policyHash };
    },
    async queueProvisioningWithCredential(input) {
      return { id: jobId, department_id: input.departmentId, revision: 0 };
    },
    async provisioningContext() {
      return {
        principal_key: 'agent:00000000-0000-4000-8000-000000000099',
        status: 'draft',
        credential_status: 'draft',
        capability_grant_status: 'draft',
        policy_hash: policyHash,
      };
    },
    async stageProvisioning(input) {
      assert.equal(input.departmentId, ACTOR.department_id);
    },
    async failProvisioning(input) {
      failedInput = input;
      return { status: 'failed' };
    },
  };
  const provisionerClient = {
    async execute(plan) {
      operations.push(plan.operation);
      if (plan.operation === 'provision_agent') {
        const error = new Error('provisioner_timeout');
        error.code = 'provisioner_timeout';
        error.status = 502;
        throw error;
      }
      return { record: {
        status: 'succeeded', suspension: 'enforced', verified: true,
        service_inactive: true, unit_disabled: true, processes_absent: true,
        account_locked: true, broker_group_removed: true, credentials_absent: true,
      } };
    },
  };
  let uuidCounter = 30;
  const service = createOperatorService({
    identityPlane,
    repository,
    provisionerClient,
    randomUUID: () => `00000000-0000-4000-8000-${String(uuidCounter++).padStart(12, '0')}`,
  });
  const queued = await service.queueProvisioning(ACTOR, {
    principal_id: '00000000-0000-4000-8000-000000000099',
    operation: 'provision_agent',
  });

  await assert.rejects(
    service.confirmProvisioning(ACTOR, queued.id, { expected_revision: 0 }),
    (error) => error.code === 'provisioner_timeout',
  );
  assert.deepEqual(operations, ['provision_agent', 'suspend_agent']);
  assert.equal(failedInput.departmentId, ACTOR.department_id);
  assert.equal(failedInput.errorCode, 'provisioner_timeout');
});

test('in-memory provisioning credential cannot be confirmed from another department', async () => {
  const jobId = '00000000-0000-4000-8000-000000000010';
  const policyHash = 'b'.repeat(64);
  let confirmCalls = 0;
  let hostCalls = 0;
  const identityPlane = {
    async computeEffectiveAccess() { return { can: () => true, runtime_findings: [] }; },
    async queueProvisioningPlan(input) { return { id: jobId, department_id: input.departmentId, revision: 0 }; },
    async confirmProvisioningPlan() { confirmCalls += 1; },
  };
  const repository = {
    async activeAgentPolicy() { return { id: '00000000-0000-4000-8000-000000000020', policy_hash: policyHash }; },
    async queueProvisioningWithCredential(input) {
      return { id: jobId, department_id: input.departmentId, revision: 0 };
    },
    async provisioningContext() {
      return {
        principal_key: 'agent:00000000-0000-4000-8000-000000000099', status: 'draft',
        credential_status: 'draft', capability_grant_status: 'draft', policy_hash: policyHash,
      };
    },
  };
  const service = createOperatorService({
    identityPlane,
    repository,
    provisionerClient: { async execute() { hostCalls += 1; } },
    randomUUID: () => '00000000-0000-4000-8000-000000000030',
  });
  await service.queueProvisioning(ACTOR, {
    principal_id: '00000000-0000-4000-8000-000000000099', operation: 'provision_agent',
  });
  const otherDepartmentActor = {
    ...ACTOR,
    department_id: '00000000-0000-4000-8000-000000000088',
  };

  await assert.rejects(
    service.confirmProvisioning(otherDepartmentActor, jobId, { expected_revision: 0 }),
    (error) => error.code === 'department_scope_denied',
  );
  assert.equal(confirmCalls, 0);
  assert.equal(hostCalls, 0);
});
