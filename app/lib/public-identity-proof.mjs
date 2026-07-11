import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';

const STATUSES = new Set(['PASS', 'FAIL', 'NOT_RUN', 'NOT_APPLICABLE']);
const OVERALL_STATUSES = new Set(['PASS', 'FAIL']);
const HASH = /^[0-9a-f]{64}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const MAX_FILE_BYTES = 131_072;
const DEFAULT_CACHE_TTL_MS = 5_000;
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60_000;
const MAX_FUTURE_SKEW_MS = 5 * 60_000;

const CHECKS = [
  ['APP-01', 'application', 'Public application readiness', 'The public application and bounded capability pack are ready.', 'Public readiness completed with all required checks available.', 'Application readiness gate'],
  ['APP-02', 'application', 'Architect application identity', 'The operator session resolves to an active architect identity.', 'An active architect identity was authenticated through the application plane.', 'Application session authorization'],
  ['APP-03', 'application', 'Independent reviewer identity', 'A distinct active reviewer identity is available.', 'A distinct reviewer identity was authenticated and separated from the architect.', 'Application session authorization'],
  ['APP-04', 'application', 'Logical human boundary', 'A normal human is created without host or database bindings.', 'The human identity remained logical-only with no runtime binding.', 'Identity data plane'],
  ['POL-01', 'policy', 'Agent effective policy', 'The agent may read approved department memory but may not write canonical memory.', 'Effective policy allowed bounded reuse and explicitly denied canonical writes.', 'Policy decision engine'],
  ['PRO-01', 'policy', 'Confirmed provisioning gate', 'Agent provisioning requires a queued plan and explicit revision confirmation.', 'A revision-gated plan completed through the bounded provisioner.', 'Provisioning confirmation gate'],
  ['OS-01', 'host', 'Dedicated Linux UID boundary', 'The agent runs as a dedicated locked system identity with owned private state.', 'A dedicated locked system identity and private ownership boundary were verified.', 'Linux identity and ownership'],
  ['OS-02', 'host', 'Protected resource read denial', 'The agent cannot read application, source, or model-authentication resources.', 'All protected read probes were denied by the host boundary.', 'Filesystem and service sandbox'],
  ['OS-03', 'host', 'Private workspace write allowance', 'The agent can write its private persistent workspace.', 'The private workspace write probe succeeded.', 'Filesystem ownership'],
  ['SYS-01', 'host', 'Bounded agent service', 'The dedicated agent service runs under its expected identity with no-new-privileges and IP sockets denied.', 'The active dedicated process had no-new-privileges, an available broker socket, and a denied IP-socket probe.', 'Service manager sandbox and runtime socket probe'],
  ['DB-01', 'data', 'Direct database connection denial', 'The agent process cannot connect directly to the database.', 'The agent direct-connection probe was denied.', 'Database authentication boundary'],
  ['DB-02', 'data', 'Canonical data mutation denial', 'The restricted public data client cannot mutate canonical memory.', 'A real canonical mutation probe was rejected.', 'Database privilege boundary'],
  ['DB-03', 'data', 'Restricted data and row-policy boundary', 'The public data client is least-privileged and sensitive identity tables force row policy.', 'Least privilege and forced row-policy controls were verified.', 'Database privilege and row policy'],
  ['BRK-01', 'broker', 'Brokered capability reuse', 'The agent receives only an approved capability with provenance through the broker.', 'The broker allowed one governed capability and returned source provenance.', 'Broker credential and grant'],
  ['QUA-01', 'governance', 'Quarantined upload boundary', 'Uploaded material remains quarantined before independent review.', 'The upload hash was verified, sealed read-only, and produced a review-pending candidate.', 'Quarantine workflow'],
  ['QUA-02', 'governance', 'Candidate public isolation', 'A quarantined candidate is absent from public capability retrieval.', 'The candidate-specific public search returned no match.', 'Public projection boundary'],
  ['GOV-01', 'governance', 'Independent candidate review', 'A reviewer distinct from the architect approves the candidate for draft promotion.', 'The independent reviewer approved the candidate for draft promotion.', 'Independent review gate'],
  ['GOV-02', 'governance', 'Architect draft promotion', 'Only an architect can promote the reviewed candidate, and only as a draft.', 'The architect promotion produced a governed draft, not canonical memory.', 'Architect promotion gate'],
  ['GOV-03', 'governance', 'Draft public isolation', 'The promoted draft remains absent from public canonical retrieval.', 'The draft-specific public search still returned no match.', 'Canonical publication boundary'],
  ['SUS-01', 'suspension', 'Application and policy revocation', 'Suspension removes all effective agent permissions.', 'The suspended identity had no effective permissions.', 'Identity and policy revocation'],
  ['SUS-02', 'suspension', 'Host runtime revocation', 'Suspension stops the service and removes its broker credential files and group access.', 'The service stopped and host credential access was removed.', 'Host suspension enforcement'],
  ['SUS-03', 'suspension', 'Broker credential revocation', 'A credential captured before suspension is rejected afterward.', 'The broker rejected the pre-suspension credential.', 'Broker authorization revocation'],
];

export const PUBLIC_IDENTITY_PROOF_CHECKS = Object.freeze(Object.fromEntries(CHECKS.map(([
  id,
  plane,
  title,
  expected,
  passObserved,
  enforcement,
]) => [id, Object.freeze({
  id,
  plane,
  title,
  required: true,
  expected,
  pass_observed: passObserved,
  enforcement,
})])));

const ORDERED_IDS = Object.freeze(CHECKS.map(([id]) => id));
const EXACT_PROJECTION_KEYS = Object.freeze([
  'schema_version', 'proof_kind', 'source_sha256', 'generated_at', 'overall_status', 'counts', 'checks',
]);
const EXACT_COUNT_KEYS = Object.freeze(['pass', 'fail', 'not_run', 'not_applicable']);
const EXACT_CHECK_KEYS = Object.freeze([
  'id', 'plane', 'title', 'required', 'status', 'expected', 'observed', 'enforcement',
  'evidence_sha256',
]);

export class PublicIdentityProofError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PublicIdentityProofError';
    this.code = code;
  }
}

function fail(code) {
  throw new PublicIdentityProofError(code);
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function publicObserved(check, status) {
  if (status === 'PASS') return check.pass_observed;
  if (status === 'FAIL') return 'Required control did not produce passing evidence.';
  if (status === 'NOT_RUN') return 'Required control was not run.';
  return 'Control does not apply to this proof environment.';
}

function hasForbiddenPublicMaterial(value) {
  const serialized = JSON.stringify(value);
  return [
    /\/(?:etc|home|opt|root|run|srv|tmp|usr|var)\//i,
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /\b(?:bearer|cookie|csrf|password|secret|token)\b/i,
    /\b(?:root|admin|postgres|tgops|oam-codex)\b/i,
    /\boam-[a-z0-9-]+\b/i,
    /\b(?:select|insert|update|delete)\s+/i,
    /\b(?:getent|passwd|psql|systemctl)\b/i,
    /\b(?:sqlstate|stack trace|exception|stderr|stdout)\b/i,
  ].some((pattern) => pattern.test(serialized));
}

function normalizeCounts(value, checks) {
  if (!exactKeys(value, EXACT_COUNT_KEYS)) fail('public_identity_proof_schema_invalid');
  const expected = {
    pass: checks.filter((item) => item.status === 'PASS').length,
    fail: checks.filter((item) => item.status === 'FAIL').length,
    not_run: checks.filter((item) => item.status === 'NOT_RUN').length,
    not_applicable: checks.filter((item) => item.status === 'NOT_APPLICABLE').length,
  };
  for (const key of EXACT_COUNT_KEYS) {
    if (!Number.isInteger(value[key]) || value[key] !== expected[key]) {
      fail('public_identity_proof_counts_invalid');
    }
  }
  return expected;
}

function validateProjection(value) {
  if (!exactKeys(value, EXACT_PROJECTION_KEYS)
      || value.schema_version !== 1
      || value.proof_kind !== 'four_plane_identity_enforcement'
      || !HASH.test(value.source_sha256 || '')
      || typeof value.generated_at !== 'string'
      || !ISO_TIMESTAMP.test(value.generated_at)
      || !Number.isFinite(Date.parse(value.generated_at))
      || !OVERALL_STATUSES.has(value.overall_status)
      || !Array.isArray(value.checks)
      || value.checks.length !== ORDERED_IDS.length) {
    fail('public_identity_proof_schema_invalid');
  }

  const checks = value.checks.map((item, index) => {
    const expected = PUBLIC_IDENTITY_PROOF_CHECKS[ORDERED_IDS[index]];
    if (!exactKeys(item, EXACT_CHECK_KEYS)
        || item.id !== expected.id
        || item.plane !== expected.plane
        || item.title !== expected.title
        || item.required !== true
        || !STATUSES.has(item.status)
        || item.expected !== expected.expected
        || item.observed !== publicObserved(expected, item.status)
        || item.enforcement !== expected.enforcement
        || !HASH.test(item.evidence_sha256)) {
      fail('public_identity_proof_check_invalid');
    }
    return { ...item };
  });
  const counts = normalizeCounts(value.counts, checks);
  const shouldPass = checks.every((item) => item.status === 'PASS');
  if (value.overall_status !== (shouldPass ? 'PASS' : 'FAIL')) {
    fail('public_identity_proof_status_invalid');
  }

  const projection = {
    schema_version: 1,
    proof_kind: value.proof_kind,
    source_sha256: value.source_sha256,
    generated_at: value.generated_at,
    overall_status: value.overall_status,
    counts,
    checks,
  };
  if (hasForbiddenPublicMaterial(projection)) fail('public_identity_proof_content_unsafe');
  return projection;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

export function createPublicIdentityProofProjection(report) {
  if (!report || typeof report !== 'object' || !Array.isArray(report.results)) {
    fail('identity_proof_report_invalid');
  }
  if (!HASH.test(report.source_sha256 || '')) fail('identity_proof_report_source_invalid');
  const byId = new Map(report.results.map((result) => [result?.id, result]));
  if (byId.size !== ORDERED_IDS.length || report.results.length !== ORDERED_IDS.length) {
    fail('identity_proof_report_incomplete');
  }
  const checks = ORDERED_IDS.map((id) => {
    const source = byId.get(id);
    const contract = PUBLIC_IDENTITY_PROOF_CHECKS[id];
    if (!source || !STATUSES.has(source.status) || source.required !== true
        || !HASH.test(source.evidence_sha256 || '')) {
      fail('identity_proof_report_result_invalid');
    }
    return {
      id,
      plane: contract.plane,
      title: contract.title,
      required: true,
      status: source.status,
      expected: contract.expected,
      observed: publicObserved(contract, source.status),
      enforcement: contract.enforcement,
      evidence_sha256: source.evidence_sha256,
    };
  });
  const counts = {
    pass: checks.filter((item) => item.status === 'PASS').length,
    fail: checks.filter((item) => item.status === 'FAIL').length,
    not_run: checks.filter((item) => item.status === 'NOT_RUN').length,
    not_applicable: checks.filter((item) => item.status === 'NOT_APPLICABLE').length,
  };
  return deepFreeze(validateProjection({
    schema_version: 1,
    proof_kind: 'four_plane_identity_enforcement',
    source_sha256: report.source_sha256,
    generated_at: report.generated_at,
    overall_status: checks.every((item) => item.status === 'PASS') ? 'PASS' : 'FAIL',
    counts,
    checks,
  }));
}

async function readSecureProjection(filePath) {
  let handle;
  try {
    const real = await fs.realpath(filePath);
    if (real !== path.resolve(filePath)) fail('public_identity_proof_symlink_denied');
    handle = await fs.open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const stats = await handle.stat();
    const currentUid = typeof process.getuid === 'function' ? process.getuid() : stats.uid;
    if (!stats.isFile()
        || stats.size < 2
        || stats.size > MAX_FILE_BYTES
        || (stats.mode & 0o022) !== 0
        || ![0, currentUid].includes(stats.uid)) {
      fail('public_identity_proof_file_unsafe');
    }
    const content = await handle.readFile({ encoding: 'utf8' });
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      fail('public_identity_proof_json_invalid');
    }
    return deepFreeze(validateProjection(parsed));
  } catch (error) {
    if (error instanceof PublicIdentityProofError) throw error;
    fail('public_identity_proof_unavailable');
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function readSecureExpectedHash(filePath) {
  let handle;
  try {
    const real = await fs.realpath(filePath);
    if (real !== path.resolve(filePath)) fail('public_identity_proof_source_symlink_denied');
    handle = await fs.open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const stats = await handle.stat();
    const currentUid = typeof process.getuid === 'function' ? process.getuid() : stats.uid;
    if (!stats.isFile() || stats.size < 64 || stats.size > 66
        || (stats.mode & 0o022) !== 0 || ![0, currentUid].includes(stats.uid)) {
      fail('public_identity_proof_source_file_unsafe');
    }
    const value = (await handle.readFile({ encoding: 'utf8' })).trim();
    if (!HASH.test(value)) fail('public_identity_proof_source_invalid');
    return value;
  } catch (error) {
    if (error instanceof PublicIdentityProofError) throw error;
    fail('public_identity_proof_source_unavailable');
  } finally {
    await handle?.close().catch(() => {});
  }
}

export function createPublicIdentityProofLoader({
  filePath,
  expectedSourceSha256,
  expectedSourceSha256Path,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
  now = () => Date.now(),
} = {}) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
    throw new TypeError('An absolute public identity-proof path is required.');
  }
  if (!Number.isInteger(cacheTtlMs) || cacheTtlMs < 0 || cacheTtlMs > 30_000) {
    throw new TypeError('Public identity-proof cache TTL must be between 0 and 30000 milliseconds.');
  }
  const directExpected = expectedSourceSha256 === undefined ? null : expectedSourceSha256;
  const expectedPath = expectedSourceSha256Path === undefined ? null : expectedSourceSha256Path;
  if ((directExpected === null) === (expectedPath === null)
      || (directExpected !== null && !HASH.test(directExpected))
      || (expectedPath !== null && (typeof expectedPath !== 'string' || !path.isAbsolute(expectedPath)))) {
    throw new TypeError('Exactly one expected source SHA-256 value or absolute path is required.');
  }
  if (!Number.isInteger(maxAgeMs) || maxAgeMs < 60_000 || maxAgeMs > 7 * 24 * 60 * 60_000) {
    throw new TypeError('Public identity-proof maximum age must be between one minute and seven days.');
  }
  let cached = null;
  let expiresAt = 0;
  return Object.freeze({
    async read() {
      const current = Number(now());
      if (!Number.isFinite(current)) fail('public_identity_proof_clock_invalid');
      if (cached && Number.isFinite(current) && current < expiresAt) return cached;
      const projection = await readSecureProjection(filePath);
      const expected = directExpected || await readSecureExpectedHash(expectedPath);
      if (projection.source_sha256 !== expected) fail('public_identity_proof_build_mismatch');
      const generated = Date.parse(projection.generated_at);
      if (generated > current + MAX_FUTURE_SKEW_MS) fail('public_identity_proof_from_future');
      if (current - generated > maxAgeMs) fail('public_identity_proof_stale');
      cached = projection;
      expiresAt = current + cacheTtlMs;
      return projection;
    },
    clear() {
      cached = null;
      expiresAt = 0;
    },
  });
}
