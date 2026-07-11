import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createIdentityProofReport,
  writeIdentityProofBundle,
} from '../../scripts/evaluation/identity-proof-report.mjs';
import { verifyIdentityProofBundle } from '../../scripts/evaluation/verify_identity_proof.mjs';

function result(id, status = 'PASS', required = true) {
  return {
    id,
    category: 'database',
    title: 'Canonical write boundary',
    required,
    status,
    expected: 'denied',
    observed: status === 'PASS' ? 'denied with SQLSTATE 42501' : 'allowed',
    enforcement_point: 'PostgreSQL privilege',
    evidence: { sqlstate: status === 'PASS' ? '42501' : null },
    duration_ms: 12,
  };
}

test('required NOT_RUN or FAIL prevents a green identity proof', () => {
  const report = createIdentityProofReport({
    environment: 'test',
    source_commit: 'abc',
    source_sha256: 'c'.repeat(64),
    migration_sha256: 'a'.repeat(64),
    harness_sha256: 'b'.repeat(64),
    results: [result('DB-01'), result('OS-01', 'NOT_RUN')],
  });
  assert.equal(report.overall_status, 'FAIL');
});

test('proof bundle hashes verify offline and fail after tampering', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'oam-proof-report-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const report = createIdentityProofReport({
    environment: 'test',
    source_commit: 'abc',
    source_sha256: 'c'.repeat(64),
    migration_sha256: 'a'.repeat(64),
    harness_sha256: 'b'.repeat(64),
    results: [result('DB-01'), result('OS-01')],
  });
  await writeIdentityProofBundle(directory, report);
  assert.equal((await verifyIdentityProofBundle(directory)).passed, true);
  await fs.appendFile(path.join(directory, 'report.html'), 'tampered');
  assert.equal((await verifyIdentityProofBundle(directory)).passed, false);
});
