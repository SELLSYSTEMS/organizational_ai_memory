import crypto from 'node:crypto';
import { computeEffectiveAccess, PERMISSIONS } from './effective-permissions.mjs';

const PRINCIPAL_KEY = /^(?:human|agent|service):[a-z0-9][a-z0-9_.-]{1,118}$/;
const DEPARTMENT_KEY = /^[a-z][a-z0-9_]{1,79}$/;
const SAFE_KEY = /^[a-z][a-z0-9_.:-]{1,159}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MEMBERSHIP_ROLES = new Set(['member', 'reviewer', 'architect']);
const PROVISIONING_JOB_TYPES = new Set([
  'logical_principal',
  'linux_identity',
  'runtime_binding',
  'broker_credential',
  'postgres_exception',
  'suspension',
  'revocation',
]);
const CANDIDATE_TYPES = new Set([
  'prompt',
  'workflow',
  'agent',
  'decision_pattern',
  'best_practice',
]);

export class IdentityDataPlaneError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'IdentityDataPlaneError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new IdentityDataPlaneError(code, message);
}

function text(value, label, { min = 1, max = 500, pattern } = {}) {
  if (typeof value !== 'string') fail('invalid_input', `${label} must be a string.`);
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length < min || normalized.length > max || (pattern && !pattern.test(normalized))) {
    fail('invalid_input', `${label} is invalid.`);
  }
  return normalized;
}

function uuid(value, label) {
  const normalized = text(value, label, { max: 36 });
  if (!UUID.test(normalized)) fail('invalid_input', `${label} must be a UUID.`);
  return normalized.toLowerCase();
}

function integer(value, label, { min = 0, max = 1_000_000 } = {}) {
  if (!Number.isInteger(value) || value < min || value > max) {
    fail('invalid_input', `${label} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function jsonObject(value, label, maxBytes = 32_768) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('invalid_input', `${label} must be an object.`);
  }
  if (Buffer.byteLength(JSON.stringify(value)) > maxBytes) {
    fail('invalid_input', `${label} is too large.`);
  }
  return value;
}

function jsonArray(value, label, { min = 0, max = 64 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    fail('invalid_input', `${label} must contain between ${min} and ${max} items.`);
  }
  return value;
}

function timestamp(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) fail('invalid_input', `${label} must be a valid timestamp.`);
  return date.toISOString();
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

async function appendAuditRow(client, {
  eventType,
  actorPrincipalId,
  departmentId = null,
  resourceType,
  resourceKey,
  outcome = 'recorded',
  correlationKey = null,
  payload = {},
}) {
  const result = await client.query(
    `
      INSERT INTO audit.security_events (
        event_type,
        actor_principal_id,
        department_id,
        workload_role,
        resource_type,
        resource_key,
        outcome,
        correlation_key,
        payload
      ) VALUES ($1, $2, $3, current_user, $4, $5, $6, $7, $8::jsonb)
      RETURNING event_key, occurred_at
    `,
    [
      eventType,
      actorPrincipalId,
      departmentId,
      resourceType,
      resourceKey,
      outcome,
      correlationKey,
      JSON.stringify(payload),
    ],
  );
  return result.rows[0];
}

async function authorizationState(client, principalId, departmentId, {
  resolveSponsor = true,
  at = new Date(),
  requirePolicyAssignment = true,
} = {}) {
  const principalResult = await client.query(
      `SELECT id, principal_key, principal_kind, status
       FROM identity.principals
       WHERE id = $1`,
      [principalId],
    );
  const membershipResult = await client.query(
      `SELECT principal_id, department_id, membership_role, status, valid_from, valid_to
       FROM identity.department_memberships
       WHERE principal_id = $1 AND department_id = $2`,
      [principalId, departmentId],
    );
  const bindingResult = await client.query(
      `SELECT principal_id, binding_kind, binding_value, access_mode, status, valid_from, valid_to
       FROM identity.runtime_bindings
       WHERE principal_id = $1`,
      [principalId],
    );
  const assignmentResult = await client.query(
      `SELECT assignment.id, assignment.assignment_key, assignment.assignment_scope,
              assignment.principal_id, assignment.department_id,
              assignment.template_id, assignment.status, assignment.valid_from, assignment.valid_to
       FROM identity.policy_assignments assignment
       JOIN identity.policy_templates template
         ON template.id = assignment.template_id AND template.status = 'active'
      WHERE assignment.department_id = $2
         AND (assignment.principal_id = $1 OR assignment.assignment_scope = 'department')`,
      [principalId, departmentId],
    );
  const policyRuleResult = await client.query(
      `SELECT rule.id, rule.template_id, rule.principal_kind, rule.membership_role,
              rule.permission_key, rule.effect, rule.conditions, rule.sort_order,
              template.template_key AS source
       FROM identity.policy_assignments assignment
       JOIN identity.policy_templates template
         ON template.id = assignment.template_id AND template.status = 'active'
       JOIN identity.policy_template_rules rule ON rule.template_id = template.id
       WHERE assignment.department_id = $2
         AND (assignment.principal_id = $1 OR assignment.assignment_scope = 'department')
         AND assignment.status = 'active'
         AND assignment.valid_from <= $3::timestamptz
         AND (assignment.valid_to IS NULL OR assignment.valid_to > $3::timestamptz)
      ORDER BY rule.sort_order, rule.id`,
      [principalId, departmentId, at],
    );
  const denialResult = await client.query(
      `SELECT denial.permission_key
       FROM identity.explicit_permission_denials denial
       WHERE denial.principal_id = $1 AND denial.department_id = $2
         AND denial.status = 'active'
         AND denial.valid_from <= $3::timestamptz
         AND (denial.valid_to IS NULL OR denial.valid_to > $3::timestamptz)
       ORDER BY denial.permission_key`,
      [principalId, departmentId, at],
    );
  const principal = principalResult.rows[0];
  if (!principal) fail('principal_not_found', 'Principal not found.');
  const state = {
    principal,
    memberships: membershipResult.rows,
    bindings: bindingResult.rows,
    policyAssignments: assignmentResult.rows,
    policyRules: policyRuleResult.rows,
    explicitDenials: denialResult.rows.map((row) => row.permission_key),
    sponsorPermissions: null,
    sponsorPrincipalId: null,
    requireSponsorIntersection: requirePolicyAssignment && principal.principal_kind === 'agent',
    requirePolicyAssignment,
    resourceDepartmentId: departmentId,
  };
  if (!resolveSponsor || principal.principal_kind !== 'agent') return state;

  const sponsorResult = await client.query(
    `SELECT sponsor.id
     FROM identity.principal_links link
     JOIN identity.principals sponsor
       ON sponsor.id = link.source_principal_id
      AND sponsor.principal_kind = 'human'
      AND sponsor.status = 'active'
     WHERE link.target_principal_id = $1
       AND link.link_kind = 'linked_agent'
       AND link.status = 'active'
     ORDER BY sponsor.id`,
    [principalId],
  );
  if (sponsorResult.rows.length !== 1) return state;
  const sponsorState = await authorizationState(
    client,
    sponsorResult.rows[0].id,
    departmentId,
    { resolveSponsor: false, at, requirePolicyAssignment },
  );
  const sponsorAccess = computeEffectiveAccess({ ...sponsorState, at });
  state.sponsorPermissions = sponsorAccess.permissions;
  state.sponsorPrincipalId = sponsorAccess.principal_id;
  return state;
}

async function requirePermission(
  client,
  principalId,
  departmentId,
  permission,
  at,
  requirePolicyAssignment = true,
) {
  const state = await authorizationState(client, principalId, departmentId, {
    at,
    requirePolicyAssignment,
  });
  const access = computeEffectiveAccess({ ...state, at });
  if (!access.can(permission)) {
    if (access.runtime_findings.some((finding) => finding.code === 'policy_assignment_missing')) {
      fail('policy_assignment_missing', 'An active policy assignment is required.');
    }
    if (access.runtime_findings.some((finding) => finding.code === 'agent_sponsor_context_missing')) {
      fail('agent_sponsor_policy_missing', 'An active sponsor policy is required.');
    }
    fail('permission_denied', `Permission ${permission} is required.`);
  }
  return access;
}

function requirePool(pool) {
  if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') {
    throw new TypeError('A PostgreSQL pool with query and connect methods is required.');
  }
}

export function createIdentityDataPlane({
  pool,
  now = () => new Date(),
  randomUUID = crypto.randomUUID,
  requirePolicyAssignment = true,
} = {}) {
  requirePool(pool);

  return {
    async createHuman({
      principalKey,
      displayName,
      externalIssuer,
      externalSubject,
      departmentId,
      membershipRole = 'member',
      requestedByPrincipalId,
      metadata = {},
    }) {
      const key = text(principalKey, 'principalKey', { max: 120, pattern: PRINCIPAL_KEY });
      if (!key.startsWith('human:')) fail('invalid_input', 'Human principal keys must start with human:.');
      const name = text(displayName, 'displayName', { max: 200 });
      const issuer = text(externalIssuer, 'externalIssuer', { max: 500 });
      const subject = text(externalSubject, 'externalSubject', { max: 500 });
      const department = uuid(departmentId, 'departmentId');
      const requester = uuid(requestedByPrincipalId, 'requestedByPrincipalId');
      const principalId = uuid(randomUUID(), 'generatedPrincipalId');
      if (!MEMBERSHIP_ROLES.has(membershipRole)) fail('invalid_input', 'membershipRole is unsupported.');
      jsonObject(metadata, 'metadata', 16_384);

      return transaction(pool, async (client) => {
        await requirePermission(
          client, requester, department, PERMISSIONS.PROVISIONING_CONFIRM, now(), requirePolicyAssignment,
        );
        const policyResult = await client.query(
          `SELECT id, template_key, version
           FROM identity.policy_templates
           WHERE template_key = $1 AND status = 'active'
           ORDER BY version DESC LIMIT 1`,
          [membershipRole],
        );
        const policy = policyResult.rows[0];
        if (!policy) fail('policy_not_active', `No active ${membershipRole} policy is available.`);
        await client.query(
          `
            INSERT INTO identity.principals (
              id, principal_key, principal_kind, display_name,
              external_issuer, external_subject, status, metadata
            ) VALUES ($1, $2, 'human', $3, $4, $5, 'active', $6::jsonb)
          `,
          [principalId, key, name, issuer, subject, JSON.stringify(metadata)],
        );
        await client.query(
          `
            INSERT INTO identity.department_memberships (
              principal_id, department_id, membership_role,
              status, approved_by_principal_id
            ) VALUES ($1, $2, $3, 'active', $4)
          `,
          [principalId, department, membershipRole, requester],
        );
        const assignmentResult = await client.query(
          `INSERT INTO identity.policy_assignments (
             assignment_key, assignment_scope, principal_id, department_id, template_id,
             status, assigned_by_principal_id, reason
           ) VALUES ($1, 'principal', $2, $3, $4, 'active', $5, $6)
           RETURNING id, assignment_key, principal_id, department_id, template_id, status, valid_from`,
          [
            `assignment:${randomUUID()}`,
            principalId,
            department,
            policy.id,
            requester,
            `Initial ${membershipRole} policy for ${key}`,
          ],
        );
        await appendAuditRow(client, {
          eventType: 'identity.human_created',
          actorPrincipalId: requester,
          departmentId: department,
          resourceType: 'principal',
          resourceKey: key,
          payload: {
            department_id: department,
            membership_role: membershipRole,
            policy_template_key: policy.template_key,
            policy_template_version: policy.version,
            policy_assignment_id: assignmentResult.rows[0].id,
            logical_only: true,
          },
        });
        const principalResult = await client.query(
          `/* identity:created-principal */
           SELECT id, principal_key, principal_kind, display_name, status, created_at
           FROM identity.principals WHERE id = $1`,
          [principalId],
        );
        const human = principalResult.rows[0];
        if (!human) fail('principal_creation_failed', 'Created human is outside the authorized scope.');
        return {
          ...human,
          logical_only: true,
          runtime_bindings: [],
          policy_assignments: assignmentResult.rows,
        };
      });
    },

    async createLinkedAgentDraft({
      principalKey,
      displayName,
      ownerPrincipalId,
      requestedByPrincipalId,
      metadata = {},
    }) {
      const key = text(principalKey, 'principalKey', { max: 120, pattern: PRINCIPAL_KEY });
      if (!key.startsWith('agent:')) fail('invalid_input', 'Agent principal keys must start with agent:.');
      const name = text(displayName, 'displayName', { max: 200 });
      const owner = uuid(ownerPrincipalId, 'ownerPrincipalId');
      const requester = uuid(requestedByPrincipalId, 'requestedByPrincipalId');
      jsonObject(metadata, 'metadata', 16_384);
      if (owner !== requester) {
        fail('permission_denied', 'A human may create only its own linked agent draft.');
      }

      return transaction(pool, async (client) => {
        const ownerResult = await client.query(
          `SELECT id, principal_kind, status FROM identity.principals WHERE id = $1 FOR SHARE`,
          [owner],
        );
        const ownerRow = ownerResult.rows[0];
        if (!ownerRow || ownerRow.principal_kind !== 'human' || ownerRow.status !== 'active') {
          fail('invalid_agent_owner', 'A linked agent requires an active human owner.');
        }
        const result = await client.query(
          `
            INSERT INTO identity.principals (
              principal_key, principal_kind, display_name, status, metadata
            ) VALUES ($1, 'agent', $2, 'draft', $3::jsonb)
            RETURNING id, principal_key, principal_kind, display_name, status, created_at
          `,
          [key, name, JSON.stringify(metadata)],
        );
        const agent = result.rows[0];
        await client.query(
          `
            INSERT INTO identity.principal_links (
              source_principal_id, target_principal_id, link_kind, status,
              metadata
            ) VALUES ($1, $2, 'linked_agent', 'active', $3::jsonb)
          `,
          [owner, agent.id, JSON.stringify({ permission_inheritance: false })],
        );
        await appendAuditRow(client, {
          eventType: 'identity.agent_draft_created',
          actorPrincipalId: requester,
          resourceType: 'principal',
          resourceKey: key,
          payload: { owner_principal_id: owner, permission_inheritance: false },
        });
        return {
          ...agent,
          linked_owner_principal_id: owner,
          inherits_permissions: false,
          runtime_bindings: [],
        };
      });
    },

    async createLinkedAgentCredentialDraft({
      principalKey,
      displayName,
      ownerPrincipalId,
      requestedByPrincipalId,
      departmentId,
      tokenSha256,
      policyTemplateKey,
      policyTemplateVersion,
      policyHash,
      metadata = {},
    }) {
      const key = text(principalKey, 'principalKey', { max: 120, pattern: PRINCIPAL_KEY });
      if (!key.startsWith('agent:')) fail('invalid_input', 'Agent principal keys must start with agent:.');
      const name = text(displayName, 'displayName', { max: 200 });
      const owner = uuid(ownerPrincipalId, 'ownerPrincipalId');
      const requester = uuid(requestedByPrincipalId, 'requestedByPrincipalId');
      const department = uuid(departmentId, 'departmentId');
      const tokenHash = text(tokenSha256, 'tokenSha256', { min: 64, max: 64, pattern: SHA256 });
      const templateKey = text(policyTemplateKey, 'policyTemplateKey', {
        max: 80,
        pattern: DEPARTMENT_KEY,
      });
      const templateVersion = integer(policyTemplateVersion, 'policyTemplateVersion', { min: 1 });
      const activePolicyHash = text(policyHash, 'policyHash', { min: 64, max: 64, pattern: SHA256 });
      const agentId = uuid(randomUUID(), 'generatedAgentId');
      jsonObject(metadata, 'metadata', 16_384);
      if (owner !== requester) {
        fail('permission_denied', 'A human may create only its own linked agent draft.');
      }

      return transaction(pool, async (client) => {
        await requirePermission(
          client, requester, department, PERMISSIONS.PROVISIONING_QUEUE, now(), requirePolicyAssignment,
        );
        const ownerResult = await client.query(
            `SELECT id, principal_kind, status FROM identity.principals WHERE id = $1 FOR SHARE`,
            [owner],
          );
        const policyResult = await client.query(
            `SELECT id, template_key, version, status
             FROM identity.policy_templates
             WHERE template_key = $1 AND version = $2 AND status = 'active'`,
            [templateKey, templateVersion],
          );
        const ownerRow = ownerResult.rows[0];
        if (!ownerRow || ownerRow.principal_kind !== 'human' || ownerRow.status !== 'active') {
          fail('invalid_agent_owner', 'A linked agent requires an active human owner.');
        }
        const policy = policyResult.rows[0];
        if (!policy) fail('policy_not_active', 'The selected agent policy is not active.');

        await client.query(
          `
            INSERT INTO identity.principals (
              id, principal_key, principal_kind, display_name, status, metadata
            ) VALUES ($1, $2, 'agent', $3, 'draft', $4::jsonb)
          `,
          [agentId, key, name, JSON.stringify(metadata)],
        );
        await client.query(
          `INSERT INTO identity.department_memberships (
             principal_id, department_id, membership_role, status,
             approved_by_principal_id
           ) VALUES ($1, $2, 'member', 'active', $3)`,
          [agentId, department, requester],
        );
        await client.query(
          `INSERT INTO identity.principal_links (
             source_principal_id, target_principal_id, link_kind, status, metadata
           ) VALUES ($1, $2, 'linked_agent', 'active', $3::jsonb)`,
          [owner, agentId, JSON.stringify({ permission_inheritance: false })],
        );
        const assignmentResult = await client.query(
          `INSERT INTO identity.policy_assignments (
             assignment_key, assignment_scope, principal_id, department_id, template_id, status,
             assigned_by_principal_id, reason
           ) VALUES ($1, 'principal', $2, $3, $4, 'active', $5, $6)
           RETURNING id, assignment_key, principal_id, department_id, template_id, status, valid_from`,
          [
            `assignment:${randomUUID()}`,
            agentId,
            department,
            policy.id,
            requester,
            `Initial memory-reuse policy for ${key}`,
          ],
        );
        const credentialResult = await client.query(
          `INSERT INTO identity.broker_credentials (
             principal_id, token_sha256, policy_template_id, status,
             issued_by_principal_id, metadata
           ) VALUES ($1, $2, $3, 'draft', $4, $5::jsonb)
           RETURNING id, principal_id, policy_template_id, status, issued_at`,
          [
            agentId,
            tokenHash,
            policy.id,
            requester,
            JSON.stringify({ profile_key: 'memory-reuse-agent-v1', policy_hash: activePolicyHash }),
          ],
        );
        const credential = credentialResult.rows[0];
        const bindingResult = await client.query(
          `INSERT INTO identity.runtime_bindings (
             principal_id, binding_kind, binding_value, access_mode, status, metadata
           ) VALUES ($1, 'broker_client', $2, 'brokered', 'draft', $3::jsonb)
           RETURNING id, binding_kind, binding_value, access_mode, status, metadata`,
          [
            agentId,
            `broker:${agentId}`,
            JSON.stringify({
              credential_id: credential.id,
              policy_hash: activePolicyHash,
              profile_key: 'memory-reuse-agent-v1',
            }),
          ],
        );
        const grantResult = await client.query(
          `INSERT INTO governance.capability_grants (
             principal_id, department_id, policy_template_id,
             capability_task_key, allowed_review_statuses, status,
             created_by_principal_id
           ) VALUES ($1, $2, $3, 'website_delivery_handoff', ARRAY['approved']::text[], 'draft', $4)
           RETURNING id, department_id, capability_task_key, allowed_review_statuses, status`,
          [agentId, department, policy.id, requester],
        );
        await appendAuditRow(client, {
          eventType: 'identity.agent_credential_draft_created',
          actorPrincipalId: requester,
          departmentId: department,
          resourceType: 'principal',
          resourceKey: key,
          payload: {
            owner_principal_id: owner,
            department_id: department,
            policy_template_key: templateKey,
            policy_template_version: templateVersion,
            policy_hash: activePolicyHash,
            credential_id: credential.id,
            capability_grant_id: grantResult.rows[0].id,
            policy_assignment_id: assignmentResult.rows[0].id,
            permission_inheritance: false,
          },
        });
        const principalResult = await client.query(
          `/* identity:created-principal */
           SELECT id, principal_key, principal_kind, display_name, status, created_at
           FROM identity.principals WHERE id = $1`,
          [agentId],
        );
        const agent = principalResult.rows[0];
        if (!agent) fail('principal_creation_failed', 'Created agent is outside the authorized scope.');
        return {
          ...agent,
          linked_owner_principal_id: owner,
          department_id: department,
          inherits_permissions: false,
          broker_credential: credential,
          capability_grants: grantResult.rows,
          policy_assignments: assignmentResult.rows,
          runtime_bindings: bindingResult.rows,
        };
      });
    },

    async listState({ departmentId = null, limit = 200 } = {}) {
      const boundedLimit = integer(limit, 'limit', { min: 1, max: 500 });
      const department = departmentId === null ? null : uuid(departmentId, 'departmentId');
      const parameters = [department, boundedLimit];
      const [principals, departments, memberships, bindings, jobs, proofs] = await Promise.all([
        pool.query(
          `SELECT id, principal_key, principal_kind, display_name, status, created_at, suspended_at
           FROM identity.principals ORDER BY principal_key LIMIT $2`,
          parameters,
        ),
        pool.query(
          `SELECT id, department_key, display_name, status
           FROM identity.departments
           WHERE ($1::uuid IS NULL OR id = $1)
           ORDER BY department_key LIMIT $2`,
          parameters,
        ),
        pool.query(
          `SELECT membership.*
           FROM identity.department_memberships membership
           WHERE ($1::uuid IS NULL OR membership.department_id = $1)
           ORDER BY membership.department_id, membership.principal_id, membership.membership_role
           LIMIT $2`,
          parameters,
        ),
        pool.query(
          `SELECT binding.* FROM identity.runtime_bindings binding
           ORDER BY binding.principal_id, binding.binding_kind, binding.binding_value LIMIT $2`,
          parameters,
        ),
        pool.query(
          `SELECT job.* FROM identity.provisioning_jobs job
           ORDER BY job.requested_at DESC, job.id LIMIT $2`,
          parameters,
        ),
        pool.query(
          `SELECT proof.* FROM identity.proof_runs proof
           ORDER BY proof.executed_at DESC, proof.id LIMIT $2`,
          parameters,
        ),
      ]);
      return {
        principals: principals.rows,
        departments: departments.rows,
        memberships: memberships.rows,
        runtime_bindings: bindings.rows,
        provisioning_jobs: jobs.rows,
        proof_runs: proofs.rows,
      };
    },

    async computeEffectiveAccess({ principalId, departmentId, at = now() }) {
      const principal = uuid(principalId, 'principalId');
      const department = uuid(departmentId, 'departmentId');
      return transaction(pool, async (client) => {
        const state = await authorizationState(client, principal, department, {
          at,
          requirePolicyAssignment,
        });
        return computeEffectiveAccess({ ...state, at });
      });
    },

    async queueProvisioningPlan({
      principalId,
      jobType,
      requestedByPrincipalId,
      departmentId,
      plan,
      idempotencyKey = randomUUID(),
    }) {
      const target = uuid(principalId, 'principalId');
      const requester = uuid(requestedByPrincipalId, 'requestedByPrincipalId');
      const department = uuid(departmentId, 'departmentId');
      const key = uuid(idempotencyKey, 'idempotencyKey');
      if (!PROVISIONING_JOB_TYPES.has(jobType)) fail('invalid_input', 'jobType is unsupported.');
      jsonObject(plan, 'plan');

      return transaction(pool, async (client) => {
        const access = await requirePermission(
          client,
          requester,
          department,
          PERMISSIONS.PROVISIONING_QUEUE,
          now(),
          requirePolicyAssignment,
        );
        const targetScope = await client.query(
          `SELECT 1 FROM identity.department_memberships
           WHERE principal_id = $1 AND department_id = $2
             AND status IN ('active', 'suspended')
           LIMIT 1`,
          [target, department],
        );
        if (!targetScope.rows[0]) {
          fail('permission_denied', 'Provisioning target is outside the authorized department.');
        }
        if (target !== requester && !access.can(PERMISSIONS.PROVISIONING_CONFIRM)) {
          const linkResult = await client.query(
            `SELECT 1
             FROM identity.principal_links
             WHERE source_principal_id = $1
               AND target_principal_id = $2
               AND link_kind = 'linked_agent'
               AND status = 'active'`,
            [requester, target],
          );
          if (!linkResult.rows[0]) {
            fail('permission_denied', 'Provisioning may target only self, a linked agent, or an architect-managed principal.');
          }
        }
        const result = await client.query(
          `
            INSERT INTO identity.provisioning_jobs (
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
            RETURNING id, idempotency_key, principal_id, department_id, job_type, status,
                      plan, plan_hash, revision, requested_at
          `,
          [key, target, department, jobType, requester, JSON.stringify(plan)],
        );
        const job = result.rows[0];
        if (!job) fail('provisioning_conflict', 'Provisioning idempotency key is bound to another request.');
        await client.query(
          `
            INSERT INTO identity.provisioning_events (
              job_id, event_type, actor_principal_id, to_status, payload
            ) VALUES ($1, 'queued', $2, 'queued', '{}'::jsonb)
            ON CONFLICT DO NOTHING
          `,
          [job.id, requester],
        );
        return job;
      });
    },

    async confirmProvisioningPlan({
      jobId,
      expectedRevision,
      confirmedByPrincipalId,
      departmentId,
    }) {
      const job = uuid(jobId, 'jobId');
      const confirmer = uuid(confirmedByPrincipalId, 'confirmedByPrincipalId');
      const department = uuid(departmentId, 'departmentId');
      const revision = integer(expectedRevision, 'expectedRevision');

      return transaction(pool, async (client) => {
        await requirePermission(
          client, confirmer, department, PERMISSIONS.PROVISIONING_CONFIRM, now(), requirePolicyAssignment,
        );
        const result = await client.query(
          `
            UPDATE identity.provisioning_jobs
            SET status = 'confirmed',
                confirmed_by_principal_id = $2,
                confirmed_at = now(),
                revision = revision + 1
            WHERE id = $1 AND department_id = $4
              AND status = 'queued' AND revision = $3
            RETURNING id, principal_id, department_id, job_type, status,
                      plan_hash, revision, confirmed_at
          `,
          [job, confirmer, revision, department],
        );
        if (!result.rows[0]) fail('provisioning_conflict', 'Provisioning plan is stale or not queued.');
        await client.query(
          `
            INSERT INTO identity.provisioning_events (
              job_id, event_type, actor_principal_id, from_status, to_status
            ) VALUES ($1, 'confirmed', $2, 'queued', 'confirmed')
          `,
          [job, confirmer],
        );
        return result.rows[0];
      });
    },

    async recordProofRun({
      proofKey,
      targetKind,
      targetKey,
      status,
      commands,
      evidence = {},
      recordedByPrincipalId,
      departmentId,
      executedAt = now(),
    }) {
      const key = text(proofKey, 'proofKey', { max: 120, pattern: SAFE_KEY });
      const target = text(targetKey, 'targetKey', { max: 500 });
      const recorder = uuid(recordedByPrincipalId, 'recordedByPrincipalId');
      const department = uuid(departmentId, 'departmentId');
      if (!['principal', 'runtime_binding', 'systemd_unit', 'postgres_role', 'workspace'].includes(targetKind)) {
        fail('invalid_input', 'targetKind is unsupported.');
      }
      if (!['passed', 'failed', 'inconclusive'].includes(status)) fail('invalid_input', 'status is unsupported.');
      jsonArray(commands, 'commands', { min: 1, max: 64 });
      jsonObject(evidence, 'evidence');
      const executed = timestamp(executedAt, 'executedAt');

      return transaction(pool, async (client) => {
        await requirePermission(
          client, recorder, department, PERMISSIONS.PROOF_RECORD, now(), requirePolicyAssignment,
        );
        const result = await client.query(
          `
            INSERT INTO identity.proof_runs (
              proof_key, target_kind, target_key, status,
              commands, evidence, recorded_by_principal_id, department_id, executed_at
            ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9::timestamptz)
            RETURNING id, proof_key, target_kind, target_key, status,
                      department_id, executed_at, recorded_at
          `,
          [
            key,
            targetKind,
            target,
            status,
            JSON.stringify(commands),
            JSON.stringify(evidence),
            recorder,
            department,
            executed,
          ],
        );
        return result.rows[0];
      });
    },

    async createQuarantinedUpload({
      uploadKey,
      submittedByPrincipalId,
      departmentId,
      originalName,
      storageKey,
      sha256,
      sizeBytes,
      declaredMime = null,
      metadata = {},
    }) {
      const key = text(uploadKey, 'uploadKey', { max: 125, pattern: /^upload:[a-z0-9][a-z0-9_.-]{1,118}$/ });
      const submitter = uuid(submittedByPrincipalId, 'submittedByPrincipalId');
      const department = uuid(departmentId, 'departmentId');
      const filename = text(originalName, 'originalName', { max: 255 });
      if (filename.includes('/') || filename.includes('\\')) fail('invalid_input', 'originalName must not contain a path.');
      const hash = text(sha256, 'sha256', { min: 64, max: 64, pattern: SHA256 });
      const storage = text(storageKey, 'storageKey', { min: 67, max: 67, pattern: /^[a-f0-9]{2}\/[a-f0-9]{64}$/ });
      const bytes = integer(sizeBytes, 'sizeBytes', { min: 1, max: 52_428_800 });
      const mime = declaredMime === null ? null : text(declaredMime, 'declaredMime', { max: 200 });
      jsonObject(metadata, 'metadata', 16_384);

      return transaction(pool, async (client) => {
        await requirePermission(
          client, submitter, department, PERMISSIONS.QUARANTINE_SUBMIT, now(), requirePolicyAssignment,
        );
        const result = await client.query(
          `
            INSERT INTO quarantine.uploads (
              upload_key, submitted_by_principal_id, owning_department_id,
              original_name, storage_key, sha256, size_bytes,
              declared_mime, status, metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'received', $9::jsonb)
            RETURNING id, upload_key, status, sha256, size_bytes, created_at
          `,
          [key, submitter, department, filename, storage, hash, bytes, mime, JSON.stringify(metadata)],
        );
        await appendAuditRow(client, {
          eventType: 'quarantine.upload_received',
          actorPrincipalId: submitter,
          departmentId: department,
          resourceType: 'quarantined_upload',
          resourceKey: key,
          payload: { sha256: hash, size_bytes: bytes, department_id: department },
        });
        return result.rows[0];
      });
    },

    async createCandidate({
      candidateKey,
      uploadId,
      producedByPrincipalId,
      submittedByPrincipalId,
      departmentId,
      sourceUploadSha256,
      candidateType,
      title,
      candidatePayload,
      evidence,
    }) {
      const key = text(candidateKey, 'candidateKey', {
        max: 125,
        pattern: /^candidate:[a-z0-9][a-z0-9_.-]{1,115}$/,
      });
      const upload = uuid(uploadId, 'uploadId');
      const producer = uuid(producedByPrincipalId, 'producedByPrincipalId');
      const submitter = uuid(submittedByPrincipalId, 'submittedByPrincipalId');
      const department = uuid(departmentId, 'departmentId');
      const sourceHash = text(sourceUploadSha256, 'sourceUploadSha256', {
        min: 64, max: 64, pattern: SHA256,
      });
      if (!CANDIDATE_TYPES.has(candidateType)) fail('invalid_input', 'candidateType is unsupported.');
      const candidateTitle = text(title, 'title', { max: 240 });
      jsonObject(candidatePayload, 'candidatePayload');
      const evidenceItems = jsonArray(evidence, 'evidence', { min: 1, max: 64 });

      return transaction(pool, async (client) => {
        await requirePermission(
          client, producer, department, PERMISSIONS.CANDIDATE_CREATE, now(), requirePolicyAssignment,
        );
        const uploadResult = await client.query(
          `
            SELECT upload.id, upload.submitted_by_principal_id,
                   upload.owning_department_id, upload.status, upload.sha256,
                   latest_scan.verdict AS latest_scan_verdict,
                   latest_scan.content_sha256 AS latest_scan_sha256
            FROM quarantine.uploads upload
            LEFT JOIN LATERAL (
              SELECT finding.verdict, finding.content_sha256
              FROM quarantine.scan_findings finding
              WHERE finding.upload_id = upload.id
              ORDER BY finding.scanned_at DESC, finding.created_at DESC, finding.id DESC
              LIMIT 1
            ) latest_scan ON true
            WHERE upload.id = $1 AND upload.owning_department_id = $2
              AND upload.submitted_by_principal_id = $3 AND upload.sha256 = $4
            FOR SHARE OF upload
          `,
          [upload, department, submitter, sourceHash],
        );
        const uploadRow = uploadResult.rows[0];
        if (!uploadRow || !['ready_for_review', 'approved_for_promotion'].includes(uploadRow.status)
            || uploadRow.latest_scan_verdict !== 'clean'
            || uploadRow.latest_scan_sha256 !== sourceHash) {
          fail('upload_not_ready', 'Upload is not ready for candidate extraction.');
        }
        const result = await client.query(
          `
            INSERT INTO quarantine.candidates (
              candidate_key, upload_id, owning_department_id,
              produced_by_principal_id, submitted_by_principal_id,
              source_upload_sha256, candidate_type, title,
              candidate_payload, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, 'review_pending')
            RETURNING id, candidate_key, candidate_type, title, content_hash,
                      submitted_by_principal_id, source_upload_sha256,
                      status, revision, created_at
          `,
          [
            key, upload, department, producer, submitter, sourceHash,
            candidateType, candidateTitle, JSON.stringify(candidatePayload),
          ],
        );
        const candidate = result.rows[0];
        for (const [index, item] of evidenceItems.entries()) {
          const record = jsonObject(item, `evidence[${index}]`, 4_096);
          const kind = text(record.evidence_kind, `evidence[${index}].evidence_kind`, { max: 40 });
          if (kind !== 'upload_text') {
            fail('invalid_input', `evidence[${index}] must cite the sealed upload text.`);
          }
          const ref = text(record.evidence_ref, `evidence[${index}].evidence_ref`, { max: 500 });
          if (ref !== `sha256:${sourceHash}`) {
            fail('invalid_input', `evidence[${index}].evidence_ref must match the sealed upload SHA-256.`);
          }
          const excerpt = text(record.excerpt, `evidence[${index}].excerpt`, { max: 2_000 });
          await client.query(
            `
              INSERT INTO quarantine.candidate_evidence (
                candidate_id, upload_id, evidence_kind, evidence_ref, excerpt
              ) VALUES ($1, $2, $3, $4, $5)
            `,
            [candidate.id, upload, kind, ref, excerpt],
          );
        }
        await appendAuditRow(client, {
          eventType: 'quarantine.candidate_created',
          actorPrincipalId: producer,
          departmentId: department,
          resourceType: 'candidate',
          resourceKey: key,
          payload: {
            upload_id: upload,
            submitted_by_principal_id: submitter,
            source_upload_sha256: sourceHash,
            content_hash: candidate.content_hash,
            status: candidate.status,
          },
        });
        return candidate;
      });
    },

    async promoteCandidateAsDraft({
      candidateId,
      architectPrincipalId,
      departmentId,
      expectedRevision,
      idempotencyKey = randomUUID(),
    }) {
      const candidate = uuid(candidateId, 'candidateId');
      const architect = uuid(architectPrincipalId, 'architectPrincipalId');
      const department = uuid(departmentId, 'departmentId');
      const revision = integer(expectedRevision, 'expectedRevision');
      const key = uuid(idempotencyKey, 'idempotencyKey');

      return transaction(pool, async (client) => {
        await requirePermission(
          client,
          architect,
          department,
          PERMISSIONS.CANDIDATE_PROMOTE_AS_DRAFT,
          now(),
          requirePolicyAssignment,
        );
        const scopeResult = await client.query(
          `SELECT id FROM quarantine.candidates
           WHERE id = $1 AND owning_department_id = $2`,
          [candidate, department],
        );
        if (!scopeResult.rows[0]) fail('candidate_not_found', 'Candidate not found.');
        const result = await client.query(
          `
            SELECT draft_id, draft_key, review_status, candidate_revision
            FROM governance.promote_candidate_to_draft($1, $2, $3, $4)
          `,
          [candidate, architect, revision, key],
        );
        const draft = result.rows[0];
        if (!draft || draft.review_status !== 'draft') {
          fail('promotion_failed', 'Promotion did not produce a governed draft.');
        }
        return draft;
      });
    },

    async reviewCandidate({
      candidateId,
      reviewerPrincipalId,
      departmentId,
      action,
      reason,
      expectedRevision,
    }) {
      const candidate = uuid(candidateId, 'candidateId');
      const reviewer = uuid(reviewerPrincipalId, 'reviewerPrincipalId');
      const department = uuid(departmentId, 'departmentId');
      if (!['approve_for_draft', 'reject'].includes(action)) {
        fail('invalid_input', 'action is unsupported.');
      }
      const reviewReason = text(reason, 'reason', { max: 2_000 });
      const revision = integer(expectedRevision, 'expectedRevision');

      return transaction(pool, async (client) => {
        await requirePermission(
          client, reviewer, department, PERMISSIONS.CANDIDATE_REVIEW, now(), requirePolicyAssignment,
        );
        const scopeResult = await client.query(
          `SELECT id FROM quarantine.candidates
           WHERE id = $1 AND owning_department_id = $2`,
          [candidate, department],
        );
        if (!scopeResult.rows[0]) fail('candidate_not_found', 'Candidate not found.');
        const result = await client.query(
          `SELECT candidate_id, status, revision
           FROM governance.record_candidate_review($1, $2, $3, $4, $5)`,
          [candidate, reviewer, action, reviewReason, revision],
        );
        if (!result.rows[0]) fail('review_failed', 'Candidate review did not produce a result.');
        await appendAuditRow(client, {
          eventType: 'governance.candidate_reviewed',
          actorPrincipalId: reviewer,
          departmentId: department,
          resourceType: 'candidate',
          resourceKey: candidate,
          outcome: 'allowed',
          payload: { action, status: result.rows[0].status, revision: result.rows[0].revision },
        });
        return result.rows[0];
      });
    },

    async suspendPrincipal({
      principalId,
      suspendedByPrincipalId,
      departmentId,
      reason,
    }) {
      const target = uuid(principalId, 'principalId');
      const actor = uuid(suspendedByPrincipalId, 'suspendedByPrincipalId');
      const department = uuid(departmentId, 'departmentId');
      const suspensionReason = text(reason, 'reason', { max: 2_000 });
      if (target === actor) fail('invalid_input', 'A principal cannot suspend itself.');

      return transaction(pool, async (client) => {
        await requirePermission(
          client, actor, department, PERMISSIONS.PRINCIPAL_SUSPEND, now(), requirePolicyAssignment,
        );
        const targetScope = await client.query(
          `SELECT 1 FROM identity.department_memberships
           WHERE principal_id = $1 AND department_id = $2
           LIMIT 1 FOR SHARE`,
          [target, department],
        );
        if (!targetScope.rows[0]) {
          fail('permission_denied', 'Suspension target is outside the authorized department.');
        }
        const result = await client.query(
          `
            UPDATE identity.principals
            SET status = 'suspended', suspended_at = now(), updated_at = now()
            WHERE id = $1 AND status IN ('draft', 'active')
            RETURNING id, principal_key, principal_kind, status, suspended_at
          `,
          [target],
        );
        const suspended = result.rows[0];
        if (!suspended) fail('principal_conflict', 'Principal is not active or draft.');
        await client.query(
          `UPDATE identity.department_memberships
           SET status = 'suspended', valid_to = coalesce(valid_to, now()), updated_at = now()
           WHERE principal_id = $1 AND status = 'active'`,
          [target],
        );
        await client.query(
          `UPDATE identity.runtime_bindings
           SET status = 'suspended', valid_to = coalesce(valid_to, now()), updated_at = now()
           WHERE principal_id = $1 AND status IN ('draft', 'active')`,
          [target],
        );
        await client.query(
          `UPDATE identity.broker_credentials
           SET status = 'suspended'
           WHERE principal_id = $1 AND status IN ('draft', 'active')`,
          [target],
        );
        await client.query(
          `UPDATE identity.policy_assignments
           SET status = 'suspended', valid_to = coalesce(valid_to, now()), updated_at = now()
           WHERE principal_id = $1 AND status = 'active'`,
          [target],
        );
        await client.query(
          `UPDATE governance.capability_grants
           SET status = 'suspended', valid_to = coalesce(valid_to, now()), updated_at = now()
           WHERE principal_id = $1 AND status IN ('draft', 'active')`,
          [target],
        );
        await client.query(
          `UPDATE identity.provisioning_jobs
           SET status = 'cancelled', finished_at = now(), revision = revision + 1,
               error_code = 'principal_suspended'
           WHERE principal_id = $1 AND status IN ('queued', 'confirmed')`,
          [target],
        );
        await appendAuditRow(client, {
          eventType: 'identity.principal_suspended',
          actorPrincipalId: actor,
          departmentId: department,
          resourceType: 'principal',
          resourceKey: suspended.principal_key,
          outcome: 'allowed',
          payload: { reason: suspensionReason },
        });
        return suspended;
      });
    },

    async appendAudit({
      eventType,
      actorPrincipalId,
      departmentId = null,
      resourceType,
      resourceKey,
      outcome = 'recorded',
      correlationKey = null,
      payload = {},
    }) {
      const type = text(eventType, 'eventType', { max: 120, pattern: SAFE_KEY });
      const actor = actorPrincipalId === null ? null : uuid(actorPrincipalId, 'actorPrincipalId');
      const department = departmentId === null ? null : uuid(departmentId, 'departmentId');
      const resource = text(resourceType, 'resourceType', { max: 80, pattern: SAFE_KEY });
      const resourceId = text(resourceKey, 'resourceKey', { max: 500 });
      if (!['allowed', 'denied', 'failed', 'recorded'].includes(outcome)) fail('invalid_input', 'outcome is unsupported.');
      const correlation = correlationKey === null
        ? null
        : text(correlationKey, 'correlationKey', { max: 200 });
      jsonObject(payload, 'payload');
      return transaction(pool, (client) => appendAuditRow(client, {
        eventType: type,
        actorPrincipalId: actor,
        departmentId: department,
        resourceType: resource,
        resourceKey: resourceId,
        outcome,
        correlationKey: correlation,
        payload,
      }));
    },

    async listAudit({
      departmentId,
      resourceType = null,
      resourceKey = null,
      actorPrincipalId = null,
      limit = 100,
    } = {}) {
      const department = uuid(departmentId, 'departmentId');
      const type = resourceType === null
        ? null
        : text(resourceType, 'resourceType', { max: 80, pattern: SAFE_KEY });
      const key = resourceKey === null ? null : text(resourceKey, 'resourceKey', { max: 500 });
      const actor = actorPrincipalId === null ? null : uuid(actorPrincipalId, 'actorPrincipalId');
      const boundedLimit = integer(limit, 'limit', { min: 1, max: 500 });
      const result = await pool.query(
        `
          SELECT event_key, event_type, actor_principal_id, department_id, workload_role,
                 resource_type, resource_key, outcome, correlation_key,
                 payload, occurred_at
          FROM audit.security_events
          WHERE department_id = $1
            AND ($2::text IS NULL OR resource_type = $2)
            AND ($3::text IS NULL OR resource_key = $3)
            AND ($4::uuid IS NULL OR actor_principal_id = $4)
          ORDER BY occurred_at DESC, id DESC
          LIMIT $5
        `,
        [department, type, key, actor, boundedLimit],
      );
      return result.rows;
    },
  };
}
