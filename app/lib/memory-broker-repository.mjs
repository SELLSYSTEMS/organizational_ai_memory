const SHA256 = /^[a-f0-9]{64}$/;
const PRINCIPAL_KEY = /^agent:[a-z0-9][a-z0-9_.-]{1,118}$/;

export class MemoryBrokerRepositoryError extends Error {
  constructor(code, message, status = 401) {
    super(message);
    this.name = 'MemoryBrokerRepositoryError';
    this.code = code;
    this.status = status;
  }
}

function fail(code, message, status) {
  throw new MemoryBrokerRepositoryError(code, message, status);
}

function requirePool(pool) {
  if (!pool || typeof pool.connect !== 'function') throw new TypeError('A PostgreSQL pool is required.');
}

async function audit(client, { actorId = null, outcome, taskKey, correlationKey, payload }) {
  const result = await client.query(
    `SELECT audit.record_broker_interaction($1, $2, $3, $4, $5::jsonb) AS event_key`,
    [actorId, outcome, taskKey, correlationKey, JSON.stringify(payload)],
  );
  return result.rows[0]?.event_key || null;
}

function capabilityProjection(row) {
  const evidence = Array.isArray(row.source_evidence) ? row.source_evidence : [];
  if (!evidence.length) fail('capability_provenance_missing', 'Approved capability has no provenance.', 503);
  return {
    asset_key: row.asset_key,
    asset_type: row.asset_type,
    title: row.title,
    summary: row.summary,
    capability_area: row.capability_area,
    problem_solved: row.problem_solved,
    why_it_worked: row.why_it_worked,
    content: {
      version: row.version,
      schema_version: Number(row.content_schema_version),
      content_type: row.content_type,
      sha256: row.content_sha256,
      body: row.content_body,
    },
    governance: {
      review_status: row.review_status,
      visibility: row.visibility,
      owner_role: row.owner_role,
      consumer_roles: row.consumer_roles || [],
      last_validated_at: row.last_validated_at instanceof Date
        ? row.last_validated_at.toISOString().slice(0, 10)
        : String(row.last_validated_at),
    },
    source_turn_ids: evidence.map((item) => item.source_turn_id),
    provenance: evidence.map((item) => ({
      observation_id: item.observation_id,
      source_turn_id: item.source_turn_id,
      actor_role: item.actor_role,
      context_scope: item.context_scope,
      occurred_at: item.occurred_at instanceof Date
        ? item.occurred_at.toISOString()
        : new Date(item.occurred_at).toISOString(),
      text: item.evidence_text,
    })),
  };
}

export function createMemoryBrokerRepository(pool) {
  requirePool(pool);

  return Object.freeze({
    async approvedWebsiteCapability({
      tokenSha256,
      claimedPrincipalKey = null,
      correlationKey,
    }) {
      if (!SHA256.test(tokenSha256)) fail('authentication_failed', 'Broker credential is invalid.');
      if (claimedPrincipalKey !== null && !PRINCIPAL_KEY.test(claimedPrincipalKey)) {
        fail('authentication_failed', 'Broker credential is invalid.');
      }
      const taskKey = 'website_delivery_handoff';
      const client = await pool.connect();
      let transactionOpen = false;
      try {
        await client.query('BEGIN');
        transactionOpen = true;
        const authResult = await client.query(
          `/* broker:authorize-token-and-grant */
           SELECT credential.id AS credential_id,
                  agent.id AS principal_id,
                  agent.principal_key,
                  sponsor.id AS sponsor_principal_id,
                  sponsor.principal_key AS sponsor_principal_key,
                  department.id AS department_id,
                  department.department_key,
                  template.id AS policy_template_id,
                  template.template_key AS policy_template_key,
                  template.version AS policy_template_version,
                  credential.metadata->>'policy_hash' AS policy_hash,
                  capability_grant.id AS capability_grant_id,
                  capability_grant.capability_task_key,
                  capability_grant.allowed_review_statuses
           FROM identity.broker_credentials credential
           JOIN identity.principals agent
             ON agent.id = credential.principal_id
            AND agent.principal_kind = 'agent'
            AND agent.status = 'active'
           JOIN identity.principal_links sponsor_link
             ON sponsor_link.target_principal_id = agent.id
            AND sponsor_link.link_kind = 'linked_agent'
            AND sponsor_link.status = 'active'
           JOIN identity.principals sponsor
             ON sponsor.id = sponsor_link.source_principal_id
            AND sponsor.principal_kind = 'human'
            AND sponsor.status = 'active'
           JOIN identity.department_memberships agent_membership
             ON agent_membership.principal_id = agent.id
            AND agent_membership.status = 'active'
            AND agent_membership.valid_from <= now()
            AND (agent_membership.valid_to IS NULL OR agent_membership.valid_to > now())
           JOIN identity.department_memberships sponsor_membership
             ON sponsor_membership.principal_id = sponsor.id
            AND sponsor_membership.department_id = agent_membership.department_id
            AND sponsor_membership.status = 'active'
            AND sponsor_membership.valid_from <= now()
            AND (sponsor_membership.valid_to IS NULL OR sponsor_membership.valid_to > now())
           JOIN identity.departments department
             ON department.id = agent_membership.department_id
            AND department.status = 'active'
           JOIN identity.policy_templates template
             ON template.id = credential.policy_template_id
            AND template.status = 'active'
           JOIN identity.policy_assignments agent_assignment
             ON agent_assignment.principal_id = agent.id
            AND agent_assignment.department_id = department.id
            AND agent_assignment.template_id = template.id
            AND agent_assignment.assignment_scope = 'principal'
            AND agent_assignment.status = 'active'
            AND agent_assignment.valid_from <= now()
            AND (agent_assignment.valid_to IS NULL OR agent_assignment.valid_to > now())
           JOIN identity.policy_assignments sponsor_assignment
             ON sponsor_assignment.principal_id = sponsor.id
            AND sponsor_assignment.department_id = department.id
            AND sponsor_assignment.assignment_scope = 'principal'
            AND sponsor_assignment.status = 'active'
            AND sponsor_assignment.valid_from <= now()
            AND (sponsor_assignment.valid_to IS NULL OR sponsor_assignment.valid_to > now())
           JOIN identity.policy_templates sponsor_template
             ON sponsor_template.id = sponsor_assignment.template_id
            AND sponsor_template.status = 'active'
           JOIN governance.capability_grants capability_grant
             ON capability_grant.principal_id = agent.id
            AND capability_grant.department_id = department.id
            AND capability_grant.policy_template_id = template.id
            AND capability_grant.capability_task_key = $2
            AND capability_grant.status = 'active'
            AND capability_grant.valid_from <= now()
            AND (capability_grant.valid_to IS NULL OR capability_grant.valid_to > now())
            AND 'approved' = ANY(capability_grant.allowed_review_statuses)
           JOIN identity.runtime_bindings binding
             ON binding.principal_id = agent.id
            AND binding.binding_kind = 'broker_client'
            AND binding.access_mode = 'brokered'
            AND binding.status = 'active'
            AND binding.valid_from <= now()
            AND (binding.valid_to IS NULL OR binding.valid_to > now())
            AND binding.metadata->>'credential_id' = credential.id::text
            AND binding.metadata->>'policy_hash' = credential.metadata->>'policy_hash'
           WHERE credential.token_sha256 = $1
             AND credential.status = 'active'
             AND (credential.expires_at IS NULL OR credential.expires_at > now())
             AND credential.metadata->>'policy_hash' ~ '^[a-f0-9]{64}$'
             AND EXISTS (
               SELECT 1
               FROM identity.provisioning_jobs activation_job
               WHERE activation_job.principal_id = agent.id
                 AND activation_job.department_id = department.id
                 AND (
                   (
                     activation_job.id::text = credential.metadata->>'activation_job_id'
                     AND activation_job.status = 'succeeded'
                   )
                   OR (
                     activation_job.id::text = credential.metadata->>'provisioning_job_id'
                     AND activation_job.status = 'running'
                     AND activation_job.started_at >= now() - interval '30 seconds'
                     AND activation_job.started_at <= now()
                   )
                 )
             )
             AND (
               SELECT count(*)
               FROM identity.principal_links unique_link
               JOIN identity.principals unique_sponsor
                 ON unique_sponsor.id = unique_link.source_principal_id
                AND unique_sponsor.principal_kind = 'human'
                AND unique_sponsor.status = 'active'
               JOIN identity.department_memberships unique_membership
                 ON unique_membership.principal_id = unique_sponsor.id
                AND unique_membership.department_id = department.id
                AND unique_membership.status = 'active'
                AND unique_membership.valid_from <= now()
                AND (unique_membership.valid_to IS NULL OR unique_membership.valid_to > now())
               WHERE unique_link.target_principal_id = agent.id
                 AND unique_link.link_kind = 'linked_agent'
                 AND unique_link.status = 'active'
             ) = 1
             AND EXISTS (
               SELECT 1 FROM identity.policy_template_rules allow_rule
               WHERE allow_rule.template_id = template.id
                 AND allow_rule.principal_kind = 'agent'
                 AND allow_rule.permission_key = 'memory.department.read'
                 AND allow_rule.effect = 'allow'
                 AND allow_rule.conditions = '{}'::jsonb
                 AND (allow_rule.membership_role IS NULL
                      OR allow_rule.membership_role = agent_membership.membership_role)
             )
             AND NOT EXISTS (
               SELECT 1 FROM identity.policy_template_rules deny_rule
               WHERE deny_rule.template_id = template.id
                 AND deny_rule.principal_kind = 'agent'
                 AND deny_rule.permission_key = 'memory.department.read'
                 AND deny_rule.effect = 'deny'
             )
             AND EXISTS (
               SELECT 1 FROM identity.policy_template_rules sponsor_allow_rule
               WHERE sponsor_allow_rule.template_id = sponsor_template.id
                 AND sponsor_allow_rule.principal_kind = 'human'
                 AND sponsor_allow_rule.permission_key = 'memory.department.read'
                 AND sponsor_allow_rule.effect = 'allow'
                 AND sponsor_allow_rule.conditions = '{}'::jsonb
                 AND (sponsor_allow_rule.membership_role IS NULL
                      OR sponsor_allow_rule.membership_role = sponsor_membership.membership_role)
             )
             AND NOT EXISTS (
               SELECT 1 FROM identity.policy_template_rules sponsor_deny_rule
               WHERE sponsor_deny_rule.template_id = sponsor_template.id
                 AND sponsor_deny_rule.principal_kind = 'human'
                 AND sponsor_deny_rule.permission_key = 'memory.department.read'
                 AND sponsor_deny_rule.effect = 'deny'
             )
             AND NOT EXISTS (
               SELECT 1 FROM identity.explicit_permission_denials denial
               WHERE denial.principal_id IN (agent.id, sponsor.id)
                 AND denial.department_id = department.id
                 AND denial.permission_key = 'memory.department.read'
                 AND denial.status = 'active'
                 AND denial.valid_from <= now()
                 AND (denial.valid_to IS NULL OR denial.valid_to > now())
             )
           ORDER BY credential.issued_at DESC
           LIMIT 1`,
          [tokenSha256, taskKey],
        );
        const authorization = authResult.rows[0];
        if (!authorization) {
          await audit(client, {
            outcome: 'denied',
            taskKey,
            correlationKey,
            payload: { reason: 'credential_or_grant_inactive' },
          });
          await client.query('COMMIT');
          transactionOpen = false;
          fail('authentication_failed', 'Broker credential is invalid or inactive.');
        }
        if (claimedPrincipalKey !== null && claimedPrincipalKey !== authorization.principal_key) {
          await audit(client, {
            actorId: authorization.principal_id,
            outcome: 'denied',
            taskKey,
            correlationKey,
            payload: { reason: 'principal_header_mismatch' },
          });
          await client.query('COMMIT');
          transactionOpen = false;
          fail('authentication_failed', 'Broker credential is invalid or inactive.');
        }

        const capabilityResult = await client.query(
          `/* broker:approved-website-capability */
           SELECT asset.asset_key, asset.asset_type, asset.title, asset.summary,
                  asset.capability_area, asset.problem_solved, asset.why_it_worked,
                  asset.owner_role, asset.consumer_roles, asset.visibility,
                  asset.review_status, asset.version, asset.last_validated_at,
                  version.content_schema_version, version.content_type,
                  version.content_sha256, version.body AS content_body,
                  COALESCE(jsonb_agg(jsonb_build_object(
                    'observation_id', evidence.observation_id,
                    'source_turn_id', evidence.source_turn_id,
                    'actor_role', evidence.actor_role,
                    'context_scope', evidence.context_scope,
                    'occurred_at', evidence.occurred_at,
                    'evidence_text', evidence.evidence_text
                  ) ORDER BY evidence.occurred_at, evidence.source_turn_id)
                  FILTER (WHERE evidence.observation_id IS NOT NULL), '[]'::jsonb) AS source_evidence
           FROM oam_public.capability_tasks task
           JOIN oam_public.capability_task_recommendations recommendation
             ON recommendation.pack_id = task.pack_id AND recommendation.task_id = task.id
           JOIN oam_public.capability_assets asset
             ON asset.pack_id = recommendation.pack_id AND asset.id = recommendation.asset_id
           JOIN oam_public.capability_asset_versions version
             ON version.pack_id = asset.pack_id AND version.asset_id = asset.id
           LEFT JOIN oam_public.capability_source_evidence evidence
             ON evidence.pack_id = asset.pack_id AND evidence.asset_id = asset.id
           WHERE task.task_key = $1
             AND asset.review_status = 'approved'
           GROUP BY asset.id, asset.asset_key, asset.asset_type, asset.title, asset.summary,
                    asset.capability_area, asset.problem_solved, asset.why_it_worked,
                    asset.owner_role, asset.consumer_roles, asset.visibility,
                    asset.review_status, asset.version, asset.last_validated_at,
                    version.content_schema_version, version.content_type,
                    version.content_sha256, version.body, recommendation.recommendation_rank
           ORDER BY recommendation.recommendation_rank
           LIMIT 1`,
          [authorization.capability_task_key],
        );
        const row = capabilityResult.rows[0];
        if (!row) {
          await audit(client, {
            actorId: authorization.principal_id,
            outcome: 'failed',
            taskKey,
            correlationKey,
            payload: { reason: 'approved_capability_unavailable' },
          });
          await client.query('COMMIT');
          transactionOpen = false;
          fail('approved_capability_unavailable', 'Approved website capability is unavailable.', 503);
        }
        const capability = capabilityProjection(row);
        const auditEventKey = await audit(client, {
          actorId: authorization.principal_id,
          outcome: 'allowed',
          taskKey,
          correlationKey,
          payload: {
            credential_id: authorization.credential_id,
            capability_grant_id: authorization.capability_grant_id,
            asset_key: capability.asset_key,
            source_count: capability.source_turn_ids.length,
          },
        });
        await client.query('COMMIT');
        transactionOpen = false;
        return {
          authorization: {
            principal_id: authorization.principal_id,
            principal_key: authorization.principal_key,
            sponsor_principal_id: authorization.sponsor_principal_id,
            sponsor_principal_key: authorization.sponsor_principal_key,
            department_id: authorization.department_id,
            department_key: authorization.department_key,
            policy_template_key: authorization.policy_template_key,
            policy_template_version: Number(authorization.policy_template_version),
            policy_hash: authorization.policy_hash,
            capability_grant_id: authorization.capability_grant_id,
          },
          capability,
          audit_event_key: auditEventKey,
        };
      } catch (error) {
        if (transactionOpen) await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
  });
}
