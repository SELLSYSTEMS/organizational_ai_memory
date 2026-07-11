import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createPublicIdentityProofLoader,
  createPublicIdentityProofProjection,
  PublicIdentityProofError,
  PUBLIC_IDENTITY_PROOF_CHECKS,
} from '../../app/lib/public-identity-proof.mjs';
import { createIdentityProofReport } from '../../scripts/evaluation/identity-proof-report.mjs';

const GENERATED_AT = '2026-07-11T05:00:00.000Z';

function report(statusById = {}) {
  const results = Object.values(PUBLIC_IDENTITY_PROOF_CHECKS).map((check) => ({
    id: check.id,
    category: check.plane,
    title: check.title,
    required: true,
    status: statusById[check.id] || 'PASS',
    expected: check.expected,
    observed: check.pass_observed,
    enforcement_point: check.enforcement,
    evidence: { control_passed: (statusById[check.id] || 'PASS') === 'PASS' },
  }));
  return createIdentityProofReport({
    environment: 'test',
    source_commit: 'f'.repeat(40),
    source_sha256: 'c'.repeat(64),
    migration_sha256: 'a'.repeat(64),
    harness_sha256: 'b'.repeat(64),
    generated_at: GENERATED_AT,
    results,
  });
}

async function fixture(t, projection = createPublicIdentityProofProjection(report())) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'oam-public-proof-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'public-proof.json');
  await fs.writeFile(filePath, `${JSON.stringify(projection, null, 2)}\n`, { mode: 0o644 });
  return { directory, filePath };
}

test('public proof loader validates the exact projection and caches only for the configured TTL', async (t) => {
  const passing = createPublicIdentityProofProjection(report());
  const failing = createPublicIdentityProofProjection(report({ 'SUS-03': 'FAIL' }));
  const { filePath } = await fixture(t, passing);
  let current = 1_000;
  const loader = createPublicIdentityProofLoader({
    filePath,
    expectedSourceSha256: 'c'.repeat(64),
    cacheTtlMs: 5_000,
    now: () => Date.parse(GENERATED_AT) + current,
  });

  const first = await loader.read();
  assert.equal(first.overall_status, 'PASS');
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.checks), true);

  await fs.writeFile(filePath, `${JSON.stringify(failing, null, 2)}\n`);
  current = 2_000;
  assert.strictEqual(await loader.read(), first);
  current = 6_001;
  const refreshed = await loader.read();
  assert.equal(refreshed.overall_status, 'FAIL');
  assert.notStrictEqual(refreshed, first);
});

test('public projection exposes fixed evidence summaries and no internal identifiers or secrets', () => {
  const projection = createPublicIdentityProofProjection(report({ 'DB-02': 'FAIL' }));
  const serialized = JSON.stringify(projection);

  assert.equal(projection.checks.length, 22);
  assert.equal(projection.checks.find((item) => item.id === 'DB-02').observed,
    'Required control did not produce passing evidence.');
  assert.doesNotMatch(serialized, /\/(?:etc|home|opt|root|run|tmp|usr|var)\//i);
  assert.doesNotMatch(serialized, /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  assert.doesNotMatch(serialized, /@[a-z0-9.-]+\.[a-z]{2,}/i);
  assert.doesNotMatch(serialized, /\b(?:Bearer|cookie|csrf|password|secret|token)\b/i);
  assert.doesNotMatch(serialized, /\b(?:root|admin|postgres|tgops|oam-codex)\b/i);
  assert.doesNotMatch(serialized, /\boam-[a-z0-9-]+\b/i);
  assert.doesNotMatch(serialized, /\b(?:select|insert|update|delete)\s+/i);
});

test('public proof loader rejects final-component and parent-path symlinks', async (t) => {
  const projection = createPublicIdentityProofProjection(report());
  const { directory, filePath } = await fixture(t, projection);
  const linkPath = path.join(directory, 'proof-link.json');
  await fs.symlink(filePath, linkPath);
  const loader = createPublicIdentityProofLoader({
    filePath: linkPath,
    expectedSourceSha256: 'c'.repeat(64),
    now: () => Date.parse(GENERATED_AT) + 1_000,
  });

  await assert.rejects(
    loader.read(),
    (error) => error instanceof PublicIdentityProofError
      && error.code === 'public_identity_proof_symlink_denied',
  );
});

test('public proof loader rejects group-writable files', async (t) => {
  const { filePath } = await fixture(t);
  await fs.chmod(filePath, 0o664);
  const loader = createPublicIdentityProofLoader({
    filePath,
    expectedSourceSha256: 'c'.repeat(64),
    now: () => Date.parse(GENERATED_AT) + 1_000,
  });

  await assert.rejects(
    loader.read(),
    (error) => error instanceof PublicIdentityProofError
      && error.code === 'public_identity_proof_file_unsafe',
  );
});

test('public proof loader rejects unknown fields and substituted free text', async (t) => {
  const projection = JSON.parse(JSON.stringify(createPublicIdentityProofProjection(report())));
  projection.checks[0].debug = '/etc/private-value';
  const { filePath } = await fixture(t, projection);
  const loader = createPublicIdentityProofLoader({
    filePath,
    expectedSourceSha256: 'c'.repeat(64),
    cacheTtlMs: 0,
    now: () => Date.parse(GENERATED_AT) + 1_000,
  });
  await assert.rejects(
    loader.read(),
    (error) => error instanceof PublicIdentityProofError
      && error.code === 'public_identity_proof_check_invalid',
  );

  delete projection.checks[0].debug;
  projection.checks[0].observed = 'Bearer secret-value';
  await fs.writeFile(filePath, `${JSON.stringify(projection)}\n`);
  await assert.rejects(
    loader.read(),
    (error) => error instanceof PublicIdentityProofError
      && error.code === 'public_identity_proof_check_invalid',
  );
});

test('public proof loader rejects stale and build-mismatched evidence', async (t) => {
  const { filePath } = await fixture(t);
  const generated = Date.parse(GENERATED_AT);
  const mismatch = createPublicIdentityProofLoader({
    filePath,
    expectedSourceSha256: 'd'.repeat(64),
    now: () => generated + 1_000,
  });
  await assert.rejects(
    mismatch.read(),
    (error) => error.code === 'public_identity_proof_build_mismatch',
  );
  const stale = createPublicIdentityProofLoader({
    filePath,
    expectedSourceSha256: 'c'.repeat(64),
    maxAgeMs: 60_000,
    now: () => generated + 60_001,
  });
  await assert.rejects(
    stale.read(),
    (error) => error.code === 'public_identity_proof_stale',
  );
});

test('public proof loader reads a protected installed-source digest file', async (t) => {
  const { directory, filePath } = await fixture(t);
  const expectedSourceSha256Path = path.join(directory, 'expected-source.sha256');
  await fs.writeFile(expectedSourceSha256Path, `${'c'.repeat(64)}\n`, { mode: 0o440 });
  const loader = createPublicIdentityProofLoader({
    filePath,
    expectedSourceSha256Path,
    now: () => Date.parse(GENERATED_AT) + 1_000,
  });
  assert.equal((await loader.read()).overall_status, 'PASS');
});
