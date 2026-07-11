import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import pg from 'pg';

const connectionString = process.env.OAM_INTEGRATION_DATABASE_URL;

async function connectedClient() {
  const client = new pg.Client({ connectionString });
  await client.connect();
  return client;
}

async function asRole(role) {
  const client = await connectedClient();
  await client.query(`SET SESSION AUTHORIZATION ${role}`);
  return client;
}

test('real PostgreSQL operator context is fail-closed and keeps broker/public paths available', {
  skip: !connectionString,
}, async () => {
  const admin = await connectedClient();
  let contexts;
  try {
    const result = await admin.query(
      `SELECT credential.token_sha256,
              principal.id AS principal_id,
              principal.principal_key,
              department.id AS department_id,
              department.department_key,
              membership.membership_role
       FROM identity.operator_context_credentials credential
       JOIN identity.principals principal ON principal.id = credential.principal_id
       JOIN identity.departments department ON department.id = credential.department_id
       JOIN identity.department_memberships membership
         ON membership.principal_id = principal.id
        AND membership.department_id = department.id
       WHERE credential.status = 'active'
         AND principal.principal_key IN ('human:ai_architect', 'human:capability_reviewer')
       ORDER BY principal.principal_key`,
    );
    contexts = new Map(result.rows.map((row) => [row.principal_key, row]));
  } finally {
    await admin.end();
  }

  const architect = contexts.get('human:ai_architect');
  const reviewer = contexts.get('human:capability_reviewer');
  assert.ok(architect, 'architect database context is not seeded');
  assert.ok(reviewer, 'reviewer database context is not seeded');

  const unbound = await asRole('oam_operator_api');
  try {
    const hidden = await unbound.query(
      `SELECT
         (SELECT count(*)::integer FROM identity.departments) AS departments,
         (SELECT count(*)::integer FROM identity.principals) AS principals,
         (SELECT count(*)::integer FROM identity.department_memberships) AS memberships,
         (SELECT count(*)::integer FROM identity.policy_templates) AS templates,
         (SELECT count(*)::integer FROM quarantine.candidates) AS candidates,
         (SELECT count(*)::integer FROM audit.security_events) AS audit_events`,
    );
    assert.deepEqual(hidden.rows[0], {
      departments: 0,
      principals: 0,
      memberships: 0,
      templates: 0,
      candidates: 0,
      audit_events: 0,
    });
    await assert.rejects(
      unbound.query('SELECT token_sha256 FROM identity.operator_context_credentials'),
      (error) => error.code === '42501',
    );

    await unbound.query('BEGIN');
    let insertError = null;
    try {
      await unbound.query(
        `INSERT INTO identity.principals (
           principal_key, principal_kind, display_name, status
         ) VALUES ($1, 'human', 'Unbound integration probe', 'draft')`,
        [`human:unbound_${crypto.randomUUID()}`],
      );
    } catch (error) {
      insertError = error;
    }
    await unbound.query('ROLLBACK');
    assert.equal(insertError?.code, '42501', 'an unbound operator inserted a protected row');

    await unbound.query('BEGIN');
    let policyInsertError = null;
    try {
      await unbound.query(
        `INSERT INTO identity.policy_templates (
           template_key, version, title, description, status
         ) VALUES ($1, 1, 'Unbound policy probe', 'Must be denied.', 'draft')`,
        [`unbound_${crypto.randomUUID().replaceAll('-', '')}`],
      );
    } catch (error) {
      policyInsertError = error;
    }
    await unbound.query('ROLLBACK');
    assert.equal(policyInsertError?.code, '42501', 'an unbound operator inserted a policy definition');
  } finally {
    await unbound.end();
  }

  const bound = await connectedClient();
  try {
    await bound.query('BEGIN');
    await bound.query(
      `INSERT INTO identity.departments (department_key, display_name, status)
       VALUES ('operator_context_foreign_probe', 'Foreign context probe', 'active')`,
    );
    const foreignPrincipal = await bound.query(
      `INSERT INTO identity.principals (principal_key, principal_kind, display_name, status)
       VALUES ($1, 'human', 'Foreign context probe', 'active')
       RETURNING id`,
      [`human:foreign_${crypto.randomUUID()}`],
    );
    await bound.query(
      `INSERT INTO identity.department_memberships (
         principal_id, department_id, membership_role, status
       )
       SELECT $1, id, 'member', 'active'
       FROM identity.departments
       WHERE department_key = 'operator_context_foreign_probe'`,
      [foreignPrincipal.rows[0].id],
    );

    await bound.query('SET SESSION AUTHORIZATION oam_operator_api');
    await bound.query('SELECT identity.establish_operator_context($1)', [architect.token_sha256]);
    const scoped = await bound.query(
      `SELECT
         identity.current_operator_principal_id() AS principal_id,
         identity.current_operator_department_id() AS department_id,
         (SELECT count(*)::integer FROM identity.departments) AS visible_departments,
         (SELECT count(*)::integer FROM identity.departments
          WHERE department_key = 'operator_context_foreign_probe') AS foreign_departments,
         (SELECT count(*)::integer FROM identity.principals
          WHERE id = $1) AS foreign_principals`,
      [foreignPrincipal.rows[0].id],
    );
    assert.equal(scoped.rows[0].principal_id, architect.principal_id);
    assert.equal(scoped.rows[0].department_id, architect.department_id);
    assert.equal(scoped.rows[0].visible_departments, 1);
    assert.equal(scoped.rows[0].foreign_departments, 0);
    assert.equal(scoped.rows[0].foreign_principals, 0);
    const foreignUpdate = await bound.query(
      `UPDATE identity.principals
       SET display_name = 'Cross-department mutation'
       WHERE id = $1
       RETURNING id`,
      [foreignPrincipal.rows[0].id],
    );
    assert.equal(foreignUpdate.rowCount, 0);
    await assert.rejects(
      bound.query(
        `INSERT INTO identity.principal_links (
           source_principal_id, target_principal_id, link_kind
         ) VALUES ($1, $2, 'reports_to')`,
        [architect.principal_id, foreignPrincipal.rows[0].id],
      ),
      (error) => error.code === '42501',
      'a bound operator linked a local principal to a foreign department principal',
    );
    await bound.query('ROLLBACK');
  } finally {
    await bound.end();
  }

  const suspendedDepartment = await connectedClient();
  try {
    await suspendedDepartment.query('BEGIN');
    await suspendedDepartment.query(
      `UPDATE identity.departments SET status = 'suspended' WHERE id = $1`,
      [architect.department_id],
    );
    await suspendedDepartment.query('SET SESSION AUTHORIZATION oam_operator_api');
    await assert.rejects(
      suspendedDepartment.query(
        'SELECT identity.establish_operator_context($1)',
        [architect.token_sha256],
      ),
      (error) => error.code === '42501' && /operator database context denied/.test(error.message),
    );
    await suspendedDepartment.query('ROLLBACK');
  } finally {
    await suspendedDepartment.end();
  }

  const demotedOperator = await connectedClient();
  try {
    await demotedOperator.query('BEGIN');
    const demoted = await demotedOperator.query(
      `UPDATE identity.department_memberships
       SET membership_role = 'member'
       WHERE principal_id = $1 AND department_id = $2
         AND membership_role = 'architect'`,
      [architect.principal_id, architect.department_id],
    );
    assert.equal(demoted.rowCount, 1, 'architect membership fixture is missing');
    await demotedOperator.query('SET SESSION AUTHORIZATION oam_operator_api');
    await assert.rejects(
      demotedOperator.query(
        'SELECT identity.establish_operator_context($1)',
        [architect.token_sha256],
      ),
      (error) => error.code === '42501' && /operator database context denied/.test(error.message),
    );
    await demotedOperator.query('ROLLBACK');
  } finally {
    await demotedOperator.end();
  }

  const appendOnly = await connectedClient();
  try {
    await appendOnly.query('BEGIN');
    const job = await appendOnly.query(
      `INSERT INTO identity.provisioning_jobs (
         idempotency_key, principal_id, department_id, job_type,
         requested_by_principal_id, status, plan
       ) VALUES ($1, $2, $3, 'logical_principal', $2, 'queued', '{}'::jsonb)
       RETURNING id`,
      [crypto.randomUUID(), architect.principal_id, architect.department_id],
    );
    const event = await appendOnly.query(
      `INSERT INTO identity.provisioning_events (
         job_id, event_type, actor_principal_id, to_status, payload
       ) VALUES ($1, 'queued', $2, 'queued', '{}'::jsonb)
       RETURNING id`,
      [job.rows[0].id, architect.principal_id],
    );
    const proof = await appendOnly.query(
      `INSERT INTO identity.proof_runs (
         proof_key, target_kind, target_key, status, commands, evidence,
         recorded_by_principal_id, department_id, executed_at
       ) VALUES ($1, 'principal', $2, 'passed', '[{"probe":"immutability"}]'::jsonb,
                 '{}'::jsonb, $3, $4, now())
       RETURNING id`,
      [`integration.immutability:${crypto.randomUUID()}`, architect.principal_id,
        architect.principal_id,
        architect.department_id],
    );

    for (const [table, assignment, id] of [
      ['identity.provisioning_events', 'payload = payload', event.rows[0].id],
      ['identity.proof_runs', 'evidence = evidence', proof.rows[0].id],
    ]) {
      await appendOnly.query('SAVEPOINT owner_mutation_probe');
      await assert.rejects(
        appendOnly.query(`UPDATE ${table} SET ${assignment} WHERE id = $1`, [id]),
        (error) => error.code === '55000' && /append-only/.test(error.message),
        `${table} accepted an owner-path mutation`,
      );
      await appendOnly.query('ROLLBACK TO SAVEPOINT owner_mutation_probe');
    }

    const privileges = await appendOnly.query(
      `SELECT
         has_table_privilege('oam_operator_api', 'identity.provisioning_events', 'UPDATE')
           AS events_update,
         has_table_privilege('oam_operator_api', 'identity.proof_runs', 'UPDATE')
           AS proofs_update`,
    );
    assert.deepEqual(privileges.rows[0], {
      events_update: false,
      proofs_update: false,
    });
    await appendOnly.query('ROLLBACK');
  } finally {
    await appendOnly.end();
  }

  const wrongPromoter = await asRole('oam_operator_api');
  try {
    await wrongPromoter.query('BEGIN');
    await wrongPromoter.query(
      'SELECT identity.establish_operator_context($1)',
      [reviewer.token_sha256],
    );
    const candidate = await wrongPromoter.query(
      `SELECT id, revision FROM quarantine.candidates
       ORDER BY created_at DESC LIMIT 1`,
    );
    assert.ok(candidate.rows[0], 'candidate fixture is required for the actor-binding probe');
    await assert.rejects(
      wrongPromoter.query(
        `SELECT * FROM governance.promote_candidate_to_draft($1, $2, $3, $4)`,
        [candidate.rows[0].id, architect.principal_id, candidate.rows[0].revision, crypto.randomUUID()],
      ),
      (error) => error.code === '42501' && /database-bound architect identity mismatch/.test(error.message),
    );
    await wrongPromoter.query('ROLLBACK');
  } finally {
    await wrongPromoter.end();
  }

  const broker = await asRole('oam_broker_api');
  try {
    const result = await broker.query(
      `SELECT
         (SELECT count(*) FROM identity.principals) > 0 AS principals_visible,
         (SELECT count(*) FROM identity.department_memberships) > 0 AS memberships_visible,
         (SELECT count(*) FROM oam_public.capability_assets) > 0 AS assets_visible`,
    );
    assert.deepEqual(result.rows[0], {
      principals_visible: true,
      memberships_visible: true,
      assets_visible: true,
    });
    await broker.query('BEGIN');
    const audit = await broker.query(
      `SELECT audit.record_broker_interaction(
         NULL, 'denied', 'website_delivery_handoff', 'operator-context-integration',
         '{"reason":"integration_probe"}'::jsonb
       ) IS NOT NULL AS recorded`,
    );
    assert.equal(audit.rows[0].recorded, true);
    await broker.query('ROLLBACK');
  } finally {
    await broker.end();
  }

  const publicClient = await asRole('oam_public_api');
  try {
    const result = await publicClient.query(
      `SELECT count(*) > 0 AS assets_visible FROM oam_public.capability_assets`,
    );
    assert.equal(result.rows[0].assets_visible, true);
    await publicClient.query('BEGIN');
    const audit = await publicClient.query(
      `SELECT audit.record_public_interaction(
         'public_retrieval', 'capability_search', 'operator-context-integration',
         'recorded', 'operator-context-integration', '{"probe":true}'::jsonb
       ) IS NOT NULL AS recorded`,
    );
    assert.equal(audit.rows[0].recorded, true);
    await publicClient.query('ROLLBACK');
  } finally {
    await publicClient.end();
  }
});
