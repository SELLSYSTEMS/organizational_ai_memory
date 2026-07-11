import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { calculateSourceBuildDigest } from '../../app/lib/source-build-digest.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('source build digest is deterministic and covers every deployed security surface', async () => {
  const first = await calculateSourceBuildDigest(projectRoot);
  const second = await calculateSourceBuildDigest(projectRoot);
  assert.match(first.sha256, /^[a-f0-9]{64}$/);
  assert.equal(first.sha256, second.sha256);
  for (const required of [
    'app/server.mjs',
    'app/lib/public-identity-proof.mjs',
    'deploy/systemd/organizational-ai-memory.service',
    'deploy/nginx/organizational-ai-memory.conf.example',
    'sql/identity_data_plane_v3_capture_integrity.sql',
    'sql/identity_data_plane_v4_provisioning_scope.sql',
    'sql/identity_data_plane_v5_audit_scope.sql',
    'sql/identity_data_plane_v6_security_review.sql',
    'sql/identity_data_plane_v7_operator_context.sql',
    'sql/identity_operator_context_seed_v1.sql',
    'scripts/deploy/install_identity_plane.sh',
    'scripts/evaluation/run_identity_plane_proof.mjs',
    'package-lock.json',
    'node_modules/pg/package.json',
  ]) {
    assert.ok(first.files.includes(required), `${required} is absent from the source digest`);
  }
  assert.equal(first.files.includes('deploy/nginx/organizational-ai-memory.conf'), false);
});
