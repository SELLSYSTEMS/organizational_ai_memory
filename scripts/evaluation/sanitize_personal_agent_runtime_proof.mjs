import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CONFIRMATION = 'SANITIZE_PERSONAL_AGENT_RUNTIME_PROOF';
const MAX_INPUT_BYTES = 64 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ISO_UTC_MILLISECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CAPTURE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const DISPLAY_NAME = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} .,'()&-]*$/u;
const PRINCIPAL_KEY = /^agent:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
const RUNTIME_USER = /^oam-a-[a-f0-9]{12}$/;
const ASSET_KEY = /^(?:prompt|workflow|agent|decision|pattern):[a-z0-9][a-z0-9._-]{0,118}$/;

const REQUIRED_CHECKS = Object.freeze([
  Object.freeze({
    label: 'repository_read',
    expected: 'denied',
    actual: 'denied',
    codes: Object.freeze(['EACCES', 'EPERM']),
  }),
  Object.freeze({
    label: 'installed_application_read',
    expected: 'denied',
    actual: 'denied',
    codes: Object.freeze(['EACCES', 'EPERM']),
  }),
  Object.freeze({
    label: 'application_environment_read',
    expected: 'denied',
    actual: 'denied',
    codes: Object.freeze(['EACCES', 'EPERM']),
  }),
  Object.freeze({
    label: 'model_authentication_read',
    expected: 'denied',
    actual: 'denied',
    codes: Object.freeze(['EACCES', 'EPERM']),
  }),
  Object.freeze({
    label: 'own_workspace_write',
    expected: 'allowed',
    actual: 'allowed',
    codes: null,
  }),
  Object.freeze({
    label: 'outbound_ip_socket',
    expected: 'denied',
    actual: 'denied',
    codes: Object.freeze(['EACCES', 'EPERM', 'EAFNOSUPPORT', 'EPROTONOSUPPORT']),
  }),
  Object.freeze({
    label: 'direct_postgres_connect',
    expected: 'denied',
    actual: 'denied',
    codes: Object.freeze(['postgres_authority_denied']),
  }),
]);

const SECRET_SIGNATURES = Object.freeze([
  ['private_key', /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/i],
  ['openai_or_anthropic_key', /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}\b/],
  ['google_api_key', /\b(?:AIza[A-Za-z0-9_-]{30,}|AQ\.[A-Za-z0-9_-]{20,}|ya29\.[A-Za-z0-9_-]{20,})\b/],
  ['github_token', /\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\b/],
  ['gitlab_token', /\bglpat-[A-Za-z0-9_-]{20,}\b/],
  ['aws_access_key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['slack_token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ['stripe_secret', /\b[rs]k_live_[A-Za-z0-9]{16,}\b/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/],
  ['authorization_header', /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/-]{12,}/i],
  ['credentialed_url', /\bhttps?:\/\/[^/\s:@]+:[^/\s@]+@/i],
  ['database_dsn', /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\//i],
  [
    'sensitive_json_value',
    /"(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|client[_-]?secret|private[_-]?key)"\s*:\s*"(?!redacted\b)[^"]{4,}"/i,
  ],
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function assertExactKeys(value, expectedKeys, label) {
  if (!isPlainObject(value)) throw new Error(`${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} has an unexpected schema.`);
  }
}

function assertSafeInteger(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} is outside its allowed integer range.`);
  }
}

function assertCanonicalTimestamp(value) {
  if (typeof value !== 'string' || !ISO_UTC_MILLISECONDS.test(value)) {
    throw new Error('checked_at must be a canonical UTC timestamp with milliseconds.');
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error('checked_at must be a valid canonical UTC timestamp.');
  }
}

function assertDisplayName(value, label, maximumLength) {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximumLength
      || value.trim() !== value || !DISPLAY_NAME.test(value)) {
    throw new Error(`${label} is not bounded safe display metadata.`);
  }
  const words = value.split(/[ .,()&'-]+/u).filter(Boolean);
  if (words.some((word) => word.length > 32)) {
    throw new Error(`${label} contains an opaque token-like segment.`);
  }
}

function validateReleaseMetadata(metadata) {
  assertExactKeys(metadata, [
    'capture_run_id',
    'employee_display_name',
    'agent_display_name',
  ], 'release metadata');
  if (typeof metadata.capture_run_id !== 'string'
      || !CAPTURE_RUN_ID.test(metadata.capture_run_id)) {
    throw new Error('capture_run_id is not bounded safe release metadata.');
  }
  assertDisplayName(metadata.employee_display_name, 'employee_display_name', 80);
  assertDisplayName(metadata.agent_display_name, 'agent_display_name', 120);
}

function validateBoundaryChecks(checks) {
  if (!Array.isArray(checks) || checks.length !== REQUIRED_CHECKS.length) {
    throw new Error('The physical agent proof is not a seven-check result.');
  }
  checks.forEach((check, index) => {
    const contract = REQUIRED_CHECKS[index];
    assertExactKeys(
      check,
      contract.codes ? ['label', 'expected', 'actual', 'passed', 'code']
        : ['label', 'expected', 'actual', 'passed'],
      `checks[${index}]`,
    );
    if (check.label !== contract.label || check.expected !== contract.expected
        || check.actual !== contract.actual || check.passed !== true) {
      throw new Error(`Required physical check failed: ${contract.label}`);
    }
    if (contract.codes && !contract.codes.includes(check.code)) {
      throw new Error(`Physical check has an invalid denial code: ${contract.label}`);
    }
  });
}

function validateOrganizationalBroker(broker) {
  assertExactKeys(broker, [
    'passed',
    'status',
    'authorization',
    'asset_key',
    'source_count',
    'policy_hash',
  ], 'broker');
  if (broker.passed !== true || broker.status !== 200 || broker.authorization !== 'allowed'
      || typeof broker.asset_key !== 'string' || broker.asset_key.length > 120
      || !ASSET_KEY.test(broker.asset_key)
      || typeof broker.policy_hash !== 'string' || !SHA256.test(broker.policy_hash)) {
    throw new Error('Brokered organizational retrieval proof is invalid.');
  }
  assertSafeInteger(broker.source_count, 'broker.source_count', 1, 1_000);
}

function validateCitationDigest(citation, index) {
  assertExactKeys(citation, [
    'source_type',
    'source_id',
    'revision',
    'content_sha256',
  ], `personal_broker.citation_digests[${index}]`);
  if (!['memory', 'profile'].includes(citation.source_type)
      || typeof citation.source_id !== 'string' || !UUID.test(citation.source_id)
      || typeof citation.content_sha256 !== 'string' || !SHA256.test(citation.content_sha256)) {
    throw new Error(`Personal citation projection is invalid at index ${index}.`);
  }
  assertSafeInteger(citation.revision, `citation_digests[${index}].revision`, 1, 1_000_000_000);
}

function validatePersonalBroker(personalBroker) {
  assertExactKeys(personalBroker, [
    'passed',
    'status',
    'authorization',
    'matched_count',
    'citation_count',
    'audit_event_key',
    'citation_digests',
  ], 'personal_broker');
  if (personalBroker.passed !== true || personalBroker.status !== 200
      || personalBroker.authorization !== 'allowed'
      || personalBroker.matched_count !== 1 || personalBroker.citation_count !== 1
      || typeof personalBroker.audit_event_key !== 'string'
      || !UUID.test(personalBroker.audit_event_key)
      || !Array.isArray(personalBroker.citation_digests)
      || personalBroker.citation_digests.length !== personalBroker.citation_count) {
    throw new Error('Brokered personal retrieval proof is invalid.');
  }
  personalBroker.citation_digests.forEach(validateCitationDigest);
}

function validateRawProof(raw) {
  assertExactKeys(raw, [
    'schema_version',
    'principal_key',
    'runtime_user',
    'checked_at',
    'passed',
    'checks',
    'broker',
    'personal_broker',
  ], 'raw proof');
  if (raw.schema_version !== 1 || raw.passed !== true
      || typeof raw.principal_key !== 'string' || !PRINCIPAL_KEY.test(raw.principal_key)
      || typeof raw.runtime_user !== 'string' || !RUNTIME_USER.test(raw.runtime_user)) {
    throw new Error('The physical agent proof identity or result is invalid.');
  }
  assertCanonicalTimestamp(raw.checked_at);
  validateBoundaryChecks(raw.checks);
  validateOrganizationalBroker(raw.broker);
  validatePersonalBroker(raw.personal_broker);
}

function assertNoSecretLikeContent(serialized, allowedIdentifiers) {
  if (typeof serialized !== 'string') throw new Error('Serialized proof must be text.');
  let scanTarget = serialized;
  for (const identifier of allowedIdentifiers) {
    if (typeof identifier === 'string' && identifier.length > 0) {
      scanTarget = scanTarget.replaceAll(identifier, '<validated-identifier>');
    }
  }
  for (const [label, pattern] of SECRET_SIGNATURES) {
    if (pattern.test(scanTarget)) {
      throw new Error(`Sanitized proof contains a secret-like ${label} signature.`);
    }
  }
  if (/[A-Za-z0-9_+/=-]{40,}/.test(scanTarget)) {
    throw new Error('Sanitized proof contains an unrecognized opaque token-like value.');
  }
}

export function sanitizePersonalAgentRuntimeProof(raw, metadata) {
  validateReleaseMetadata(metadata);
  validateRawProof(raw);

  const sanitized = {
    schema_version: 1,
    proof_class: 'physical_personal_memory_agent',
    capture_run_id: metadata.capture_run_id,
    employee_display_name: metadata.employee_display_name,
    agent_display_name: metadata.agent_display_name,
    checked_at: raw.checked_at,
    passed: true,
    boundary_checks: raw.checks.map((check) => ({
      label: check.label,
      expected: check.expected,
      actual: check.actual,
      passed: check.passed,
      ...(check.code ? { code: check.code } : {}),
    })),
    organizational_capability: {
      passed: true,
      authorization: raw.broker.authorization,
      source_count: raw.broker.source_count,
    },
    personal_context: {
      passed: true,
      authorization: raw.personal_broker.authorization,
      matched_count: raw.personal_broker.matched_count,
      citation_count: raw.personal_broker.citation_count,
      audit_event_key: raw.personal_broker.audit_event_key,
      citation_digests: raw.personal_broker.citation_digests.map((citation) => ({
        source_type: citation.source_type,
        source_id: citation.source_id,
        revision: citation.revision,
        content_sha256: citation.content_sha256,
      })),
    },
    credential_disclosure: false,
  };
  const allowedIdentifiers = [
    sanitized.personal_context.audit_event_key,
    ...sanitized.personal_context.citation_digests.flatMap((citation) => [
      citation.source_id,
      citation.content_sha256,
    ]),
  ];
  assertNoSecretLikeContent(JSON.stringify(sanitized, null, 2), allowedIdentifiers);
  return sanitized;
}

function main() {
  if (process.env.OAM_PHYSICAL_PROOF_CONFIRM !== CONFIRMATION) {
    throw new Error(`Set OAM_PHYSICAL_PROOF_CONFIRM=${CONFIRMATION}.`);
  }
  if (!process.argv[2]) throw new Error('Input proof path is required.');
  const inputPath = path.resolve(process.argv[2]);
  const outputPath = path.resolve(process.argv[3]
    || 'artifacts/evaluation/personal-agent-runtime-proof-sanitized.json');
  const metadata = {
    capture_run_id: process.env.OAM_PHYSICAL_PROOF_RUN_ID,
    employee_display_name: process.env.OAM_PHYSICAL_PROOF_EMPLOYEE,
    agent_display_name: process.env.OAM_PHYSICAL_PROOF_AGENT,
  };
  const inputStat = fs.statSync(inputPath);
  if (!inputStat.isFile() || inputStat.size < 2 || inputStat.size > MAX_INPUT_BYTES) {
    throw new Error('Input proof must be a bounded regular file.');
  }
  const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const sanitized = sanitizePersonalAgentRuntimeProof(raw, metadata);
  fs.writeFileSync(outputPath, `${JSON.stringify(sanitized, null, 2)}\n`, { mode: 0o644 });
  console.log(path.relative(process.cwd(), outputPath));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
