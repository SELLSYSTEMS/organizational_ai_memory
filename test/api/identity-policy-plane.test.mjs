import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const compatibilitySql = await fs.readFile(
  new URL('../../sql/identity_policy_plane_v1.sql', import.meta.url),
  'utf8',
);
const sql = await fs.readFile(new URL('../../sql/identity_data_plane_v1.sql', import.meta.url), 'utf8');

test('policy plane has scoped immutable assignments and explicit deny records', () => {
  assert.match(sql, /CREATE TABLE identity\.policy_assignments/);
  assert.match(sql, /assignment_scope IN \('department', 'principal'\)/);
  assert.match(sql, /CREATE TABLE identity\.explicit_permission_denials/);
  assert.doesNotMatch(sql, /explicit_permission_allows/);
});

test('activated templates and their rules are protected by database triggers', () => {
  assert.match(sql, /activated policy templates are immutable/);
  assert.match(sql, /activated policy rules are immutable/);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON identity\.policy_templates/);
  assert.match(sql, /BEFORE INSERT OR UPDATE OR DELETE ON identity\.policy_template_rules/);
});

test('policy tables are not granted to PUBLIC or the public runtime', () => {
  assert.match(sql, /REVOKE ALL ON ALL TABLES IN SCHEMA identity, quarantine, governance, audit, oam_public FROM PUBLIC/);
  assert.doesNotMatch(sql, /GRANT[^;]*identity\.policy_assignments[^;]*TO oam_public_runtime/s);
  assert.doesNotMatch(sql, /GRANT[^;]*identity\.policy_assignments[^;]*TO oam_public_api/s);
});

test('policy compatibility migration checks the authoritative integrated migration without recreating tables', () => {
  assert.match(compatibilitySql, /Compatibility check only/);
  assert.match(compatibilitySql, /to_regclass\('identity\.policy_assignments'\)/);
  assert.doesNotMatch(compatibilitySql, /CREATE TABLE identity\.policy_assignments/);
});
