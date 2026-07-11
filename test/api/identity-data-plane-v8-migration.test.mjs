import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const migrationPath = new URL('../../sql/identity_data_plane_v8_personal_agents.sql', import.meta.url);

async function migration() {
  return fs.readFile(migrationPath, 'utf8');
}

test('v8 creates separate least-privilege employee and personal-memory roles', async () => {
  const sql = await migration();
  for (const role of ['oam_personal_memory_owner', 'oam_employee_runtime', 'oam_employee_api']) {
    assert.match(sql, new RegExp(`CREATE ROLE ${role}`));
  }
  assert.match(sql, /oam_personal_memory_owner[\s\S]+NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS/);
  assert.match(sql, /oam_employee_runtime[\s\S]+NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS/);
  assert.match(sql, /GRANT oam_employee_runtime TO oam_employee_api/);
  assert.match(sql, /REVOKE oam_operator_runtime, oam_broker_runtime, oam_public_runtime[\s\S]+FROM oam_employee_api/);
});

test('v8 makes the employee-personal-agent pair authoritative and one-to-one', async () => {
  const sql = await migration();
  assert.match(sql, /CREATE TABLE IF NOT EXISTS identity\.employee_personal_agents/);
  assert.match(sql, /human_principal_id uuid PRIMARY KEY/);
  assert.match(sql, /agent_principal_id uuid NOT NULL UNIQUE/);
  assert.match(sql, /personal agent pair requires one human and one agent/);
  assert.match(sql, /personal agent pair requires same-department memberships/);
  assert.match(sql, /personal agent requires one authoritative department/);
  assert.match(sql, /department_memberships_personal_agent_department_guard/);
  assert.match(sql, /DEFERRABLE INITIALLY DEFERRED/);
  assert.match(sql, /INSERT INTO identity\.principal_links[\s\S]+compatibility_projection/);
  assert.match(sql, /'authority', 'employee_personal_agents'/);
  assert.match(sql, /'permission_inheritance', false/);
  assert.match(sql, /FROM identity\.employee_personal_agents pair[\s\S]+ON CONFLICT \(source_principal_id, target_principal_id, link_kind\) DO UPDATE/);
  assert.doesNotMatch(sql, /CREATE UNIQUE INDEX[\s\S]+ON identity\.principal_links/);
});

test('workspace tokens are hash-only, revocable, expiring, and transaction-bound', async () => {
  const sql = await migration();
  assert.match(sql, /CREATE TABLE IF NOT EXISTS identity\.employee_workspace_credentials/);
  assert.match(sql, /token_sha256 text NOT NULL UNIQUE/);
  assert.match(sql, /CHECK \(token_sha256 ~ '\^\[a-f0-9\]\{64\}\$'\)/);
  assert.doesNotMatch(sql, /raw_token|token_plaintext|plaintext_token/);
  assert.match(sql, /FUNCTION identity\.resolve_employee_workspace_token\(p_token_sha256 text\)/);
  assert.match(sql, /FUNCTION identity\.establish_employee_context\(p_token_sha256 text\)/);
  assert.match(sql, /set_config\('oam\.employee_context_sha256', p_token_sha256, true\)/);
  assert.match(sql, /employee workspace authentication failed' USING ERRCODE = '28000'/);
});

test('personal profile and memory history is versioned, append-only, and private by default', async () => {
  const sql = await migration();
  for (const table of [
    'employee_profile_versions',
    'employee_memory_items',
    'employee_memory_versions',
    'employee_memory_events',
  ]) {
    assert.match(sql, new RegExp(`personal\\.${table}`));
    assert.match(sql, new RegExp(`ALTER TABLE personal\\.${table} FORCE ROW LEVEL SECURITY`));
  }
  assert.match(sql, /sharing_scope text NOT NULL DEFAULT 'owner_only'/);
  assert.match(sql, /agent_shared boolean GENERATED ALWAYS AS/);
  assert.match(sql, /owner_and_personal_agent/);
  assert.match(sql, /sensitivity IN \('private', 'restricted'\)/);
  assert.match(sql, /personal memory history is append-only/);
  assert.match(sql, /employee_profile_versions_append_only/);
  assert.match(sql, /employee_memory_versions_append_only/);
  assert.match(sql, /employee_memory_events_append_only/);
});

test('employee API functions use only current database context and exact bounded contracts', async () => {
  const sql = await migration();
  for (const signature of [
    'personal.employee_workspace()',
    'personal.update_employee_profile(bigint, text, text, jsonb, text, jsonb, text)',
    'personal.share_employee_profile(bigint)',
    'personal.unshare_employee_profile(bigint)',
    'personal.create_employee_memory(text, text, text, text, text, jsonb, text[], text)',
    'personal.update_employee_memory(uuid, bigint, text, text, text, text, text, jsonb, text[], text)',
    'personal.share_employee_memory(uuid, bigint)',
    'personal.unshare_employee_memory(uuid, bigint)',
    'personal.employee_agent_context(text, integer)',
  ]) {
    assert.match(sql, new RegExp(signature.replace(/[()[\].]/g, '\\$&')));
  }
  assert.match(sql, /memory_type IN \('experience', 'lesson', 'preference', 'skill', 'decision', 'pattern'\)/);
  assert.match(sql, /employee profile revision conflict' USING ERRCODE = '40001'/);
  assert.match(sql, /'sharing_reset', current_profile\.agent_shared/);
  assert.match(sql, /current_profile\.profile_payload, human_id/);
  assert.match(sql, /IF current_profile\.sharing_scope = p_sharing_scope THEN[\s\S]+RETURN current_profile\.profile_payload/);
  assert.match(sql, /'profile_shared'/);
  assert.match(sql, /'profile_unshared'/);
  assert.match(sql, /employee memory revision conflict' USING ERRCODE = '40001'/);
  assert.match(sql, /memory evidence must contain bounded strings or objects/);
  assert.match(sql, /Consent is revision-bound[\s\S]+next_sharing := 'owner_only'/);
  assert.match(sql, /'sharing_reset', previous_sharing = 'owner_and_personal_agent'/);
});

test('agent retrieval requires active physical authorization and returns citations only for shared current versions', async () => {
  const sql = await migration();
  assert.match(sql, /FUNCTION identity\.personal_agent_pair_is_active/);
  assert.match(sql, /SECURITY DEFINER[\s\S]+pair\.human_principal_id = p_human_principal_id/);
  assert.match(sql, /NOT identity\.personal_agent_pair_is_active\(/);
  assert.match(sql, /FUNCTION personal\.retrieve_agent_context_for_broker/);
  assert.match(sql, /session_user = 'oam_broker_api'/);
  assert.match(sql, /pair\.status = 'active'/);
  assert.match(sql, /capability_grant\.capability_task_key = 'personal_context_retrieval'/);
  assert.match(sql, /job\.status = 'succeeded'/);
  assert.match(sql, /item\.sharing_scope = 'owner_and_personal_agent'/);
  assert.match(sql, /profile\.sharing_scope = 'owner_and_personal_agent'/);
  assert.match(sql, /profile\.revision = \([\s\S]+max\(current_profile\.revision\)/);
  assert.match(sql, /version\.revision = item\.current_revision/);
  assert.match(sql, /plainto_tsquery\('simple', normalized_query\)/);
  assert.match(sql, /'citation', jsonb_build_object/);
  assert.match(sql, /'source_type', 'memory'[\s\S]+'memory_id', item\.id/);
  assert.match(sql, /'source_type', 'profile'[\s\S]+'profile_id', profile\.id/);
  assert.match(sql, /'content_sha256', profile\.content_sha256/);
});

test('onboarding remains draft until an explicit post-provisioning activation', async () => {
  const sql = await migration();
  assert.match(sql, /FUNCTION identity\.onboard_employee_bundle/);
  assert.match(sql, /NOT identity\.operator_can_onboard_employee/);
  assert.match(sql, /VALUES \(human_id, agent_id, department_id, 'draft', actor_id\)/);
  assert.match(sql, /'personal_context_retrieval'[\s\S]+ARRAY\['approved'\]::text\[\], 'draft'/);
  assert.match(sql, /FUNCTION identity\.activate_employee_personal_agent/);
  assert.match(sql, /physical personal agent provisioning is incomplete/);
  assert.match(sql, /UPDATE identity\.employee_personal_agents[\s\S]+SET status = 'active'/);
});

test('suspension revokes both personal-agent authority and workspace authentication', async () => {
  const sql = await migration();
  assert.match(sql, /FUNCTION identity\.cascade_employee_personal_agent_suspension/);
  assert.match(sql, /UPDATE identity\.employee_personal_agents pair[\s\S]+SET status = terminal_status/);
  assert.match(sql, /UPDATE identity\.employee_workspace_credentials credential[\s\S]+SET status = 'revoked'/);
  assert.match(sql, /principals_personal_agent_suspension/);
});
