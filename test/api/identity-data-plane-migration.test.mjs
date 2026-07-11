import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const migrationPath = new URL('../../sql/identity_data_plane_v1.sql', import.meta.url);
const eligibilityUpgradePath = new URL('../../sql/identity_data_plane_v2_public_asset_eligibility.sql', import.meta.url);
const captureUpgradePath = new URL('../../sql/identity_data_plane_v3_capture_integrity.sql', import.meta.url);
const provisioningScopeUpgradePath = new URL('../../sql/identity_data_plane_v4_provisioning_scope.sql', import.meta.url);
const auditScopeUpgradePath = new URL('../../sql/identity_data_plane_v5_audit_scope.sql', import.meta.url);
const securityReviewUpgradePath = new URL('../../sql/identity_data_plane_v6_security_review.sql', import.meta.url);
const operatorContextUpgradePath = new URL('../../sql/identity_data_plane_v7_operator_context.sql', import.meta.url);
const rollbackPath = new URL('../../sql/identity_data_plane_v1_rollback.sql', import.meta.url);

async function migration() {
  return fs.readFile(migrationPath, 'utf8');
}

test('public database identity is disabled by default and cannot inherit owner power', async () => {
  const sql = await migration();

  assert.match(sql, /CREATE ROLE oam_public_api\s+NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS/);
  assert.match(sql, /CREATE ROLE oam_security_owner\s+NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS/);
  assert.doesNotMatch(sql, /GRANT\s+oam_security_owner\s+TO\s+oam_public_api/i);
  assert.match(sql, /REVOKE ALL ON ALL TABLES IN SCHEMA memory FROM oam_public_runtime, oam_public_api/);
  assert.match(sql, /REVOKE ALL ON ALL SEQUENCES IN SCHEMA memory FROM oam_public_runtime, oam_public_api/);
});

test('public views retain every fixed scope dimension and use security barriers', async () => {
  const sql = await migration();

  assert.match(sql, /WITH \(security_barrier = true\)/);
  for (const required of [
    'aihackathon_public_safe_asset_pack_2026_07_10',
    'oam_public_capability_assets_v1',
    'sell_systems_hackathon_demo',
    'public_demo',
    'public_safe',
    'approved_for_public_demo',
  ]) {
    assert.match(sql, new RegExp(required));
  }
  assert.match(sql, /GRANT SELECT ON ALL TABLES IN SCHEMA oam_public TO oam_public_runtime/);
  assert.doesNotMatch(sql, /GRANT SELECT ON ALL TABLES IN SCHEMA memory TO oam_public_runtime/);
});

test('public capability views require an explicit sanitized asset decision', async () => {
  const [base, upgrade] = await Promise.all([
    migration(),
    fs.readFile(eligibilityUpgradePath, 'utf8'),
  ]);
  for (const sql of [base, upgrade]) {
    assert.match(sql, /asset\.review_status = 'approved'/);
    assert.match(sql, /"public_demo_eligible":true/);
    assert.match(sql, /"publication_decision":"approved_for_public_demo"/);
    assert.match(sql, /"source_classification":"public_safe"/);
    assert.match(sql, /JOIN oam_public\.capability_assets asset[\s\S]+asset\.id = evidence\.asset_id/);
    assert.match(sql, /JOIN oam_public\.capability_assets asset[\s\S]+asset\.id = recommendation\.asset_id/);
  }
});

test('security-definer functions use fixed search paths and are revoked from PUBLIC', async () => {
  const sql = await migration();

  assert.match(sql, /FUNCTION governance\.promote_candidate_to_draft[\s\S]+SECURITY DEFINER[\s\S]+SET search_path = pg_catalog, identity, quarantine, governance/);
  assert.match(sql, /FUNCTION audit\.record_public_interaction[\s\S]+SECURITY DEFINER[\s\S]+SET search_path = pg_catalog, audit/);
  assert.match(sql, /REVOKE ALL ON FUNCTION governance\.promote_candidate_to_draft/);
  assert.match(sql, /REVOKE ALL ON FUNCTION audit\.record_public_interaction/);
});

test('promotion creates a staging draft and never writes canonical memory', async () => {
  const sql = await migration();

  assert.match(sql, /CREATE TABLE governance\.promotion_drafts/);
  assert.match(sql, /CHECK \(review_status = 'draft'\)/);
  assert.match(sql, /active human architect membership required/);
  assert.match(sql, /independent reviewer approval required/);
  assert.match(sql, /clean hash-verified upload approval required/);
  assert.doesNotMatch(sql, /INSERT INTO memory\./);
});

test('capture review binds sealed source, latest scan, and approved content hash', async () => {
  const [base, upgrade] = await Promise.all([
    migration(),
    fs.readFile(captureUpgradePath, 'utf8'),
  ]);
  for (const sql of [base, upgrade]) {
    assert.match(sql, /submitted_by_principal_id/);
    assert.match(sql, /source_upload_sha256/);
    assert.match(sql, /approved_content_hash/);
    assert.match(sql, /candidate_content_hash/);
    assert.match(sql, /ORDER BY finding\.scanned_at DESC[\s\S]+finding\.id DESC/);
    assert.match(sql, /review\.candidate_content_hash = candidate_row\.content_hash/);
    assert.match(sql, /REVOKE UPDATE ON TABLE quarantine\.candidates FROM oam_operator_runtime/);
  }
  assert.match(upgrade, /status = 'review_pending'[\s\S]+WHERE status = 'reviewed'/);
  assert.match(upgrade, /drop_scan_finding_uniqueness/);
  assert.doesNotMatch(base, /UNIQUE \(upload_id, scanner_key, content_sha256\)/);
});

test('provisioning jobs persist one department scope on fresh and upgraded databases', async () => {
  const [base, upgrade] = await Promise.all([
    migration(),
    fs.readFile(provisioningScopeUpgradePath, 'utf8'),
  ]);
  assert.match(base, /CREATE TABLE identity\.provisioning_jobs[\s\S]+department_id uuid NOT NULL/);
  assert.match(base, /provisioning_jobs \(department_id, principal_id, status/);
  assert.match(upgrade, /existing provisioning job has ambiguous department scope/);
  assert.match(upgrade, /ALTER COLUMN department_id SET NOT NULL/);
  assert.match(upgrade, /FOREIGN KEY \(department_id\)/);
  assert.match(upgrade, /GRANT SELECT ON TABLE identity\.provisioning_jobs TO oam_broker_runtime/);
});

test('operator audit events persist and filter one department scope', async () => {
  const [base, upgrade] = await Promise.all([
    migration(),
    fs.readFile(auditScopeUpgradePath, 'utf8'),
  ]);
  assert.match(base, /CREATE TABLE audit\.security_events[\s\S]+department_id uuid/);
  assert.match(base, /security_events_department_time_idx/);
  assert.match(upgrade, /ADD COLUMN IF NOT EXISTS department_id uuid/);
  assert.match(upgrade, /candidate\.owning_department_id/);
  assert.match(upgrade, /upload\.owning_department_id/);
});

test('policy rules cannot move from a draft template into an active template', async () => {
  const [base, upgrade] = await Promise.all([
    migration(),
    fs.readFile(securityReviewUpgradePath, 'utf8'),
  ]);
  for (const sql of [base, upgrade]) {
    assert.match(sql, /NEW\.template_id IS DISTINCT FROM OLD\.template_id/);
    assert.match(sql, /policy rules cannot move between templates/);
    assert.match(sql, /WHERE id = OLD\.template_id/);
    assert.match(sql, /WHERE id = NEW\.template_id/);
    assert.doesNotMatch(sql, /COALESCE\(OLD\.template_id, NEW\.template_id\)/);
  }
});

test('proof runs persist department scope and capture evidence is append-only', async () => {
  const [base, upgrade] = await Promise.all([
    migration(),
    fs.readFile(securityReviewUpgradePath, 'utf8'),
  ]);
  assert.match(base, /CREATE TABLE identity\.proof_runs[\s\S]+department_id uuid NOT NULL/);
  assert.match(base, /proof_runs_department_time_idx/);
  assert.match(upgrade, /existing proof run has ambiguous department scope/);
  assert.match(upgrade, /ALTER COLUMN department_id SET NOT NULL/);
  assert.match(upgrade, /scan_findings_append_only/);
  assert.match(upgrade, /candidate_evidence_append_only/);
  assert.match(upgrade, /REVOKE UPDATE ON TABLE[\s\S]+quarantine\.scan_findings/);
});

test('operator database access is bound to a secret principal and department context', async () => {
  const [base, capture, upgrade] = await Promise.all([
    migration(),
    fs.readFile(captureUpgradePath, 'utf8'),
    fs.readFile(operatorContextUpgradePath, 'utf8'),
  ]);
  for (const sql of [base, upgrade]) {
    assert.match(sql, /CREATE TABLE(?: IF NOT EXISTS)? identity\.operator_context_credentials/);
    assert.match(sql, /current_setting\('oam\.operator_context_sha256', true\)/);
    assert.match(sql, /FUNCTION identity\.establish_operator_context/);
    assert.match(sql, /FUNCTION identity\.resolve_operator_context/);
    assert.match(sql, /REVOKE ALL ON TABLE identity\.operator_context_credentials/);
  }
  assert.match(upgrade, /ALTER TABLE identity\.principals FORCE ROW LEVEL SECURITY/);
  assert.match(upgrade, /department_id = identity\.current_operator_department_id\(\)/);
  assert.match(capture, /database-bound reviewer identity mismatch/);
  assert.match(capture, /database-bound architect identity mismatch/);
});

test('rollback removes only new schemas and roles', async () => {
  const sql = await fs.readFile(rollbackPath, 'utf8');

  for (const schema of ['oam_public', 'governance', 'quarantine', 'identity', 'audit']) {
    assert.match(sql, new RegExp(`DROP SCHEMA IF EXISTS ${schema} CASCADE`));
  }
  assert.doesNotMatch(sql, /DROP SCHEMA IF EXISTS memory/);
  assert.doesNotMatch(sql, /DROP ROLE tg_ops/);
});
