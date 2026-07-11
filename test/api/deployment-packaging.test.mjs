import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const read = (relativePath) => fs.readFile(new URL(`../../${relativePath}`, import.meta.url), 'utf8');

test('identity-plane installer is confirmation-gated and installs isolated workloads', async () => {
  const script = await read('scripts/deploy/install_identity_plane.sh');
  assert.match(script, /OAM_INSTALL_CONFIRM/);
  assert.match(script, /ensure_user oam-public oam-public/);
  assert.match(script, /ensure_user oam-operator oam-operator/);
  assert.match(script, /ensure_user oam-broker oam-broker/);
  assert.match(script, /write_db_env[^\n]+oam_public_api/);
  assert.match(script, /write_db_env[^\n]+oam_operator_api/);
  assert.match(script, /write_db_env[^\n]+oam_broker_api/);
  assert.match(script, /Restricted public role unexpectedly read canonical memory/);
  assert.match(script, /identity_data_plane_v2_public_asset_eligibility\.sql/);
  assert.match(script, /identity_data_plane_v3_capture_integrity\.sql/);
  assert.match(script, /identity_data_plane_v4_provisioning_scope\.sql/);
  assert.match(script, /identity_data_plane_v5_audit_scope\.sql/);
  assert.match(script, /identity_data_plane_v6_security_review\.sql/);
  assert.match(script, /identity_data_plane_v7_operator_context\.sql/);
  assert.match(script, /identity_operator_context_seed_v1\.sql/);
  assert.match(script, /organizational-ai-memory\.conf\.example/);
  assert.match(script, /trusted_proxy_cidr=\$\{OAM_TRUSTED_PROXY_CIDR:-\}/);
  assert.doesNotMatch(script, /10\.0\.100\.1/);
  assert.doesNotMatch(script, /deploy\/nginx\/organizational-ai-memory\.conf"/);
  assert.doesNotMatch(script, /jq[^\n]*--arg\s+(?:public_password|operator_password|broker_password|architect_token|reviewer_token)/);
  assert.doesNotMatch(script, /psql[^\n]*-v\s+(?:public_password|operator_password|broker_password)=/);
  assert.match(script, /No credential value was printed/);
});

test('packaged nginx exposes one prefixed console and keeps root operator APIs private', async () => {
  const nginx = await read('deploy/nginx/organizational-ai-memory.conf.example');
  assert.equal((nginx.match(/location \^~ \/architect\//g) || []).length, 1);
  assert.match(nginx, /location \^~ \/api\/v1\s*\{\s*return 404;/s);
  assert.match(nginx, /proxy_pass http:\/\/127\.0\.0\.1:3010\//);
  assert.match(nginx, /proxy_set_header Host memory\.sellsystems\.agency/);
});

test('runtime login migration grants exactly one workload membership per login', async () => {
  const sql = await read('sql/identity_runtime_logins_v1.sql');
  assert.match(sql, /GRANT oam_public_runtime TO oam_public_api/);
  assert.match(sql, /GRANT oam_operator_runtime TO oam_operator_api/);
  assert.match(sql, /GRANT oam_broker_runtime TO oam_broker_api/);
  assert.match(sql, /REVOKE oam_operator_runtime, oam_broker_runtime FROM oam_public_api/);
  assert.match(sql, /REVOKE oam_public_runtime, oam_broker_runtime FROM oam_operator_api/);
  assert.match(sql, /REVOKE oam_public_runtime, oam_operator_runtime FROM oam_broker_api/);
});

test('agent package proves installed application denial and Codex package includes its validator', async () => {
  const [agent, agentUnit, codexInstaller] = await Promise.all([
    read('app/agent-runtime.mjs'),
    read('deploy/systemd/organizational-ai-memory-agent@.service'),
    read('scripts/deploy/install_codex_sidecar.sh'),
  ]);
  assert.match(agent, /installed_application_read.*\/opt\/organizational-ai-memory\/app\/server\.mjs/);
  assert.match(agent, /setInterval\(\(\) => \{\}, 60_000\);/);
  assert.doesNotMatch(agent, /setInterval\(run, 60_000\)\.unref\(\)/);
  assert.match(agent, /error\?\.code === 'EACCES' \|\| error\?\.code === 'EPERM'/);
  assert.match(agent, /postgres_authority_denied/);
  assert.match(agentUnit, /InaccessiblePaths=.*\/opt\/organizational-ai-memory/);
  assert.match(codexInstaller, /structured-capability-plan\.mjs/);
  assert.doesNotMatch(codexInstaller, /--groups oam-codex tgops/);
});

test('operator timeout exceeds bounded root work and uncertain execution is compensated', async () => {
  const [client, provisioner, service] = await Promise.all([
    read('app/lib/provisioner-client.mjs'),
    read('app/provisioner.mjs'),
    read('app/lib/operator-service.mjs'),
  ]);
  assert.match(client, /timeoutMs = 75_000/);
  assert.match(provisioner, /timeoutMs = 12_000/);
  assert.match(provisioner, /timeout: 15_000/);
  assert.match(service, /operation: 'suspend_agent'/);
  assert.match(service, /host revocation could not be proven/);
});
