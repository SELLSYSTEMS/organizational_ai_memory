import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { createIdentityDataPlane } from '../../app/lib/identity-data-plane.mjs';
import { createMemoryBrokerRepository } from '../../app/lib/memory-broker-repository.mjs';
import { createOperatorRepository } from '../../app/lib/operator-repository.mjs';

const connectionString = process.env.OAM_INTEGRATION_DATABASE_URL;

test('real PostgreSQL broker fails closed across identity, sponsor, assignment, and denial dimensions', {
  skip: !connectionString,
}, async (t) => {
  const pool = new pg.Pool({ connectionString, max: 2 });
  t.after(() => pool.end());
  const plane = createIdentityDataPlane({ pool });
  const operatorRepository = createOperatorRepository(pool);
  const broker = createMemoryBrokerRepository(pool);
  const seed = (await pool.query(
    `SELECT architect.id AS architect_id, reviewer.id AS reviewer_id,
            department.id AS department_id
     FROM identity.principals architect
     JOIN identity.principals reviewer ON reviewer.principal_key = 'human:capability_reviewer'
     JOIN identity.departments department ON department.department_key = 'digital_delivery'
     WHERE architect.principal_key = 'human:ai_architect'`,
  )).rows[0];
  const policy = await operatorRepository.activeAgentPolicy();
  const token = crypto.randomBytes(32).toString('base64url');
  const principalUuid = crypto.randomUUID();
  const agent = await plane.createLinkedAgentCredentialDraft({
    principalKey: `agent:${principalUuid}`,
    displayName: 'Broker Integration Agent',
    ownerPrincipalId: seed.architect_id,
    requestedByPrincipalId: seed.architect_id,
    departmentId: seed.department_id,
    tokenSha256: crypto.createHash('sha256').update(token).digest('hex'),
    policyTemplateKey: policy.template_key,
    policyTemplateVersion: policy.version,
    policyHash: policy.policy_hash,
  });
  await pool.query(`UPDATE identity.principals SET status = 'active' WHERE id = $1`, [agent.id]);
  await pool.query(
    `UPDATE identity.runtime_bindings SET status = 'active'
     WHERE principal_id = $1 AND binding_kind = 'broker_client'`,
    [agent.id],
  );
  await pool.query(
    `UPDATE identity.broker_credentials SET status = 'active' WHERE principal_id = $1`,
    [agent.id],
  );
  await pool.query(
    `UPDATE governance.capability_grants SET status = 'active' WHERE principal_id = $1`,
    [agent.id],
  );
  const activationJob = (await pool.query(
    `INSERT INTO identity.provisioning_jobs (
       idempotency_key, principal_id, department_id, job_type,
       requested_by_principal_id, confirmed_by_principal_id,
       status, plan, confirmed_at, started_at, finished_at, revision
     ) VALUES (
       $1, $2, $3, 'runtime_binding', $4, $4, 'succeeded',
       $5::jsonb, now(), now(), now(), 3
     ) RETURNING id`,
    [
      crypto.randomUUID(), agent.id, seed.department_id, seed.architect_id,
      JSON.stringify({ operation: 'integration_activation', plan_id: crypto.randomUUID() }),
    ],
  )).rows[0];
  await pool.query(
    `UPDATE identity.broker_credentials
     SET metadata = metadata || jsonb_build_object('activation_job_id', $2::text)
     WHERE principal_id = $1`,
    [agent.id, activationJob.id],
  );

  const input = {
    tokenSha256: crypto.createHash('sha256').update(token).digest('hex'),
    claimedPrincipalKey: agent.principal_key,
    correlationKey: crypto.randomUUID(),
  };
  const positive = await broker.approvedWebsiteCapability(input);
  assert.equal(positive.authorization.principal_key, agent.principal_key);
  assert.equal(positive.authorization.sponsor_principal_key, 'human:ai_architect');
  assert.equal(positive.capability.governance.review_status, 'approved');
  assert.ok(positive.capability.source_turn_ids.length > 0);

  const assignment = agent.policy_assignments[0];
  await pool.query(
    `UPDATE identity.policy_assignments
     SET status = 'suspended', valid_to = now(), updated_at = now() WHERE id = $1`,
    [assignment.id],
  );
  await assert.rejects(broker.approvedWebsiteCapability(input), (error) => error.code === 'authentication_failed');
  await pool.query(
    `UPDATE identity.policy_assignments
     SET status = 'active', valid_from = now(), valid_to = NULL, updated_at = now() WHERE id = $1`,
    [assignment.id],
  );

  const sponsorAssignment = (await pool.query(
    `SELECT assignment.id
     FROM identity.policy_assignments assignment
     WHERE assignment.principal_id = $1 AND assignment.department_id = $2
       AND assignment.status = 'active'`,
    [seed.architect_id, seed.department_id],
  )).rows[0];
  await pool.query(
    `UPDATE identity.policy_assignments
     SET status = 'suspended', valid_to = now(), updated_at = now() WHERE id = $1`,
    [sponsorAssignment.id],
  );
  await assert.rejects(broker.approvedWebsiteCapability(input), (error) => error.code === 'authentication_failed');
  await pool.query(
    `UPDATE identity.policy_assignments
     SET status = 'active', valid_from = now(), valid_to = NULL, updated_at = now() WHERE id = $1`,
    [sponsorAssignment.id],
  );

  const emptyTemplateKey = `empty_sponsor_${crypto.randomUUID().replaceAll('-', '')}`;
  const emptyTemplate = (await pool.query(
    `INSERT INTO identity.policy_templates (
       template_key, version, title, description, status, created_by_principal_id
     ) VALUES ($1, 1, 'Empty sponsor proof', 'Active template with no department read allow.',
               'draft', $2)
     RETURNING id`,
    [emptyTemplateKey, seed.architect_id],
  )).rows[0];
  await pool.query(
    `UPDATE identity.policy_templates SET status = 'active', activated_at = now() WHERE id = $1`,
    [emptyTemplate.id],
  );
  await pool.query(
    `UPDATE identity.policy_assignments
     SET status = 'suspended', valid_to = now(), updated_at = now() WHERE id = $1`,
    [sponsorAssignment.id],
  );
  const emptyAssignment = (await pool.query(
    `INSERT INTO identity.policy_assignments (
       assignment_key, assignment_scope, principal_id, department_id,
       template_id, status, assigned_by_principal_id, reason
     ) VALUES ($1, 'principal', $2, $3, $4, 'active', $2, 'Missing sponsor allow proof')
     RETURNING id`,
    [`assignment:${crypto.randomUUID()}`, seed.architect_id, seed.department_id, emptyTemplate.id],
  )).rows[0];
  await assert.rejects(broker.approvedWebsiteCapability(input), (error) => error.code === 'authentication_failed');
  await pool.query(
    `UPDATE identity.policy_assignments
     SET status = 'retired', valid_to = now(), updated_at = now() WHERE id = $1`,
    [emptyAssignment.id],
  );
  await pool.query(
    `UPDATE identity.policy_assignments
     SET status = 'active', valid_from = now(), valid_to = NULL, updated_at = now() WHERE id = $1`,
    [sponsorAssignment.id],
  );

  for (const [principalId, permission, suffix] of [
    [agent.id, 'memory.department.read', 'agent'],
    [seed.architect_id, 'memory.department.read', 'sponsor'],
  ]) {
    const denialKey = `deny:${crypto.randomUUID()}`;
    await pool.query(
      `INSERT INTO identity.explicit_permission_denials (
         denial_key, principal_id, department_id, permission_key,
         recorded_by_principal_id, reason
       ) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (principal_id, department_id, permission_key) DO UPDATE
         SET denial_key = EXCLUDED.denial_key, status = 'active',
             valid_from = now(), valid_to = NULL, updated_at = now(),
             recorded_by_principal_id = EXCLUDED.recorded_by_principal_id,
             reason = EXCLUDED.reason`,
      [denialKey, principalId, seed.department_id, permission, seed.architect_id, `${suffix} denial proof`],
    );
    await assert.rejects(broker.approvedWebsiteCapability(input), (error) => error.code === 'authentication_failed');
    await pool.query(
      `UPDATE identity.explicit_permission_denials
       SET status = 'retired', valid_to = now(), updated_at = now() WHERE denial_key = $1`,
      [denialKey],
    );
  }

  await pool.query(
    `INSERT INTO identity.principal_links (
       source_principal_id, target_principal_id, link_kind, status, metadata
     ) VALUES ($1, $2, 'linked_agent', 'active', '{"permission_inheritance":false}'::jsonb)`,
    [seed.reviewer_id, agent.id],
  );
  await assert.rejects(broker.approvedWebsiteCapability(input), (error) => error.code === 'authentication_failed');
  await pool.query(
    `UPDATE identity.principal_links SET status = 'retired'
     WHERE source_principal_id = $1 AND target_principal_id = $2 AND link_kind = 'linked_agent'`,
    [seed.reviewer_id, agent.id],
  );

  const deniedAudit = await pool.query(
    `SELECT count(*)::integer AS count FROM audit.security_events
     WHERE event_type = 'broker.capability_retrieval'
       AND resource_key = 'website_delivery_handoff'
       AND outcome = 'denied'`,
  );
  assert.ok(deniedAudit.rows[0].count >= 6);
});
