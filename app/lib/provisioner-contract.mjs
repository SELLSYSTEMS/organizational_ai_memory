import { createHash } from 'node:crypto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,86}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const QUARANTINE_STORAGE_KEY_PATTERN = /^[0-9a-f]{2}\/[0-9a-f]{64}$/;
const OPERATIONS = new Set([
  'provision_agent',
  'suspend_agent',
  'resume_agent',
  'verify_agent',
  'rollback_agent',
]);
const PROFILE_KEY = 'memory-reuse-agent-v1';

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(value, expectedKeys) {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`Plan fields must be exactly: ${expected.join(', ')}.`);
  }
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function planHash(plan) {
  return createHash('sha256').update(stableJson(plan)).digest('hex');
}

export function deriveRuntimeBinding(principalKey) {
  const runtimeKey = createHash('sha256').update(principalKey).digest('hex').slice(0, 12);
  return Object.freeze({
    runtimeKey,
    osUser: `oam-a-${runtimeKey}`,
    unitName: `organizational-ai-memory-agent@${runtimeKey}.service`,
    stateDirectory: `/var/lib/oam-agents/${runtimeKey}`,
    credentialDirectory: `/etc/oam-agents/${runtimeKey}`,
  });
}

export function validateProvisioningPlan(value) {
  if (!isRecord(value)) throw new TypeError('A provisioning plan object is required.');
  if (!OPERATIONS.has(value.operation)) throw new TypeError('Unsupported provisioning operation.');

  const requiresToken = value.operation === 'provision_agent' || value.operation === 'resume_agent';
  assertExactKeys(value, requiresToken
    ? ['operation', 'plan_id', 'principal_key', 'profile_key', 'policy_hash', 'broker_token']
    : ['operation', 'plan_id', 'principal_key', 'profile_key', 'policy_hash']);

  if (!UUID_PATTERN.test(value.plan_id)) throw new TypeError('plan_id must be a lowercase UUID v4.');
  if (typeof value.principal_key !== 'string' || !value.principal_key.startsWith('agent:')) {
    throw new TypeError('principal_key must identify an agent.');
  }
  const principalId = value.principal_key.slice('agent:'.length);
  if (!UUID_PATTERN.test(principalId)) throw new TypeError('principal_key must contain a lowercase UUID v4.');
  if (value.profile_key !== PROFILE_KEY) throw new TypeError('Unsupported execution profile.');
  if (!HASH_PATTERN.test(value.policy_hash)) throw new TypeError('policy_hash must be a SHA-256 digest.');
  if (requiresToken && !TOKEN_PATTERN.test(value.broker_token)) {
    throw new TypeError('broker_token must be a bounded base64url secret.');
  }

  const plan = Object.freeze({ ...value });
  return Object.freeze({
    plan,
    hash: planHash(plan),
    binding: deriveRuntimeBinding(plan.principal_key),
  });
}

export function publicPlanProjection(plan) {
  const { broker_token: _brokerToken, ...projection } = plan;
  return projection;
}

export function validateQuarantineSealRequest(value) {
  if (!isRecord(value)) throw new TypeError('A quarantine seal request is required.');
  assertExactKeys(value, ['storage_key', 'sha256']);
  if (!QUARANTINE_STORAGE_KEY_PATTERN.test(value.storage_key)) {
    throw new TypeError('storage_key must be a content-addressed quarantine key.');
  }
  if (!SHA256_PATTERN.test(value.sha256)) throw new TypeError('sha256 must be a SHA-256 digest.');
  const [prefix, digest] = value.storage_key.split('/');
  if (digest !== value.sha256 || prefix !== value.sha256.slice(0, 2)) {
    throw new TypeError('storage_key must match sha256.');
  }
  return Object.freeze({ storage_key: value.storage_key, sha256: value.sha256 });
}

export const provisionerContract = Object.freeze({
  profileKey: PROFILE_KEY,
  maxRequestBytes: 16_384,
  maxQuarantineBytes: 1_048_576,
  operations: Object.freeze([...OPERATIONS]),
});
