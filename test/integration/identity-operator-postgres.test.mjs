import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { createIdentityDataPlane } from '../../app/lib/identity-data-plane.mjs';
import { createOperatorRepository } from '../../app/lib/operator-repository.mjs';

const connectionString = process.env.OAM_INTEGRATION_DATABASE_URL;

test('real PostgreSQL identity and quarantine lifecycle remains draft-only', {
  skip: !connectionString,
}, async (t) => {
  const pool = new pg.Pool({ connectionString, max: 2 });
  t.after(() => pool.end());
  const plane = createIdentityDataPlane({ pool });
  const repository = createOperatorRepository(pool);

  const seed = await pool.query(
    `SELECT architect.id AS architect_id, reviewer.id AS reviewer_id,
            ingestion.id AS ingestion_id, department.id AS department_id
     FROM identity.principals architect
     JOIN identity.principals reviewer ON reviewer.principal_key = 'human:capability_reviewer'
     JOIN identity.principals ingestion ON ingestion.principal_key = 'service:governed_ingestion'
     JOIN identity.departments department ON department.department_key = 'digital_delivery'
     WHERE architect.principal_key = 'human:ai_architect'`,
  );
  const ids = seed.rows[0];
  assert.ok(ids);

  const policyClient = await pool.connect();
  try {
    await policyClient.query('BEGIN');
    const draftTemplate = await policyClient.query(
      `INSERT INTO identity.policy_templates (
         template_key, version, title, description, created_by_principal_id
       ) VALUES ($1, 1, 'Integration draft', 'Trigger bypass regression fixture.', $2)
       RETURNING id`,
      [`integration_${crypto.randomUUID().replaceAll('-', '')}`, ids.architect_id],
    );
    const draftRule = await policyClient.query(
      `INSERT INTO identity.policy_template_rules (
         template_id, principal_kind, membership_role, permission_key, effect
       ) VALUES ($1, 'agent', 'member', 'memory.department.read', 'allow')
       RETURNING id`,
      [draftTemplate.rows[0].id],
    );
    const activeTemplate = await policyClient.query(
      `SELECT id FROM identity.policy_templates
       WHERE status = 'active' ORDER BY activated_at DESC LIMIT 1`,
    );
    await assert.rejects(
      policyClient.query(
        `UPDATE identity.policy_template_rules SET template_id = $2 WHERE id = $1`,
        [draftRule.rows[0].id, activeTemplate.rows[0].id],
      ),
      (error) => error.code === '55000',
    );
    await policyClient.query('ROLLBACK');
  } finally {
    policyClient.release();
  }

  const humanSuffix = crypto.randomUUID();
  const human = await plane.createHuman({
    principalKey: `human:integration_${humanSuffix}`,
    displayName: 'Integration Member',
    externalIssuer: 'urn:oam:integration',
    externalSubject: humanSuffix,
    departmentId: ids.department_id,
    membershipRole: 'member',
    requestedByPrincipalId: ids.architect_id,
  });
  assert.equal(human.policy_assignments.length, 1);

  const policy = await repository.activeAgentPolicy();
  const agentId = crypto.randomUUID();
  const agent = await plane.createLinkedAgentCredentialDraft({
    principalKey: `agent:${agentId}`,
    displayName: 'Integration Agent',
    ownerPrincipalId: ids.architect_id,
    requestedByPrincipalId: ids.architect_id,
    departmentId: ids.department_id,
    tokenSha256: crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('hex'),
    policyTemplateKey: policy.template_key,
    policyTemplateVersion: policy.version,
    policyHash: policy.policy_hash,
  });
  assert.equal(agent.policy_assignments.length, 1);
  assert.equal(agent.broker_credential.status, 'draft');
  assert.equal(agent.capability_grants[0].status, 'draft');

  const content = `# Integration handoff\nUse source evidence first.\nRun ${crypto.randomUUID()}\n`;
  const sha256 = crypto.createHash('sha256').update(content).digest('hex');
  const upload = await plane.createQuarantinedUpload({
    uploadKey: `upload:${crypto.randomUUID()}`,
    submittedByPrincipalId: ids.architect_id,
    departmentId: ids.department_id,
    originalName: 'integration-handoff.md',
    storageKey: `${sha256.slice(0, 2)}/${sha256}`,
    sha256,
    sizeBytes: Buffer.byteLength(content),
    declaredMime: 'text/markdown',
  });
  const ready = await repository.markUploadReady({
    uploadId: upload.id,
    departmentId: ids.department_id,
    sha256,
    scannerPrincipalId: ids.ingestion_id,
    validation: { validator: 'bounded_utf8_text_v1', passed: true },
    seal: {
      status: 'sealed',
      storage_key: `${sha256.slice(0, 2)}/${sha256}`,
      sha256,
      owner_enforced: true,
      read_only_mode: '0440',
    },
  });
  assert.equal(ready.scan_finding.verdict, 'clean');

  const memoryBefore = await pool.query(`SELECT count(*)::integer AS count FROM memory.capability_assets`);
  const candidate = await plane.createCandidate({
    candidateKey: `candidate:${crypto.randomUUID()}`,
    uploadId: upload.id,
    producedByPrincipalId: ids.ingestion_id,
    submittedByPrincipalId: ids.architect_id,
    departmentId: ids.department_id,
    sourceUploadSha256: sha256,
    candidateType: 'workflow',
    title: 'Integration website handoff',
    candidatePayload: { steps: ['inspect sources', 'produce handoff'] },
    evidence: [{
      evidence_kind: 'upload_text',
      evidence_ref: `sha256:${sha256}`,
      excerpt: 'Use source evidence first.',
    }],
  });
  await pool.query(`SELECT pg_sleep(0.01)`);
  await pool.query(
    `INSERT INTO quarantine.scan_findings (
       upload_id, scanner_principal_id, scanner_key, verdict,
       findings, content_sha256, scanned_at
     ) VALUES ($1, $2, 'bounded_utf8_text_v1', 'malicious',
               '{"integration_adverse_scan":true}'::jsonb, $3, clock_timestamp())`,
    [upload.id, ids.ingestion_id, sha256],
  );
  await assert.rejects(
    plane.reviewCandidate({
      candidateId: candidate.id,
      reviewerPrincipalId: ids.reviewer_id,
      departmentId: ids.department_id,
      action: 'approve_for_draft',
      reason: 'A later adverse scan must block this approval.',
      expectedRevision: candidate.revision,
    }),
    (error) => error.code === '23514',
  );
  await pool.query(`SELECT pg_sleep(0.01)`);
  await pool.query(
    `INSERT INTO quarantine.scan_findings (
       upload_id, scanner_principal_id, scanner_key, verdict,
       findings, content_sha256, scanned_at
     ) VALUES ($1, $2, 'bounded_utf8_text_v1', 'clean',
               '{"integration_rescan":true}'::jsonb, $3, clock_timestamp())`,
    [upload.id, ids.ingestion_id, sha256],
  );
  const reviewerDenialKey = `deny:${crypto.randomUUID()}`;
  await pool.query(
    `INSERT INTO identity.explicit_permission_denials (
       denial_key, principal_id, department_id, permission_key,
       recorded_by_principal_id, reason
     ) VALUES ($1, $2, $3, 'candidate.review', $4, 'Integration negative proof')
     ON CONFLICT (principal_id, department_id, permission_key) DO UPDATE
       SET denial_key = EXCLUDED.denial_key, status = 'active',
           valid_from = now(), valid_to = NULL, updated_at = now(),
           recorded_by_principal_id = EXCLUDED.recorded_by_principal_id,
           reason = EXCLUDED.reason`,
    [reviewerDenialKey, ids.reviewer_id, ids.department_id, ids.architect_id],
  );
  await assert.rejects(
    pool.query(
      `SELECT * FROM governance.record_candidate_review($1, $2, 'approve_for_draft', $3, $4)`,
      [candidate.id, ids.reviewer_id, 'This direct call must be denied.', candidate.revision],
    ),
    (error) => error.code === '42501',
  );
  await pool.query(
    `UPDATE identity.explicit_permission_denials
     SET status = 'retired', valid_to = now(), updated_at = now()
     WHERE denial_key = $1`,
    [reviewerDenialKey],
  );
  const reviewed = await plane.reviewCandidate({
    candidateId: candidate.id,
    reviewerPrincipalId: ids.reviewer_id,
    departmentId: ids.department_id,
    action: 'approve_for_draft',
    reason: 'Evidence and bounded content are sufficient for a draft.',
    expectedRevision: candidate.revision,
  });
  assert.equal(reviewed.status, 'reviewed');
  const runtimeClient = await pool.connect();
  try {
    await runtimeClient.query('BEGIN');
    await runtimeClient.query('SET LOCAL ROLE oam_operator_runtime');
    await assert.rejects(
      runtimeClient.query(
        `UPDATE quarantine.candidates
         SET candidate_payload = '{"tampered":true}'::jsonb
         WHERE id = $1`,
        [candidate.id],
      ),
      (error) => error.code === '42501',
    );
    await runtimeClient.query('ROLLBACK');
    await runtimeClient.query('BEGIN');
    await runtimeClient.query('SET LOCAL ROLE oam_operator_runtime');
    await assert.rejects(
      runtimeClient.query(
        `UPDATE quarantine.scan_findings
         SET findings = '{"tampered":true}'::jsonb
         WHERE upload_id = $1`,
        [upload.id],
      ),
      (error) => error.code === '42501',
    );
    await runtimeClient.query('ROLLBACK');
    await runtimeClient.query('BEGIN');
    await runtimeClient.query('SET LOCAL ROLE oam_operator_runtime');
    await assert.rejects(
      runtimeClient.query(
        `UPDATE quarantine.candidate_evidence
         SET excerpt = 'tampered'
         WHERE candidate_id = $1`,
        [candidate.id],
      ),
      (error) => error.code === '42501',
    );
    await runtimeClient.query('ROLLBACK');
  } finally {
    runtimeClient.release();
  }
  const architectDenialKey = `deny:${crypto.randomUUID()}`;
  await pool.query(
    `INSERT INTO identity.explicit_permission_denials (
       denial_key, principal_id, department_id, permission_key,
       recorded_by_principal_id, reason
     ) VALUES ($1, $2, $3, 'candidate.promote_as_draft', $2, 'Integration negative proof')
     ON CONFLICT (principal_id, department_id, permission_key) DO UPDATE
       SET denial_key = EXCLUDED.denial_key, status = 'active',
           valid_from = now(), valid_to = NULL, updated_at = now(),
           recorded_by_principal_id = EXCLUDED.recorded_by_principal_id,
           reason = EXCLUDED.reason`,
    [architectDenialKey, ids.architect_id, ids.department_id],
  );
  await assert.rejects(
    pool.query(
      `SELECT * FROM governance.promote_candidate_to_draft($1, $2, $3, $4)`,
      [candidate.id, ids.architect_id, reviewed.revision, crypto.randomUUID()],
    ),
    (error) => error.code === '42501',
  );
  await pool.query(
    `UPDATE identity.explicit_permission_denials
     SET status = 'retired', valid_to = now(), updated_at = now()
     WHERE denial_key = $1`,
    [architectDenialKey],
  );
  const promoted = await plane.promoteCandidateAsDraft({
    candidateId: candidate.id,
    architectPrincipalId: ids.architect_id,
    departmentId: ids.department_id,
    expectedRevision: reviewed.revision,
  });
  assert.equal(promoted.review_status, 'draft');

  const verification = await pool.query(
    `SELECT
       (SELECT count(*)::integer FROM memory.capability_assets) AS memory_count,
       (SELECT count(*)::integer FROM governance.promotion_drafts WHERE candidate_id = $1) AS draft_count,
       (SELECT status FROM quarantine.uploads WHERE id = $2) AS upload_status`,
    [candidate.id, upload.id],
  );
  assert.equal(verification.rows[0].memory_count, memoryBefore.rows[0].count);
  assert.equal(verification.rows[0].draft_count, 1);
  assert.equal(verification.rows[0].upload_status, 'promoted');
});
