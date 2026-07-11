import { createHash, randomUUID } from 'node:crypto';
import { stableJson } from './provisioner-contract.mjs';

const SHA256 = /^[a-f0-9]{64}$/;

export class OperatorRepositoryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'OperatorRepositoryError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new OperatorRepositoryError(code, message);
}

async function transaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function requirePool(pool) {
  if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') {
    throw new TypeError('A PostgreSQL pool is required.');
  }
}

function policyProjection(row) {
  const rules = Array.isArray(row.rules) ? row.rules : [];
  const policy = {
    template_key: row.template_key,
    version: Number(row.version),
    rules: rules.map((rule) => ({
      principal_kind: rule.principal_kind,
      membership_role: rule.membership_role || null,
      permission_key: rule.permission_key,
      effect: rule.effect,
      conditions: rule.conditions || {},
      sort_order: Number(rule.sort_order || 0),
    })),
  };
  return {
    id: row.id,
    ...policy,
    policy_hash: createHash('sha256').update(stableJson(policy)).digest('hex'),
  };
}

export function createOperatorRepository(pool) {
  requirePool(pool);

  return Object.freeze({
    async resolveOperator({
      principal_key: principalKey,
      department_key: departmentKey,
      token_sha256: tokenSha256,
    }) {
      const result = await pool.query(
        `/* operator:resolve-session */
         SELECT *
         FROM identity.resolve_operator_context($1, $2, $3)`,
        [principalKey, departmentKey, tokenSha256],
      );
      if (!result.rows[0]) fail('operator_not_authorized', 'Operator identity is not active or authorized.');
      return result.rows[0];
    },

    async resolveIngestionService({ principalKey, departmentId }) {
      const result = await pool.query(
        `/* operator:resolve-ingestion-service */
         SELECT principal.id AS principal_id, principal.principal_key
         FROM identity.principals principal
         JOIN identity.department_memberships membership
           ON membership.principal_id = principal.id
          AND membership.department_id = $2
          AND membership.status = 'active'
          AND membership.valid_from <= now()
          AND (membership.valid_to IS NULL OR membership.valid_to > now())
         JOIN identity.runtime_bindings binding
           ON binding.principal_id = principal.id
          AND binding.binding_kind = 'broker_client'
          AND binding.access_mode = 'brokered'
          AND binding.status = 'active'
          AND binding.valid_from <= now()
          AND (binding.valid_to IS NULL OR binding.valid_to > now())
         WHERE principal.principal_key = $1
           AND principal.principal_kind = 'service'
           AND principal.status = 'active'
           AND EXISTS (
             SELECT 1
             FROM identity.policy_assignments assignment
             JOIN identity.policy_templates template
               ON template.id = assignment.template_id AND template.status = 'active'
             JOIN identity.policy_template_rules rule
               ON rule.template_id = template.id
              AND rule.principal_kind = 'service'
              AND rule.permission_key = 'candidate.create'
              AND rule.effect = 'allow'
              AND rule.conditions = '{}'::jsonb
              AND (rule.membership_role IS NULL OR rule.membership_role = membership.membership_role)
             WHERE assignment.assignment_scope = 'principal'
               AND assignment.principal_id = principal.id
               AND assignment.department_id = membership.department_id
               AND assignment.status = 'active'
               AND assignment.valid_from <= now()
               AND (assignment.valid_to IS NULL OR assignment.valid_to > now())
           )
           AND NOT EXISTS (
             SELECT 1 FROM identity.explicit_permission_denials denial
             WHERE denial.principal_id = principal.id
               AND denial.department_id = membership.department_id
               AND denial.permission_key = 'candidate.create'
               AND denial.status = 'active'
               AND denial.valid_from <= now()
               AND (denial.valid_to IS NULL OR denial.valid_to > now())
           )
         LIMIT 1`,
        [principalKey, departmentId],
      );
      if (!result.rows[0]) {
        fail('ingestion_service_unavailable', 'The governed ingestion service is not active.');
      }
      return result.rows[0];
    },

    async activeAgentPolicy(templateKey = 'memory_reuse_agent') {
      const result = await pool.query(
        `/* operator:active-agent-policy */
         SELECT template.id, template.template_key, template.version,
                COALESCE(jsonb_agg(
                  jsonb_build_object(
                    'principal_kind', rule.principal_kind,
                    'membership_role', rule.membership_role,
                    'permission_key', rule.permission_key,
                    'effect', rule.effect,
                    'conditions', rule.conditions,
                    'sort_order', rule.sort_order
                  ) ORDER BY rule.sort_order, rule.id
                ) FILTER (WHERE rule.id IS NOT NULL), '[]'::jsonb) AS rules
         FROM identity.policy_templates template
         LEFT JOIN identity.policy_template_rules rule ON rule.template_id = template.id
         WHERE template.template_key = $1 AND template.status = 'active'
         GROUP BY template.id, template.template_key, template.version
         ORDER BY template.version DESC
         LIMIT 1`,
        [templateKey],
      );
      if (!result.rows[0]) fail('policy_not_active', 'No active memory-reuse agent policy is available.');
      const policy = policyProjection(result.rows[0]);
      if (!policy.rules.length) fail('policy_invalid', 'The active agent policy contains no rules.');
      return policy;
    },

    async listState(departmentId, limit = 200) {
      const params = [departmentId, limit];
      const [principals, departments, memberships, bindings, credentials, grants, pairs, jobs, proofs, uploads] = await Promise.all([
        pool.query(
          `SELECT DISTINCT principal.id, principal.principal_key, principal.principal_kind,
                  principal.display_name, principal.status, principal.created_at, principal.suspended_at
           FROM identity.principals principal
           JOIN identity.department_memberships membership ON membership.principal_id = principal.id
           WHERE membership.department_id = $1
           ORDER BY principal.principal_key LIMIT $2`,
          params,
        ),
        pool.query(
          `SELECT id, department_key, display_name, status
           FROM identity.departments WHERE id = $1 LIMIT $2`,
          params,
        ),
        pool.query(
          `SELECT principal_id, department_id, membership_role, status, valid_from, valid_to,
                  approved_by_principal_id, created_at, updated_at
           FROM identity.department_memberships WHERE department_id = $1
           ORDER BY principal_id, membership_role LIMIT $2`,
          params,
        ),
        pool.query(
          `SELECT binding.id, binding.principal_id, binding.binding_kind, binding.binding_value,
                  binding.access_mode, binding.status, binding.valid_from, binding.valid_to,
                  binding.metadata
           FROM identity.runtime_bindings binding
           JOIN identity.department_memberships membership ON membership.principal_id = binding.principal_id
           WHERE membership.department_id = $1
           ORDER BY binding.principal_id, binding.binding_kind LIMIT $2`,
          params,
        ),
        pool.query(
          `SELECT credential.id, credential.principal_id, credential.policy_template_id,
                  credential.status, credential.issued_at, credential.expires_at, credential.revoked_at
           FROM identity.broker_credentials credential
           JOIN identity.department_memberships membership ON membership.principal_id = credential.principal_id
           WHERE membership.department_id = $1
           ORDER BY credential.issued_at DESC LIMIT $2`,
          params,
        ),
        pool.query(
          `SELECT id, principal_id, department_id, policy_template_id, capability_task_key,
                  allowed_review_statuses, status, valid_from, valid_to, created_at, updated_at
           FROM governance.capability_grants WHERE department_id = $1
           ORDER BY principal_id, capability_task_key LIMIT $2`,
          params,
        ),
        pool.query(
          `SELECT pair.human_principal_id, pair.agent_principal_id, pair.department_id,
                  pair.status, pair.created_at, pair.updated_at,
                  human.display_name AS human_display_name,
                  human.principal_key AS human_principal_key,
                  agent.display_name AS agent_display_name,
                  agent.principal_key AS agent_principal_key
           FROM identity.employee_personal_agents pair
           JOIN identity.principals human ON human.id = pair.human_principal_id
           JOIN identity.principals agent ON agent.id = pair.agent_principal_id
           WHERE pair.department_id = $1
           ORDER BY human.display_name, human.principal_key
           LIMIT $2`,
          params,
        ),
        pool.query(
          `SELECT job.id, job.idempotency_key, job.principal_id, job.department_id,
                  job.job_type, job.status,
                  job.plan, job.plan_hash, job.requested_at, job.confirmed_at,
                  job.started_at, job.finished_at, job.error_code, job.revision
           FROM identity.provisioning_jobs job
           WHERE job.department_id = $1
           ORDER BY job.requested_at DESC LIMIT $2`,
          params,
        ),
        pool.query(
          `SELECT proof.id, proof.proof_key, proof.target_kind, proof.target_key,
                  proof.status, proof.evidence, proof.department_id,
                  proof.executed_at, proof.recorded_at
           FROM identity.proof_runs proof
           WHERE proof.department_id = $1
           ORDER BY proof.executed_at DESC LIMIT $2`,
          params,
        ),
        pool.query(
          `/* operator:list-uploads */
           SELECT upload.id, upload.upload_key, upload.submitted_by_principal_id,
                  upload.original_name, upload.storage_key, upload.sha256,
                  upload.size_bytes, upload.declared_mime, upload.detected_mime,
                  upload.status, upload.created_at, upload.updated_at,
                  submitter.principal_key AS submitted_by_principal_key,
                  latest_scan.verdict AS latest_scan_verdict,
                  latest_scan.content_sha256 AS latest_scan_sha256,
                  latest_scan.scanned_at AS latest_scan_at,
                  (SELECT count(*)::integer FROM quarantine.candidates candidate
                   WHERE candidate.upload_id = upload.id) AS candidate_count
           FROM quarantine.uploads upload
           JOIN identity.principals submitter ON submitter.id = upload.submitted_by_principal_id
           LEFT JOIN LATERAL (
             SELECT finding.verdict, finding.content_sha256, finding.scanned_at
             FROM quarantine.scan_findings finding
             WHERE finding.upload_id = upload.id
             ORDER BY finding.scanned_at DESC, finding.id DESC
             LIMIT 1
           ) latest_scan ON true
           WHERE upload.owning_department_id = $1
           ORDER BY upload.created_at DESC, upload.id
           LIMIT $2`,
          params,
        ),
      ]);
      return {
        principals: principals.rows,
        departments: departments.rows,
        memberships: memberships.rows,
        runtime_bindings: bindings.rows,
        broker_credentials: credentials.rows,
        capability_grants: grants.rows,
        employee_personal_agents: pairs.rows,
        provisioning_jobs: jobs.rows,
        proof_runs: proofs.rows,
        uploads: uploads.rows,
      };
    },

    async personalPairForPrincipal({ principalId, departmentId }) {
      const result = await pool.query(
        `SELECT pair.human_principal_id, pair.agent_principal_id, pair.department_id,
                pair.status, human.status AS human_status, agent.status AS agent_status,
                agent.principal_key AS agent_principal_key,
                agent.suspended_at AS agent_suspended_at
         FROM identity.employee_personal_agents pair
         JOIN identity.principals human ON human.id = pair.human_principal_id
         JOIN identity.principals agent ON agent.id = pair.agent_principal_id
         WHERE pair.department_id = $2
           AND $1::uuid IN (pair.human_principal_id, pair.agent_principal_id)
         LIMIT 1`,
        [principalId, departmentId],
      );
      return result.rows[0] || null;
    },

    async readyUpload({ uploadId, departmentId }) {
      const result = await pool.query(
        `/* operator:ready-upload */
         SELECT upload.id, upload.upload_key, upload.submitted_by_principal_id,
                upload.owning_department_id, upload.original_name, upload.storage_key,
                upload.sha256, upload.size_bytes, upload.declared_mime,
                upload.detected_mime, upload.status, upload.metadata,
                latest_scan.verdict AS latest_scan_verdict,
                latest_scan.content_sha256 AS latest_scan_sha256,
                latest_scan.scanned_at AS latest_scan_at
         FROM quarantine.uploads upload
         LEFT JOIN LATERAL (
           SELECT finding.verdict, finding.content_sha256, finding.scanned_at
           FROM quarantine.scan_findings finding
           WHERE finding.upload_id = upload.id
           ORDER BY finding.scanned_at DESC, finding.id DESC
           LIMIT 1
         ) latest_scan ON true
         WHERE upload.id = $1 AND upload.owning_department_id = $2
         LIMIT 1`,
        [uploadId, departmentId],
      );
      const upload = result.rows[0];
      if (!upload) fail('upload_not_found', 'Upload was not found in this department.');
      if (!['ready_for_review', 'approved_for_promotion'].includes(upload.status)) {
        fail('upload_not_ready', 'Upload is not ready for candidate extraction.');
      }
      if (upload.latest_scan_verdict !== 'clean' || upload.latest_scan_sha256 !== upload.sha256) {
        fail('upload_scan_not_clean', 'The latest upload scan is not a clean hash match.');
      }
      return upload;
    },

    async listCandidates(departmentId, limit = 100) {
      const result = await pool.query(
        `/* operator:list-candidates */
         SELECT candidate.id, candidate.candidate_key, candidate.candidate_type,
                candidate.title, candidate.candidate_payload, candidate.content_hash,
                candidate.status, candidate.revision, candidate.created_at, candidate.updated_at,
                upload.id AS upload_id, upload.upload_key, upload.original_name,
                upload.sha256 AS upload_sha256, upload.declared_mime,
                producer.principal_key AS produced_by_principal_key,
                submitter.principal_key AS submitted_by_principal_key,
                candidate.submitted_by_principal_id, candidate.source_upload_sha256,
                candidate.approved_content_hash,
                COALESCE((
                  SELECT jsonb_agg(jsonb_build_object(
                    'id', review.id,
                    'reviewer_principal_id', review.reviewer_principal_id,
                    'action', review.action,
                    'reason', review.reason,
                    'candidate_revision', review.candidate_revision,
                    'candidate_content_hash', review.candidate_content_hash,
                    'created_at', review.created_at
                  ) ORDER BY review.created_at, review.id)
                  FROM governance.candidate_reviews review WHERE review.candidate_id = candidate.id
                ), '[]'::jsonb) AS reviews,
                COALESCE((
                  SELECT jsonb_agg(jsonb_build_object(
                    'evidence_kind', evidence.evidence_kind,
                    'evidence_ref', evidence.evidence_ref,
                    'excerpt', evidence.excerpt
                  ) ORDER BY evidence.evidence_kind, evidence.evidence_ref)
                  FROM quarantine.candidate_evidence evidence WHERE evidence.candidate_id = candidate.id
                ), '[]'::jsonb) AS evidence,
                draft.id AS promotion_draft_id, draft.draft_key, draft.review_status AS draft_review_status
         FROM quarantine.candidates candidate
         JOIN quarantine.uploads upload ON upload.id = candidate.upload_id
         JOIN identity.principals producer ON producer.id = candidate.produced_by_principal_id
         JOIN identity.principals submitter ON submitter.id = candidate.submitted_by_principal_id
         LEFT JOIN governance.promotion_drafts draft ON draft.candidate_id = candidate.id
         WHERE candidate.owning_department_id = $1
         ORDER BY candidate.created_at DESC, candidate.id
         LIMIT $2`,
        [departmentId, limit],
      );
      return result.rows;
    },

    async markUploadReady({
      uploadId,
      departmentId,
      sha256,
      scannerPrincipalId,
      validation,
      seal,
    }) {
      return transaction(pool, async (client) => {
        const locked = await client.query(
          `SELECT id, declared_mime FROM quarantine.uploads
           WHERE id = $1 AND owning_department_id = $2 AND sha256 = $3 AND status = 'received'
           FOR UPDATE`,
          [uploadId, departmentId, sha256],
        );
        if (!locked.rows[0]) fail('upload_conflict', 'Upload could not enter review.');
        const findingResult = await client.query(
          `INSERT INTO quarantine.scan_findings (
             upload_id, scanner_principal_id, scanner_key, verdict,
             findings, content_sha256, scanned_at
           ) VALUES ($1, $2, 'bounded_utf8_text_v1', 'clean', $3::jsonb, $4, now())
           RETURNING id, scanner_principal_id, scanner_key, verdict,
                     content_sha256, scanned_at`,
          [uploadId, scannerPrincipalId, JSON.stringify(validation), sha256],
        );
        const result = await client.query(
          `UPDATE quarantine.uploads
           SET status = 'ready_for_review', detected_mime = declared_mime,
               metadata = metadata || jsonb_build_object(
                 'text_validation', $4::jsonb,
                 'quarantine_seal', $5::jsonb
               ),
               updated_at = now()
           WHERE id = $1 AND owning_department_id = $2 AND sha256 = $3 AND status = 'received'
           RETURNING id, upload_key, status, sha256, size_bytes,
                     declared_mime, detected_mime, created_at`,
          [uploadId, departmentId, sha256, JSON.stringify(validation), JSON.stringify(seal)],
        );
        if (!result.rows[0]) fail('upload_conflict', 'Upload could not enter review.');
        return {
          ...result.rows[0],
          scan_finding: findingResult.rows[0],
          seal: {
            status: seal.status,
            sha256: seal.sha256,
            size_bytes: seal.size_bytes,
            owner_enforced: seal.owner_enforced,
            read_only_mode: seal.read_only_mode,
            sealed_at: seal.sealed_at,
          },
        };
      });
    },

    async markUploadQuarantined({ uploadId, departmentId, reason }) {
      const result = await pool.query(
        `UPDATE quarantine.uploads
         SET status = 'quarantined',
             metadata = metadata || jsonb_build_object('quarantine_reason', $3::text),
             updated_at = now()
         WHERE id = $1 AND owning_department_id = $2 AND status = 'received'
         RETURNING id, upload_key, status, sha256, updated_at`,
        [uploadId, departmentId, reason],
      );
      return result.rows[0] || null;
    },

    async queueProvisioningWithCredential({
      principalId,
      actorPrincipalId,
      departmentId,
      policy,
      tokenSha256,
      operation,
      jobType,
      plan,
      idempotencyKey,
    }) {
      if (!SHA256.test(tokenSha256)) fail('invalid_token_hash', 'Credential hash is invalid.');
      if (!['provision_agent', 'resume_agent'].includes(operation)) {
        fail('invalid_operation', 'Credential staging operation is invalid.');
      }
      if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
        fail('invalid_plan', 'Provisioning plan is invalid.');
      }
      return transaction(pool, async (client) => {
        const principalStatus = operation === 'resume_agent' ? 'suspended' : 'draft';
        const membershipStatus = operation === 'resume_agent' ? 'suspended' : 'active';
        const stagedStatus = operation === 'resume_agent' ? 'suspended' : 'draft';
        const principalResult = await client.query(
          `SELECT agent.id, agent.principal_key, agent.status,
                  EXISTS (
                    SELECT 1
                    FROM identity.employee_personal_agents personal_pair
                    WHERE personal_pair.agent_principal_id = agent.id
                      AND personal_pair.human_principal_id = link.source_principal_id
                      AND personal_pair.department_id = $3
                  ) AS is_personal_agent
           FROM identity.principals agent
           JOIN identity.department_memberships target_membership
             ON target_membership.principal_id = agent.id
            AND target_membership.department_id = $3
            AND target_membership.status = $6
           JOIN identity.principal_links link
             ON link.target_principal_id = agent.id
            AND link.link_kind = 'linked_agent'
            AND link.status = 'active'
           JOIN identity.policy_templates template
             ON template.id = $4 AND template.status = 'active'
           WHERE agent.id = $1
             AND agent.principal_kind = 'agent'
             AND agent.status = $5
             AND NOT EXISTS (
               SELECT 1
               FROM identity.employee_personal_agents personal_pair
               WHERE personal_pair.agent_principal_id = agent.id
                 AND personal_pair.department_id = $3
                 AND personal_pair.human_principal_id <> link.source_principal_id
             )
             AND (
               link.source_principal_id = $2
               OR EXISTS (
                 SELECT 1
                 FROM identity.department_memberships actor_membership
                 WHERE actor_membership.principal_id = $2
                   AND actor_membership.department_id = $3
                   AND actor_membership.membership_role = 'architect'
                   AND actor_membership.status = 'active'
                   AND actor_membership.valid_from <= now()
                   AND (actor_membership.valid_to IS NULL OR actor_membership.valid_to > now())
               )
             )
           FOR UPDATE OF agent, target_membership, link`,
          [
            principalId,
            actorPrincipalId,
            departmentId,
            policy.id,
            principalStatus,
            membershipStatus,
          ],
        );
        const principal = principalResult.rows[0];
        if (!principal) {
          fail('principal_not_provisionable', 'Agent is not provisionable in this scope.');
        }
        await client.query(
          `UPDATE identity.broker_credentials
           SET status = 'revoked', revoked_at = now()
           WHERE principal_id = $1 AND status IN ('draft', 'suspended')`,
          [principalId],
        );
        const credentialResult = await client.query(
          `INSERT INTO identity.broker_credentials (
             principal_id, token_sha256, policy_template_id, status,
             issued_by_principal_id, metadata
           ) VALUES ($1, $2, $3, $6, $4, $5::jsonb)
           RETURNING id, principal_id, policy_template_id, status, issued_at`,
          [
            principalId,
            tokenSha256,
            policy.id,
            actorPrincipalId,
            JSON.stringify({ profile_key: 'memory-reuse-agent-v1', policy_hash: policy.policy_hash }),
            stagedStatus,
          ],
        );
        const credential = credentialResult.rows[0];
        const bindingResult = await client.query(
          `UPDATE identity.runtime_bindings
           SET status = $4,
               valid_from = CASE WHEN $4 = 'draft' THEN now() ELSE valid_from END,
               valid_to = CASE WHEN $4 = 'draft' THEN NULL ELSE valid_to END,
               metadata = jsonb_build_object(
                 'credential_id', $2::uuid,
                 'policy_hash', $3::text,
                 'profile_key', 'memory-reuse-agent-v1'
               ), updated_at = now()
           WHERE principal_id = $1 AND binding_kind = 'broker_client'
             AND status IN ('draft', 'suspended')
           RETURNING id`,
          [principalId, credential.id, policy.policy_hash, stagedStatus],
        );
        if (!bindingResult.rows[0]) {
          fail('principal_not_provisionable', 'Agent broker binding is unavailable.');
        }
        const capabilityTaskKeys = principal.is_personal_agent
          ? ['website_delivery_handoff', 'personal_context_retrieval']
          : ['website_delivery_handoff'];
        const grantResult = await client.query(
          `UPDATE governance.capability_grants
           SET policy_template_id = $2,
               status = $4,
               valid_from = CASE WHEN $4 = 'draft' THEN now() ELSE valid_from END,
               valid_to = CASE WHEN $4 = 'draft' THEN NULL ELSE valid_to END,
               updated_at = now()
           WHERE principal_id = $1 AND department_id = $3
             AND capability_task_key = ANY($5::text[])
             AND status IN ('draft', 'suspended')
           RETURNING id, capability_task_key`,
          [principalId, policy.id, departmentId, stagedStatus, capabilityTaskKeys],
        );
        const stagedCapabilityKeys = new Set(
          grantResult.rows.map((row) => row.capability_task_key),
        );
        if (capabilityTaskKeys.some((key) => !stagedCapabilityKeys.has(key))) {
          fail('principal_not_provisionable', 'Agent capability grant is unavailable.');
        }
        await client.query(
          `UPDATE identity.policy_assignments
           SET status = 'retired', valid_to = coalesce(valid_to, now()), updated_at = now()
           WHERE principal_id = $1 AND department_id = $2
             AND template_id <> $3 AND status IN ('active', 'suspended')`,
          [principalId, departmentId, policy.id],
        );
        await client.query(
          `INSERT INTO identity.policy_assignments (
             assignment_key, assignment_scope, principal_id, department_id, template_id,
             status, assigned_by_principal_id, reason
           ) VALUES ($1, 'principal', $2, $3, $4, $7, $5, $6)
           ON CONFLICT (assignment_scope, principal_id, department_id, template_id) DO UPDATE
             SET status = EXCLUDED.status,
                 valid_from = CASE WHEN EXCLUDED.status = 'active' THEN now()
                                   ELSE policy_assignments.valid_from END,
                 valid_to = CASE WHEN EXCLUDED.status = 'active' THEN NULL
                                 ELSE policy_assignments.valid_to END,
                 updated_at = now()
           RETURNING id`,
          [
            `assignment:${randomUUID()}`,
            principalId,
            departmentId,
            policy.id,
            actorPrincipalId,
            'Credential rotation retained the active memory-reuse policy.',
            operation === 'resume_agent' ? 'suspended' : 'active',
          ],
        );
        const jobResult = await client.query(
          `INSERT INTO identity.provisioning_jobs (
             idempotency_key, principal_id, department_id, job_type,
             requested_by_principal_id, status, plan
           ) VALUES ($1, $2, $3, $4, $5, 'queued', $6::jsonb)
           ON CONFLICT (idempotency_key) DO UPDATE
             SET idempotency_key = EXCLUDED.idempotency_key
             WHERE provisioning_jobs.principal_id = EXCLUDED.principal_id
               AND provisioning_jobs.department_id = EXCLUDED.department_id
               AND provisioning_jobs.job_type = EXCLUDED.job_type
               AND provisioning_jobs.requested_by_principal_id = EXCLUDED.requested_by_principal_id
               AND provisioning_jobs.plan = EXCLUDED.plan
           RETURNING id, idempotency_key, principal_id, department_id, job_type,
                     status, plan, plan_hash, revision, requested_at`,
          [
            idempotencyKey,
            principalId,
            departmentId,
            jobType,
            actorPrincipalId,
            JSON.stringify(plan),
          ],
        );
        const job = jobResult.rows[0];
        if (!job) {
          fail('provisioning_conflict', 'Provisioning idempotency key is bound to another request.');
        }
        await client.query(
          `INSERT INTO identity.provisioning_events (
             job_id, event_type, actor_principal_id, to_status, payload
           ) VALUES ($1, 'queued', $2, 'queued', '{}'::jsonb)`,
          [job.id, actorPrincipalId],
        );
        return job;
      });
    },

    async provisioningContext({ principalId, actorPrincipalId, departmentId }) {
      const result = await pool.query(
        `/* operator:provisioning-context */
         SELECT agent.id AS principal_id, agent.principal_key, agent.status,
                link.source_principal_id AS owner_principal_id,
                personal_pair.agent_principal_id IS NOT NULL AS is_personal_agent,
                credential.id AS credential_id,
                credential.status AS credential_status,
                credential.metadata->>'policy_hash' AS policy_hash,
                template.id AS policy_template_id,
                template.template_key, template.version,
                capability_grant.id AS capability_grant_id,
                capability_grant.status AS capability_grant_status,
                personal_context_grant.status AS personal_context_grant_status
         FROM identity.principals agent
         JOIN identity.principal_links link
           ON link.target_principal_id = agent.id
          AND link.link_kind = 'linked_agent' AND link.status = 'active'
         JOIN identity.department_memberships membership
           ON membership.principal_id = agent.id AND membership.department_id = $3
         JOIN identity.broker_credentials credential
           ON credential.principal_id = agent.id AND credential.status IN ('draft', 'active', 'suspended')
         JOIN identity.policy_templates template
           ON template.id = credential.policy_template_id AND template.status = 'active'
         JOIN governance.capability_grants capability_grant
           ON capability_grant.principal_id = agent.id
          AND capability_grant.department_id = $3
          AND capability_grant.policy_template_id = template.id
          AND capability_grant.capability_task_key = 'website_delivery_handoff'
         LEFT JOIN identity.employee_personal_agents personal_pair
           ON personal_pair.agent_principal_id = agent.id
          AND personal_pair.department_id = $3
         LEFT JOIN governance.capability_grants personal_context_grant
           ON personal_context_grant.principal_id = agent.id
          AND personal_context_grant.department_id = $3
          AND personal_context_grant.policy_template_id = template.id
          AND personal_context_grant.capability_task_key = 'personal_context_retrieval'
         WHERE agent.id = $1 AND agent.principal_kind = 'agent'
           AND (
             personal_pair.agent_principal_id IS NULL
             OR personal_pair.human_principal_id = link.source_principal_id
           )
           AND (
             personal_pair.agent_principal_id IS NULL
             OR (
               personal_context_grant.id IS NOT NULL
               AND personal_context_grant.status = capability_grant.status
             )
           )
           AND (link.source_principal_id = $2 OR EXISTS (
             SELECT 1 FROM identity.department_memberships actor_membership
             WHERE actor_membership.principal_id = $2
               AND actor_membership.department_id = $3
               AND actor_membership.membership_role = 'architect'
               AND actor_membership.status = 'active'
               AND actor_membership.valid_from <= now()
               AND (actor_membership.valid_to IS NULL OR actor_membership.valid_to > now())
           ))
         ORDER BY credential.issued_at DESC LIMIT 1`,
        [principalId, actorPrincipalId, departmentId],
      );
      if (!result.rows[0]) fail('principal_not_provisionable', 'Agent is not provisionable in this scope.');
      return result.rows[0];
    },

    async stageProvisioning({ jobId, principalId, departmentId, planId }) {
      return transaction(pool, async (client) => {
        const result = await client.query(
          `SELECT job.id, job.status, job.plan,
                  credential.policy_template_id,
                  credential.id AS credential_id,
                  capability_grant.id AS capability_grant_id
           FROM identity.provisioning_jobs job
           JOIN identity.principals principal
             ON principal.id = job.principal_id
           JOIN identity.department_memberships membership
             ON membership.principal_id = job.principal_id
            AND membership.department_id = job.department_id
           JOIN identity.runtime_bindings binding
             ON binding.principal_id = job.principal_id AND binding.binding_kind = 'broker_client'
           JOIN identity.broker_credentials credential
             ON credential.id = (binding.metadata->>'credential_id')::uuid
           JOIN governance.capability_grants capability_grant
             ON capability_grant.principal_id = job.principal_id
            AND capability_grant.department_id = job.department_id
            AND capability_grant.policy_template_id = credential.policy_template_id
            AND capability_grant.capability_task_key = 'website_delivery_handoff'
           WHERE job.id = $1 AND job.principal_id = $2 AND job.department_id = $4
             AND job.status = 'confirmed' AND job.plan->>'plan_id' = $3
             AND (
               (
                 job.plan->>'operation' = 'provision_agent'
                 AND principal.status = 'draft'
                 AND membership.status = 'active'
                 AND binding.status = 'draft'
                 AND credential.status = 'draft'
                 AND capability_grant.status = 'draft'
               )
               OR (
                 job.plan->>'operation' = 'resume_agent'
                 AND principal.status = 'suspended'
                 AND membership.status = 'suspended'
                 AND binding.status = 'suspended'
                 AND credential.status = 'suspended'
                 AND capability_grant.status = 'suspended'
               )
             )
           FOR UPDATE OF job, credential, capability_grant`,
          [jobId, principalId, planId, departmentId],
        );
        const staged = result.rows[0];
        if (!staged) fail('provisioning_conflict', 'Confirmed provisioning state is not available.');
        const pairResult = await client.query(
          `SELECT human_principal_id, agent_principal_id
           FROM identity.employee_personal_agents
           WHERE agent_principal_id = $1 AND department_id = $2`,
          [principalId, departmentId],
        );
        const personalPair = pairResult.rows[0] || null;
        let personalContextGrantId = null;
        if (personalPair) {
          const expectedGrantStatus = staged.plan?.operation === 'resume_agent'
            ? 'suspended'
            : 'draft';
          const personalGrantResult = await client.query(
            `SELECT id
             FROM governance.capability_grants
             WHERE principal_id = $1 AND department_id = $2
               AND policy_template_id = $3
               AND capability_task_key = 'personal_context_retrieval'
               AND status = $4
             FOR UPDATE`,
            [principalId, departmentId, staged.policy_template_id, expectedGrantStatus],
          );
          personalContextGrantId = personalGrantResult.rows[0]?.id || null;
          if (!personalContextGrantId) {
            fail('provisioning_conflict', 'Personal context grant is not staged.');
          }
        }
        await client.query(
          `UPDATE identity.principals
           SET status = 'active', suspended_at = NULL, updated_at = now()
           WHERE id = $1 AND status IN ('draft', 'suspended', 'active')`,
          [principalId],
        );
        await client.query(
          `UPDATE identity.policy_assignments
           SET status = 'active', valid_from = now(), valid_to = NULL, updated_at = now()
           WHERE principal_id = $1 AND department_id = $2
             AND status IN ('active', 'suspended')`,
          [principalId, departmentId],
        );
        await client.query(
          `UPDATE identity.department_memberships
           SET status = 'active', valid_from = now(), valid_to = NULL, updated_at = now()
           WHERE principal_id = $1 AND department_id = $2`,
          [principalId, departmentId],
        );
        await client.query(
          `UPDATE identity.broker_credentials
           SET status = 'active',
               metadata = (metadata - 'activation_job_id')
                 || jsonb_build_object('provisioning_job_id', $2::text)
           WHERE id = $1 AND status IN ('draft', 'suspended')`,
          [staged.credential_id, jobId],
        );
        await client.query(
          `UPDATE identity.runtime_bindings
           SET status = 'active', valid_from = now(), valid_to = NULL, updated_at = now()
           WHERE principal_id = $1 AND binding_kind = 'broker_client'`,
          [principalId],
        );
        const grantIds = [staged.capability_grant_id];
        if (personalContextGrantId) grantIds.push(personalContextGrantId);
        const activatedGrants = await client.query(
          `UPDATE governance.capability_grants
           SET status = 'active', valid_from = now(), valid_to = NULL, updated_at = now()
           WHERE id = ANY($1::uuid[]) AND status IN ('draft', 'suspended')
           RETURNING id`,
          [grantIds],
        );
        if (activatedGrants.rows.length !== grantIds.length) {
          fail('provisioning_conflict', 'The staged capability grants could not be activated.');
        }
        await client.query(
          `UPDATE identity.provisioning_jobs
           SET status = 'running', started_at = now(), revision = revision + 1
           WHERE id = $1 AND department_id = $2`,
          [jobId, departmentId],
        );
        await client.query(
          `INSERT INTO identity.provisioning_events (
             job_id, event_type, from_status, to_status, payload
           ) VALUES ($1, 'started', 'confirmed', 'running', $2::jsonb)`,
          [jobId, JSON.stringify({ staged_for_broker_proof: true })],
        );
        return staged;
      });
    },

    async stageVerification({ jobId, principalId, departmentId, planId }) {
      return transaction(pool, async (client) => {
        const result = await client.query(
          `SELECT job.id
           FROM identity.provisioning_jobs job
           JOIN identity.principals principal
             ON principal.id = job.principal_id AND principal.status = 'active'
           JOIN identity.department_memberships membership
             ON membership.principal_id = principal.id AND membership.status = 'active'
            AND membership.department_id = job.department_id
            AND membership.valid_from <= now()
            AND (membership.valid_to IS NULL OR membership.valid_to > now())
           JOIN identity.runtime_bindings binding
             ON binding.principal_id = principal.id
            AND binding.binding_kind = 'broker_client' AND binding.status = 'active'
           JOIN identity.broker_credentials credential
             ON credential.id = (binding.metadata->>'credential_id')::uuid
            AND credential.status = 'active'
           JOIN governance.capability_grants capability_grant
             ON capability_grant.principal_id = principal.id
            AND capability_grant.department_id = membership.department_id
            AND capability_grant.status = 'active'
           WHERE job.id = $1 AND job.principal_id = $2 AND job.department_id = $4
             AND job.job_type = 'runtime_binding'
             AND job.status = 'confirmed'
             AND job.plan->>'plan_id' = $3
             AND job.plan->>'operation' = 'verify_agent'
           FOR UPDATE OF job`,
          [jobId, principalId, planId, departmentId],
        );
        if (!result.rows[0]) fail('verification_conflict', 'Only an active agent can be verified.');
        const jobResult = await client.query(
          `UPDATE identity.provisioning_jobs
           SET status = 'running', started_at = now(), revision = revision + 1
           WHERE id = $1 AND department_id = $2 AND status = 'confirmed'
           RETURNING id, status, revision`,
          [jobId, departmentId],
        );
        await client.query(
          `INSERT INTO identity.provisioning_events (
             job_id, event_type, from_status, to_status, payload
           ) VALUES ($1, 'started', 'confirmed', 'running', '{"read_only_verification":true}'::jsonb)`,
          [jobId],
        );
        return jobResult.rows[0];
      });
    },

    async completeProvisioning({
      jobId, principalId, departmentId, binding, proof, actorPrincipalId,
    }) {
      return transaction(pool, async (client) => {
        const lockedJob = await client.query(
          `SELECT id FROM identity.provisioning_jobs
           WHERE id = $1 AND principal_id = $2 AND department_id = $3
             AND status = 'running'
           FOR UPDATE`,
          [jobId, principalId, departmentId],
        );
        if (!lockedJob.rows[0]) {
          fail('provisioning_conflict', 'Running provisioning job is unavailable.');
        }
        await client.query(
          `UPDATE identity.broker_credentials
           SET metadata = (metadata - 'provisioning_job_id')
             || jsonb_build_object('activation_job_id', $2::text)
           WHERE principal_id = $1 AND status = 'active'
             AND metadata->>'provisioning_job_id' = $2::text`,
          [principalId, jobId],
        );
        for (const [kind, value, accessMode] of [
          ['linux_user', binding.osUser, 'direct'],
          ['systemd_unit', binding.unitName, 'direct'],
          ['workspace', binding.stateDirectory, 'direct'],
        ]) {
          await client.query(
            `INSERT INTO identity.runtime_bindings (
               principal_id, binding_kind, binding_value, access_mode, status, metadata
             ) VALUES ($1, $2, $3, $4, 'active', '{}'::jsonb)
             ON CONFLICT DO NOTHING`,
            [principalId, kind, value, accessMode],
          );
        }
        const jobResult = await client.query(
          `UPDATE identity.provisioning_jobs
           SET status = 'succeeded', finished_at = now(), error_code = NULL,
               revision = revision + 1
           WHERE id = $1 AND department_id = $2 AND status = 'running'
           RETURNING id, principal_id, job_type, status, plan_hash, revision,
                     requested_at, confirmed_at, started_at, finished_at`,
          [jobId, departmentId],
        );
        if (!jobResult.rows[0]) fail('provisioning_conflict', 'Running provisioning job is unavailable.');
        const personalPairResult = await client.query(
          `SELECT human_principal_id, agent_principal_id, department_id,
                  status, activated_at
           FROM identity.employee_personal_agents
           WHERE agent_principal_id = $1 AND department_id = $2`,
          [principalId, departmentId],
        );
        const personalPair = personalPairResult.rows[0] || null;
        let personalAgentPair = personalPair;
        if (personalPair && ['draft', 'suspended'].includes(personalPair.status)) {
          const activationResult = await client.query(
            `SELECT identity.activate_employee_personal_agent($1) AS pair`,
            [principalId],
          );
          personalAgentPair = activationResult.rows[0]?.pair || null;
          if (!personalAgentPair || personalAgentPair.status !== 'active') {
            fail('personal_agent_activation_failed', 'Personal agent activation did not return an active pair.');
          }
        } else if (personalPair && personalPair.status !== 'active') {
          fail('personal_agent_activation_failed', 'Personal agent pair is not activatable.');
        }
        await client.query(
          `INSERT INTO identity.provisioning_events (
             job_id, event_type, actor_principal_id, from_status, to_status, payload
           ) VALUES ($1, 'succeeded', $2, 'running', 'succeeded', $3::jsonb)`,
          [jobId, actorPrincipalId, JSON.stringify({ proof_passed: Boolean(proof?.passed) })],
        );
        if (proof && typeof proof === 'object') {
          await client.query(
            `INSERT INTO identity.proof_runs (
               proof_key, target_kind, target_key, status, commands,
               evidence, recorded_by_principal_id, department_id, executed_at
             ) VALUES ($1, 'principal', $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8::timestamptz)`,
            [
              `agent.activation:${jobId}`,
              principalId,
              proof.passed ? 'passed' : 'failed',
              JSON.stringify((proof.checks || []).length
                ? proof.checks.map((check) => ({ probe: check.label, expected: check.expected }))
                : [{ probe: 'agent_runtime_proof', expected: 'passed' }]),
              JSON.stringify(proof),
              actorPrincipalId,
              departmentId,
              proof.checked_at || new Date().toISOString(),
            ],
          );
        }
        return {
          ...jobResult.rows[0],
          personal_agent_pair: personalAgentPair,
        };
      });
    },

    async failProvisioning({ jobId, principalId, departmentId, actorPrincipalId, errorCode }) {
      return transaction(pool, async (client) => {
        const lockedJob = await client.query(
          `SELECT id FROM identity.provisioning_jobs
           WHERE id = $1 AND principal_id = $2 AND department_id = $3
             AND status IN ('confirmed', 'running')
           FOR UPDATE`,
          [jobId, principalId, departmentId],
        );
        if (!lockedJob.rows[0]) {
          fail('provisioning_conflict', 'Provisioning job is unavailable for failure handling.');
        }
        await client.query(
          `UPDATE identity.principals
           SET status = 'suspended', suspended_at = now(), updated_at = now()
           WHERE id = $1 AND status <> 'retired'`,
          [principalId],
        );
        await client.query(
          `UPDATE identity.department_memberships
           SET status = 'suspended', valid_to = coalesce(valid_to, now()), updated_at = now()
           WHERE principal_id = $1 AND status = 'active'`,
          [principalId],
        );
        await client.query(
          `UPDATE identity.runtime_bindings
           SET status = 'suspended', valid_to = coalesce(valid_to, now()), updated_at = now()
           WHERE principal_id = $1 AND status IN ('draft', 'active')`,
          [principalId],
        );
        await client.query(
          `UPDATE identity.broker_credentials SET status = 'suspended'
           WHERE principal_id = $1 AND status IN ('draft', 'active')`,
          [principalId],
        );
        await client.query(
          `UPDATE governance.capability_grants
           SET status = 'suspended', valid_to = coalesce(valid_to, now()), updated_at = now()
           WHERE principal_id = $1 AND status IN ('draft', 'active')`,
          [principalId],
        );
        await client.query(
          `UPDATE identity.policy_assignments
           SET status = 'suspended', valid_to = coalesce(valid_to, now()), updated_at = now()
           WHERE principal_id = $1 AND status = 'active'`,
          [principalId],
        );
        const jobResult = await client.query(
          `UPDATE identity.provisioning_jobs
           SET status = 'failed', finished_at = now(), error_code = $2,
               revision = revision + 1
           WHERE id = $1 AND department_id = $3 AND status IN ('confirmed', 'running')
           RETURNING id, principal_id, job_type, status, error_code, revision, finished_at`,
          [jobId, errorCode, departmentId],
        );
        await client.query(
          `INSERT INTO identity.provisioning_events (
             job_id, event_type, actor_principal_id, from_status, to_status, payload
           ) VALUES ($1, 'failed', $2, 'running', 'failed', $3::jsonb)`,
          [jobId, actorPrincipalId, JSON.stringify({ error_code: errorCode })],
        );
        return jobResult.rows[0] || null;
      });
    },
  });
}
