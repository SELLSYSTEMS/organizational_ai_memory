import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  loadProofCredentials,
  runIdentityPlaneProof,
} from '../../scripts/evaluation/run_identity_plane_proof.mjs';

const ARCHITECT_ID = '00000000-0000-4000-8000-000000000001';
const REVIEWER_ID = '00000000-0000-4000-8000-000000000002';
const HUMAN_ID = '00000000-0000-4000-8000-000000000003';
const AGENT_ID = '00000000-0000-4000-8000-000000000004';
const UPLOAD_ID = '00000000-0000-4000-8000-000000000005';
const CANDIDATE_ID = '00000000-0000-4000-8000-000000000006';
const DRAFT_ID = '00000000-0000-4000-8000-000000000007';
const JOB_ID = '00000000-0000-4000-8000-000000000008';
const AGENT_KEY = `agent:${AGENT_ID}`;
const ARCHITECT_TOKEN = 'a'.repeat(43);
const REVIEWER_TOKEN = 'b'.repeat(43);
const GENERATED_AT = '2026-07-11T05:00:00.000Z';

function noMatch(query) {
  return {
    query: { text: query },
    status: 'no_match',
    resolution: { kind: 'none' },
    asset_matches: [],
    task_matches: [],
  };
}

function passingAdapter({ failProvisioning = false, leakCandidate = false } = {}) {
  let suspended = false;
  let candidateReviewed = false;
  const calls = [];
  const architect = {
    actor: {
      principal_id: ARCHITECT_ID,
      principal_key: 'human:ai_architect',
      department_id: '00000000-0000-4000-8000-000000000009',
      membership_role: 'architect',
    },
    client: { private_session: true },
  };
  const reviewer = {
    actor: {
      principal_id: REVIEWER_ID,
      principal_key: 'human:capability_reviewer',
      department_id: '00000000-0000-4000-8000-000000000009',
      membership_role: 'reviewer',
    },
    client: { private_session: true },
  };
  const proof = {
    passed: true,
    checks: [
      { label: 'repository_read', expected: 'denied', actual: 'denied', passed: true, code: 'EACCES' },
      { label: 'installed_application_read', expected: 'denied', actual: 'denied', passed: true, code: 'EACCES' },
      { label: 'application_environment_read', expected: 'denied', actual: 'denied', passed: true, code: 'EACCES' },
      { label: 'model_authentication_read', expected: 'denied', actual: 'denied', passed: true, code: 'EACCES' },
      { label: 'own_workspace_write', expected: 'allowed', actual: 'allowed', passed: true },
      { label: 'outbound_ip_socket', expected: 'denied', actual: 'denied', passed: true, code: 'EAFNOSUPPORT' },
      { label: 'direct_postgres_connect', expected: 'denied', actual: 'denied', passed: true, code: '42501' },
    ],
    broker: {
      passed: true,
      status: 200,
      authorization: 'allowed',
      asset_key: 'workflow:public_demo_release_v1',
      source_count: 2,
      policy_hash: 'c'.repeat(64),
    },
  };
  const binding = {
    runtimeKey: '3a59ce936e32',
    osUser: 'oam-a-3a59ce936e32',
    unitName: 'organizational-ai-memory-agent@3a59ce936e32.service',
    stateDirectory: '/var/lib/oam-agents/3a59ce936e32',
    credentialDirectory: '/etc/oam-agents/3a59ce936e32',
  };

  return {
    calls,
    async ready() {
      calls.push('ready');
      return {
        status: 'ready',
        checks: { database: 'available', public_corpus: 'available', capability_pack: 'available' },
      };
    },
    async authenticate(role, token) {
      calls.push(`authenticate:${role}`);
      assert.equal(token, role === 'architect' ? ARCHITECT_TOKEN : REVIEWER_TOKEN);
      return role === 'architect' ? architect : reviewer;
    },
    async createHuman(_session, input) {
      calls.push('createHuman');
      assert.match(input.principal_key, /^human:proof_[0-9a-f]+$/);
      return {
        id: HUMAN_ID,
        principal_kind: 'human',
        status: 'active',
        logical_only: true,
        runtime_bindings: [],
      };
    },
    async createAndProvisionAgent() {
      calls.push('createAndProvisionAgent');
      if (failProvisioning) {
        const error = new Error('provisioner_unavailable');
        error.code = 'provisioner_unavailable';
        throw error;
      }
      return {
        agent: {
          id: AGENT_ID,
          principal_key: AGENT_KEY,
          status: 'draft',
          inherits_permissions: false,
        },
        job: {
          id: JOB_ID, status: 'queued', revision: 0, department_id: architect.actor.department_id,
        },
        confirmation: {
          confirmed: {
            status: 'confirmed', revision: 1, department_id: architect.actor.department_id,
          },
        },
        record: { status: 'succeeded', binding, proof },
        binding,
        proof,
      };
    },
    async effectiveAccess() {
      calls.push('effectiveAccess');
      return suspended
        ? { permissions: [], explicit_denials: ['memory.canonical.write'], runtime_findings: [] }
        : {
            permissions: ['audit.append', 'candidate.create', 'memory.department.read', 'memory.public.read'],
            explicit_denials: ['memory.canonical.write'],
            runtime_findings: [],
          };
    },
    async host(_binding, _key, phase) {
      calls.push(`host:${phase}`);
      return phase === 'active'
        ? {
            user_exists: true,
            system_uid: true,
            locked_shell: true,
            state_owned_private: true,
            credential_root_owned: true,
            token_owned_private: true,
            principal_owned_private: true,
            broker_group_member: true,
            service_active: true,
            service_user_matches: true,
            no_new_privileges: true,
            broker_socket_present: true,
          }
        : {
            user_exists: true,
            locked_shell: true,
            account_locked: true,
            service_active: false,
            credential_files_absent: true,
            broker_group_member: false,
          };
    },
    async database() {
      calls.push('database');
      return {
        least_privileged: true,
        public_schema_usage: true,
        memory_schema_denied: true,
        canonical_exists: true,
        canonical_select_denied: true,
        canonical_insert_denied: true,
        canonical_update_denied: true,
        canonical_delete_denied: true,
        broker_rls_forced: true,
        grant_rls_forced: true,
        real_mutation_denied: true,
      };
    },
    async publicSearch(query) {
      calls.push('publicSearch');
      if (leakCandidate) {
        return {
          query: { text: query },
          status: 'matched',
          resolution: { kind: 'asset' },
          asset_matches: [{ asset: { asset_key: 'practice:leaked_candidate' } }],
          task_matches: [],
        };
      }
      return noMatch(query);
    },
    async createUpload() {
      calls.push('createUpload');
      return {
        id: UPLOAD_ID,
        status: 'ready_for_review',
        sha256: 'd'.repeat(64),
        seal: {
          status: 'sealed',
          sha256: 'd'.repeat(64),
          owner_enforced: true,
          read_only_mode: '0440',
        },
      };
    },
    async createCandidate(_session, uploadId) {
      calls.push('createCandidate');
      assert.equal(uploadId, UPLOAD_ID);
      return {
        id: CANDIDATE_ID,
        status: 'review_pending',
        revision: 0,
        content_hash: 'e'.repeat(64),
        source_upload_sha256: 'd'.repeat(64),
        submitted_by_principal_id: ARCHITECT_ID,
      };
    },
    async listCandidates() {
      calls.push('listCandidates');
      return {
        items: [{
          id: CANDIDATE_ID,
          status: candidateReviewed ? 'reviewed' : 'review_pending',
          produced_by_principal_key: 'service:governed_ingestion',
          submitted_by_principal_key: 'human:ai_architect',
          source_upload_sha256: 'd'.repeat(64),
          content_hash: 'e'.repeat(64),
          approved_content_hash: candidateReviewed ? 'e'.repeat(64) : null,
          evidence: [{
            evidence_kind: 'upload_text',
            evidence_ref: `sha256:${'d'.repeat(64)}`,
            excerpt: 'Governed identity proof evidence.',
          }],
          reviews: candidateReviewed ? [{ candidate_content_hash: 'e'.repeat(64) }] : [],
        }],
      };
    },
    async reviewCandidate(_session, candidateId, input) {
      calls.push('reviewCandidate');
      assert.equal(candidateId, CANDIDATE_ID);
      assert.equal(input.expected_revision, 0);
      candidateReviewed = true;
      return { candidate_id: CANDIDATE_ID, status: 'reviewed', revision: 1 };
    },
    async promoteCandidate(_session, candidateId, input) {
      calls.push('promoteCandidate');
      assert.equal(candidateId, CANDIDATE_ID);
      assert.equal(input.expected_revision, 1);
      return { draft_id: DRAFT_ID, draft_key: 'draft:identity_proof', review_status: 'draft' };
    },
    async prepareSuspensionProbe() {
      calls.push('prepareSuspensionProbe');
      return { captured: true };
    },
    async suspend() {
      calls.push('suspend');
      suspended = true;
      return {
        principal: { id: AGENT_ID, status: 'suspended' },
        enforcement: { record: { status: 'succeeded' } },
      };
    },
    async state() {
      calls.push('state');
      return { principals: [{ id: AGENT_ID, status: suspended ? 'suspended' : 'active' }] };
    },
    async suspendedBroker() {
      calls.push('suspendedBroker');
      return { status: 401, code: 'authentication_failed' };
    },
  };
}

function runOptions(adapter) {
  return {
    mode: 'live',
    confirmMutations: 'RUN_ISOLATED_IDENTITY_PROOF',
    adapter,
    credentials: { architectToken: ARCHITECT_TOKEN, reviewerToken: REVIEWER_TOKEN },
    environment: 'deterministic-test',
    sourceCommit: 'f'.repeat(40),
    migrationSha256: 'a'.repeat(64),
    harnessSha256: 'b'.repeat(64),
    generatedAt: GENERATED_AT,
    runId: 'abcdefabcdef',
    clock: () => 1_000,
  };
}

test('live identity-plane proof covers every required allow, deny, governance, and suspension control', async () => {
  const adapter = passingAdapter();
  const output = await runIdentityPlaneProof(runOptions(adapter));

  assert.equal(output.report.overall_status, 'PASS');
  assert.equal(output.report.results.length, 22);
  assert.equal(output.report.results.every((item) => item.status === 'PASS'), true);
  assert.equal(output.publicProjection.overall_status, 'PASS');
  assert.equal(output.publicProjection.checks.length, 22);
  assert.equal(adapter.calls.filter((item) => item === 'publicSearch').length, 2);
  assert.ok(adapter.calls.indexOf('createCandidate') < adapter.calls.indexOf('publicSearch'));
  assert.ok(adapter.calls.indexOf('reviewCandidate') < adapter.calls.indexOf('promoteCandidate'));
  assert.ok(adapter.calls.indexOf('suspend') < adapter.calls.indexOf('suspendedBroker'));

  const publicJson = JSON.stringify(output.publicProjection);
  assert.doesNotMatch(publicJson, new RegExp(ARCHITECT_TOKEN));
  assert.doesNotMatch(publicJson, new RegExp(REVIEWER_TOKEN));
  assert.doesNotMatch(publicJson, /\/var\/|\/etc\/|\/home\/|\/run\//);
  assert.doesNotMatch(publicJson, /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  assert.doesNotMatch(publicJson, /oam-a-|postgres|tgops|Bearer|csrf|cookie/i);
});

test('an attempted provisioning failure is FAIL and dependent controls remain NOT_RUN', async () => {
  const adapter = passingAdapter({ failProvisioning: true });
  const output = await runIdentityPlaneProof(runOptions(adapter));
  const byId = Object.fromEntries(output.report.results.map((item) => [item.id, item]));

  assert.equal(output.report.overall_status, 'FAIL');
  assert.equal(byId['PRO-01'].status, 'FAIL');
  assert.equal(byId['OS-01'].status, 'NOT_RUN');
  assert.equal(byId['BRK-01'].status, 'NOT_RUN');
  assert.equal(byId['SUS-03'].status, 'NOT_RUN');
  assert.equal(byId['DB-02'].status, 'PASS');
  assert.equal(output.publicProjection.checks.find((item) => item.id === 'PRO-01').observed,
    'Required control did not produce passing evidence.');
  assert.doesNotMatch(JSON.stringify(output.publicProjection), /provisioner_unavailable/);
});

test('dry-run is non-mutating and fails closed with every required check NOT_RUN', async () => {
  const output = await runIdentityPlaneProof({
    mode: 'dry-run',
    adapter: new Proxy({}, { get: () => { throw new Error('adapter_must_not_be_used'); } }),
    environment: 'dry-run-test',
    sourceCommit: 'f'.repeat(40),
    migrationSha256: 'a'.repeat(64),
    harnessSha256: 'b'.repeat(64),
    generatedAt: GENERATED_AT,
    runId: 'abcdefabcdef',
  });

  assert.equal(output.report.overall_status, 'FAIL');
  assert.equal(output.report.results.length, 22);
  assert.equal(output.report.results.every((item) => item.status === 'NOT_RUN'), true);
  assert.equal(output.publicProjection.counts.not_run, 22);
});

test('a candidate visible before review fails closed and is never reviewed or promoted', async () => {
  const adapter = passingAdapter({ leakCandidate: true });
  const output = await runIdentityPlaneProof(runOptions(adapter));
  const byId = Object.fromEntries(output.report.results.map((item) => [item.id, item]));

  assert.equal(byId['QUA-02'].status, 'FAIL');
  assert.equal(byId['GOV-01'].status, 'NOT_RUN');
  assert.equal(byId['GOV-02'].status, 'NOT_RUN');
  assert.equal(adapter.calls.includes('reviewCandidate'), false);
  assert.equal(adapter.calls.includes('promoteCandidate'), false);
  assert.equal(adapter.calls.includes('suspend'), true);
});

test('live mode requires an explicit mutation confirmation phrase', async () => {
  await assert.rejects(
    runIdentityPlaneProof({
      ...runOptions(passingAdapter()),
      confirmMutations: '',
    }),
    /RUN_ISOLATED_IDENTITY_PROOF/,
  );
});

test('operator proof credentials require a private, non-symlinked exact-schema file', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'oam-proof-credentials-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'credentials.json');
  const content = JSON.stringify({
    schema_version: 1,
    architect_token: ARCHITECT_TOKEN,
    reviewer_token: REVIEWER_TOKEN,
  });
  await fs.writeFile(filePath, content, { mode: 0o600 });
  const loaded = await loadProofCredentials(filePath);
  assert.equal(loaded.architectToken, ARCHITECT_TOKEN);
  assert.equal(loaded.reviewerToken, REVIEWER_TOKEN);

  await fs.chmod(filePath, 0o644);
  await assert.rejects(loadProofCredentials(filePath), (error) => {
    assert.doesNotMatch(error.message, new RegExp(ARCHITECT_TOKEN));
    return error.code === 'proof_credentials_permissions_invalid';
  });

  await fs.chmod(filePath, 0o600);
  const linkPath = path.join(directory, 'credentials-link.json');
  await fs.symlink(filePath, linkPath);
  await assert.rejects(
    loadProofCredentials(linkPath),
    (error) => error.code === 'proof_credentials_symlink_denied',
  );
});
