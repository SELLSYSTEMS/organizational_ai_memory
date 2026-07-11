import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import pg from 'pg';

const connectionString = process.env.OAM_INTEGRATION_DATABASE_URL;

function tokenHash(label) {
  return crypto.createHash('sha256').update(`${label}:${crypto.randomUUID()}`).digest('hex');
}

async function expectDatabaseError(client, work, code) {
  await client.query('SAVEPOINT expected_error');
  try {
    await work();
    assert.fail(`expected PostgreSQL error ${code}`);
  } catch (error) {
    assert.equal(error.code, code);
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT expected_error');
    await client.query('RELEASE SAVEPOINT expected_error');
  }
}

async function operatorContext(client, tokenSha256) {
  await client.query('SET LOCAL SESSION AUTHORIZATION oam_operator_api');
  await client.query('SELECT identity.establish_operator_context($1)', [tokenSha256]);
}

async function employeeContext(client, tokenSha256) {
  await client.query('SET LOCAL SESSION AUTHORIZATION oam_employee_api');
  await client.query('SELECT identity.establish_employee_context($1)', [tokenSha256]);
}

async function resetAuthorization(client) {
  await client.query('RESET SESSION AUTHORIZATION');
}

async function stagePhysicalProvisioning(client, bundle, architectId) {
  const job = await client.query(
    `INSERT INTO identity.provisioning_jobs (
       idempotency_key, principal_id, department_id, job_type,
       requested_by_principal_id, confirmed_by_principal_id,
       status, plan, confirmed_at, started_at, finished_at
     ) VALUES (
       $1, $2, $3, 'linux_identity', $4, $4,
       'succeeded', '{"operation":"provision_agent"}'::jsonb,
       now(), now(), now()
     ) RETURNING id`,
    [crypto.randomUUID(), bundle.agent.id, bundle.pair.department_id, architectId],
  );
  await client.query(
    `UPDATE identity.broker_credentials
     SET status = 'active',
         metadata = metadata || jsonb_build_object(
           'activation_job_id', $2::uuid,
           'bootstrap_unusable', false
         )
     WHERE principal_id = $1`,
    [bundle.agent.id, job.rows[0].id],
  );
  await client.query(
    `UPDATE identity.principals SET status = 'active', updated_at = now() WHERE id = $1`,
    [bundle.agent.id],
  );
  await client.query(
    `UPDATE identity.runtime_bindings SET status = 'active', updated_at = now()
     WHERE principal_id = $1 AND binding_kind = 'broker_client'`,
    [bundle.agent.id],
  );
  await client.query(
    `UPDATE governance.capability_grants SET status = 'active', updated_at = now()
     WHERE principal_id = $1`,
    [bundle.agent.id],
  );
}

test('v8 personal workspace is one-to-one, owner-only, versioned, brokered, and fail-closed', {
  skip: !connectionString,
  timeout: 30_000,
}, async () => {
  const client = new pg.Client({ connectionString });
  await client.connect();
  await client.query('BEGIN');
  try {
    const architect = await client.query(
      `SELECT credential.token_sha256, principal.id AS principal_id
       FROM identity.operator_context_credentials credential
       JOIN identity.principals principal ON principal.id = credential.principal_id
       WHERE credential.status = 'active'
         AND principal.principal_key = 'human:ai_architect'`,
    );
    assert.equal(architect.rowCount, 1);
    const suffix = crypto.randomUUID().replaceAll('-', '');
    const aliceWorkspaceHash = tokenHash('alice-workspace');
    const bobWorkspaceHash = tokenHash('bob-workspace');

    await operatorContext(client, architect.rows[0].token_sha256);
    const aliceResult = await client.query(
      `SELECT identity.onboard_employee_bundle(
         $1, $2, $3, $4, $5, $6, $7, now() + interval '1 day'
       ) AS data`,
      [
        `human:alice_${suffix}`, 'Alice Employee', `alice.${suffix}@example.com`,
        'Delivery Lead', `agent:alice_${suffix}`, 'Alice Personal Capability Agent',
        aliceWorkspaceHash,
      ],
    );
    const bobResult = await client.query(
      `SELECT identity.onboard_employee_bundle(
         $1, $2, $3, $4, $5, $6, $7, now() + interval '1 day'
       ) AS data`,
      [
        `human:bob_${suffix}`, 'Bob Employee', `bob.${suffix}@example.com`,
        'Quality Lead', `agent:bob_${suffix}`, 'Bob Personal Capability Agent',
        bobWorkspaceHash,
      ],
    );
    const alice = aliceResult.rows[0].data;
    const bob = bobResult.rows[0].data;
    assert.equal(alice.pair.status, 'draft');
    assert.equal(alice.agent.status, 'draft');
    assert.equal(alice.profile.revision, 1);
    assert.equal('token_sha256' in alice.workspace, false);

    await resetAuthorization(client);
    await client.query(
      `INSERT INTO identity.principals (
         principal_key, principal_kind, display_name, status
       ) VALUES ($1, 'agent', 'Second personal agent', 'draft')`,
      [`agent:second_${suffix}`],
    );
    const secondAgent = await client.query(
      `SELECT id FROM identity.principals WHERE principal_key = $1`,
      [`agent:second_${suffix}`],
    );
    await client.query(
      `INSERT INTO identity.department_memberships (
         principal_id, department_id, membership_role, status
       ) VALUES ($1, $2, 'member', 'active')`,
      [secondAgent.rows[0].id, alice.pair.department_id],
    );
    await expectDatabaseError(
      client,
      () => client.query(
        `INSERT INTO identity.employee_personal_agents (
           human_principal_id, agent_principal_id, department_id,
           status, created_by_principal_id
         ) VALUES ($1, $2, $3, 'draft', $4)`,
        [alice.human.id, secondAgent.rows[0].id, alice.pair.department_id,
          architect.rows[0].principal_id],
      ),
      '23505',
    );

    await stagePhysicalProvisioning(client, alice, architect.rows[0].principal_id);
    await stagePhysicalProvisioning(client, bob, architect.rows[0].principal_id);
    await operatorContext(client, architect.rows[0].token_sha256);
    const activatedAlice = await client.query(
      `SELECT identity.activate_employee_personal_agent($1) AS data`,
      [alice.agent.id],
    );
    await client.query(`SELECT identity.activate_employee_personal_agent($1)`, [bob.agent.id]);
    assert.equal(activatedAlice.rows[0].data.status, 'active');

    await employeeContext(client, aliceWorkspaceHash);
    const resolved = await client.query(
      `SELECT * FROM identity.resolve_employee_workspace_token($1)`,
      [aliceWorkspaceHash],
    );
    assert.equal(resolved.rows[0].principal_id, alice.human.id);
    assert.equal(resolved.rows[0].agent_id, alice.agent.id);
    const profile = await client.query(
      `SELECT personal.update_employee_profile(
         1, 'Delivery Lead', 'Builds reliable delivery systems',
         '["workflow design","quality assurance"]'::jsonb,
         'Evidence first', '["Reduce handoff loss"]'::jsonb,
         'Never expose client secrets'
       ) AS data`,
    );
    assert.equal(profile.rows[0].data.revision, 2);
    assert.match(profile.rows[0].data.content_sha256, /^[a-f0-9]{64}$/);
    assert.equal(profile.rows[0].data.agent_shared, false);
    const profileBeforeShare = await client.query(
      `SELECT personal.employee_agent_context('workflow design', 5) AS data`,
    );
    assert.equal(profileBeforeShare.rows[0].data.items.length, 0);
    const sharedProfile = await client.query(
      `SELECT personal.share_employee_profile(2) AS data`,
    );
    assert.equal(sharedProfile.rows[0].data.revision, 3);
    assert.equal(sharedProfile.rows[0].data.agent_shared, true);
    assert.equal(sharedProfile.rows[0].data.content_sha256,
      profile.rows[0].data.content_sha256);
    const profileContext = await client.query(
      `SELECT personal.employee_agent_context('workflow design', 5) AS data`,
    );
    assert.equal(profileContext.rows[0].data.items.length, 1);
    assert.equal(profileContext.rows[0].data.items[0].source_type, 'profile');
    assert.equal(profileContext.rows[0].data.citations[0].profile_id,
      sharedProfile.rows[0].data.id);
    const repeatedShare = await client.query(
      `SELECT personal.share_employee_profile(3) AS data`,
    );
    assert.equal(repeatedShare.rows[0].data.revision, 3);
    assert.equal('audit_event_key' in repeatedShare.rows[0].data, false);
    const unsharedProfile = await client.query(
      `SELECT personal.unshare_employee_profile(3) AS data`,
    );
    assert.equal(unsharedProfile.rows[0].data.revision, 4);
    assert.equal(unsharedProfile.rows[0].data.agent_shared, false);
    const resharedProfile = await client.query(
      `SELECT personal.share_employee_profile(4) AS data`,
    );
    assert.equal(resharedProfile.rows[0].data.revision, 5);
    const editedProfile = await client.query(
      `SELECT personal.update_employee_profile(
         5, 'Delivery Lead', 'Builds reliable delivery systems',
         '["workflow design","quality assurance"]'::jsonb,
         'Evidence first', '["Reduce handoff loss"]'::jsonb,
         'Never expose client secrets'
       ) AS data`,
    );
    assert.equal(editedProfile.rows[0].data.revision, 6);
    assert.equal(editedProfile.rows[0].data.agent_shared, false);
    const profileAfterEdit = await client.query(
      `SELECT personal.employee_agent_context('workflow design', 5) AS data`,
    );
    assert.equal(profileAfterEdit.rows[0].data.items.length, 0);

    const ownerOnlyResult = await client.query(
      `SELECT personal.create_employee_memory(
         'lesson', 'Private handoff lesson',
         'The private website handoff lesson must not reach the agent.',
         'Private retrospective', 'It identifies a private constraint.',
         '["Employee-authored private note"]'::jsonb,
         ARRAY['website','handoff'], 'private'
       ) AS data`,
    );
    const sharedResult = await client.query(
      `SELECT personal.create_employee_memory(
         'experience', 'Reliable website handoff',
         'Use a release checklist and record provenance before handoff.',
         'Multi-team website delivery', 'It made ownership and validation explicit.',
         '["Observed across three launches", {"source":"retrospective"}]'::jsonb,
         ARRAY['website','handoff'], 'private'
       ) AS data`,
    );
    const ownerOnly = ownerOnlyResult.rows[0].data;
    const shared = sharedResult.rows[0].data;
    assert.equal(ownerOnly.sharing_scope, 'owner_only');
    assert.equal(shared.sharing_scope, 'owner_only');

    const beforeShare = await client.query(
      `SELECT personal.employee_agent_context('website handoff', 5) AS data`,
    );
    assert.equal(beforeShare.rows[0].data.items.length, 0);
    const sharedState = await client.query(
      `SELECT personal.share_employee_memory($1, $2) AS data`,
      [shared.id, shared.current_revision],
    );
    assert.equal(sharedState.rows[0].data.agent_shared, true);
    assert.equal(sharedState.rows[0].data.revision, 2);
    const updated = await client.query(
      `SELECT personal.update_employee_memory(
         $1, 2, 'experience', 'Reliable website handoff',
         'Use a release checklist, cite evidence, and record provenance.',
         'Multi-team website delivery', 'It made ownership and validation explicit.',
         '["Observed across three launches"]'::jsonb,
         ARRAY['website','handoff'], 'private'
       ) AS data`,
      [shared.id],
    );
    assert.equal(updated.rows[0].data.revision, 3);
    assert.equal(updated.rows[0].data.agent_shared, false);
    assert.equal(updated.rows[0].data.sharing_scope, 'owner_only');
    const afterEdit = await client.query(
      `SELECT personal.employee_agent_context('website handoff', 5) AS data`,
    );
    assert.equal(afterEdit.rows[0].data.items.length, 0);
    const reshared = await client.query(
      `SELECT personal.share_employee_memory($1, 3) AS data`,
      [shared.id],
    );
    assert.equal(reshared.rows[0].data.revision, 4);
    assert.equal(reshared.rows[0].data.agent_shared, true);
    const employeeContextResult = await client.query(
      `SELECT personal.employee_agent_context('website handoff', 5) AS data`,
    );
    assert.equal(employeeContextResult.rows[0].data.items.length, 1);
    assert.equal(employeeContextResult.rows[0].data.items[0].id, shared.id);
    assert.equal(employeeContextResult.rows[0].data.items[0].revision, 4);
    assert.equal(employeeContextResult.rows[0].data.citations[0].content_sha256,
      updated.rows[0].data.content_sha256);
    const profileForBroker = await client.query(
      `SELECT personal.share_employee_profile(6) AS data`,
    );
    assert.equal(profileForBroker.rows[0].data.revision, 7);

    await resetAuthorization(client);
    const appendOnlyProfile = await client.query(
      `SELECT id FROM personal.employee_profile_versions
       WHERE human_principal_id = $1 ORDER BY revision DESC LIMIT 1`,
      [alice.human.id],
    );
    await expectDatabaseError(
      client,
      () => client.query(
        `UPDATE personal.employee_profile_versions
         SET profile_payload = profile_payload WHERE id = $1`,
        [appendOnlyProfile.rows[0].id],
      ),
      '55000',
    );
    const appendOnlyVersion = await client.query(
      `SELECT id FROM personal.employee_memory_versions
       WHERE memory_id = $1 ORDER BY revision DESC LIMIT 1`,
      [shared.id],
    );
    await expectDatabaseError(
      client,
      () => client.query(
        `DELETE FROM personal.employee_memory_versions WHERE id = $1`,
        [appendOnlyVersion.rows[0].id],
      ),
      '55000',
    );

    await employeeContext(client, bobWorkspaceHash);
    const crossEmployeeRead = await client.query(
      `SELECT count(*)::integer AS count
       FROM personal.employee_memory_items WHERE human_principal_id = $1`,
      [alice.human.id],
    );
    assert.equal(crossEmployeeRead.rows[0].count, 0);
    await expectDatabaseError(
      client,
      () => client.query(
        `SELECT personal.update_employee_memory(
           $1, 4, 'experience', 'Cross employee write', 'Denied', '', '',
           '[]'::jsonb, ARRAY['denied'], 'private'
         )`,
        [shared.id],
      ),
      'P0002',
    );

    await resetAuthorization(client);
    const aliceBroker = await client.query(
      `SELECT token_sha256 FROM identity.broker_credentials
       WHERE principal_id = $1 AND status = 'active' LIMIT 1`,
      [alice.agent.id],
    );
    const bobBroker = await client.query(
      `SELECT token_sha256 FROM identity.broker_credentials
       WHERE principal_id = $1 AND status = 'active' LIMIT 1`,
      [bob.agent.id],
    );
    await client.query('SET LOCAL SESSION AUTHORIZATION oam_broker_api');
    const brokerAllowed = await client.query(
      `SELECT personal.retrieve_agent_context_for_broker($1, $2, 'website handoff', 5) AS data`,
      [aliceBroker.rows[0].token_sha256, alice.agent.principal_key],
    );
    assert.equal(brokerAllowed.rows[0].data.authorization, 'allowed');
    assert.equal(brokerAllowed.rows[0].data.items.length, 1);
    assert.equal(brokerAllowed.rows[0].data.items[0].id, shared.id);
    const brokerProfile = await client.query(
      `SELECT personal.retrieve_agent_context_for_broker($1, $2, 'workflow design', 5) AS data`,
      [aliceBroker.rows[0].token_sha256, alice.agent.principal_key],
    );
    assert.equal(brokerProfile.rows[0].data.authorization, 'allowed');
    assert.equal(brokerProfile.rows[0].data.items.length, 1);
    assert.equal(brokerProfile.rows[0].data.items[0].source_type, 'profile');
    assert.equal(brokerProfile.rows[0].data.citations[0].profile_id,
      profileForBroker.rows[0].data.id);
    const otherAgentDenied = await client.query(
      `SELECT personal.retrieve_agent_context_for_broker($1, $2, 'website handoff', 5) AS data`,
      [bobBroker.rows[0].token_sha256, alice.agent.principal_key],
    );
    assert.deepEqual(otherAgentDenied.rows[0].data.items, []);
    assert.equal(otherAgentDenied.rows[0].data.authorization, 'denied');
    assert.equal('principal' in otherAgentDenied.rows[0].data, false);

    await resetAuthorization(client);
    await client.query(
      `UPDATE identity.principals
       SET status = 'suspended', suspended_at = now(), updated_at = now()
       WHERE id = $1`,
      [alice.human.id],
    );
    const suspended = await client.query(
      `SELECT pair.status AS pair_status, agent.status AS agent_status,
              workspace.status AS workspace_status
       FROM identity.employee_personal_agents pair
       JOIN identity.principals agent ON agent.id = pair.agent_principal_id
       JOIN identity.employee_workspace_credentials workspace
         ON workspace.human_principal_id = pair.human_principal_id
       WHERE pair.human_principal_id = $1`,
      [alice.human.id],
    );
    assert.deepEqual(suspended.rows[0], {
      pair_status: 'suspended',
      agent_status: 'suspended',
      workspace_status: 'revoked',
    });
    await client.query('SET LOCAL SESSION AUTHORIZATION oam_employee_api');
    await expectDatabaseError(
      client,
      () => client.query('SELECT identity.establish_employee_context($1)', [aliceWorkspaceHash]),
      '28000',
    );
    await resetAuthorization(client);
    await client.query('SET LOCAL SESSION AUTHORIZATION oam_broker_api');
    const suspendedBroker = await client.query(
      `SELECT personal.retrieve_agent_context_for_broker($1, $2, 'website handoff', 5) AS data`,
      [aliceBroker.rows[0].token_sha256, alice.agent.principal_key],
    );
    assert.equal(suspendedBroker.rows[0].data.authorization, 'denied');

    await resetAuthorization(client);
    await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
});
