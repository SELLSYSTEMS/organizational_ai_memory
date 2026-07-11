import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  deriveRuntimeBinding,
  planHash,
  publicPlanProjection,
  validateQuarantineSealRequest,
  validateProvisioningPlan,
} from '../../app/lib/provisioner-contract.mjs';
import { createProvisioner, validateAgentProof } from '../../app/provisioner.mjs';

const plan = Object.freeze({
  operation: 'provision_agent',
  plan_id: '4db41ec8-c154-4c72-88b3-c5f3062e9b97',
  principal_key: 'agent:68af923a-f2da-4ca9-8c04-f7918f4077f7',
  profile_key: 'memory-reuse-agent-v1',
  policy_hash: 'a'.repeat(64),
  broker_token: 'A'.repeat(43),
});

function validAgentProof(overrides = {}) {
  return {
    schema_version: 1,
    principal_key: plan.principal_key,
    runtime_user: 'oam-a-3a59ce936e32',
    checked_at: '2026-07-11T05:00:00.000Z',
    passed: true,
    checks: [
      ...[
        'repository_read',
        'installed_application_read',
        'application_environment_read',
        'model_authentication_read',
      ].map((label) => ({ label, expected: 'denied', actual: 'denied', passed: true, code: 'EACCES' })),
      { label: 'own_workspace_write', expected: 'allowed', actual: 'allowed', passed: true },
      { label: 'outbound_ip_socket', expected: 'denied', actual: 'denied', passed: true, code: 'EAFNOSUPPORT' },
      { label: 'direct_postgres_connect', expected: 'denied', actual: 'denied', passed: true, code: 'postgres_authority_denied' },
    ],
    broker: {
      passed: true,
      status: 200,
      authorization: 'allowed',
      asset_key: 'prompt:website_handoff_brief_v1',
      source_count: 1,
      policy_hash: plan.policy_hash,
    },
    ...overrides,
  };
}

test('agent activation proof is exact, fresh, principal-bound, and policy-bound', () => {
  const contract = {
    principalKey: plan.principal_key,
    osUser: 'oam-a-3a59ce936e32',
    policyHash: plan.policy_hash,
    notBefore: Date.parse('2026-07-11T04:59:59.000Z'),
    now: Date.parse('2026-07-11T05:00:01.000Z'),
  };
  assert.equal(validateAgentProof(validAgentProof(), contract).passed, true);
  assert.equal(validateAgentProof(validAgentProof({ personal_broker: null }), contract).passed, true);
  assert.throws(
    () => validateAgentProof(validAgentProof({ personal_broker: { passed: true } }), contract),
    /agent_proof_contract_invalid/,
  );
  assert.throws(
    () => validateAgentProof(validAgentProof({ checked_at: '2026-07-12T05:00:00.000Z' }), contract),
    /agent_proof_freshness_invalid/,
  );
  const failedPathProbe = validAgentProof();
  failedPathProbe.checks[0] = {
    ...failedPathProbe.checks[0], actual: 'probe_failed', passed: false, code: 'access_probe_failed',
  };
  assert.throws(() => validateAgentProof(failedPathProbe, contract), /agent_proof_contract_invalid|agent_protected_path_proof_invalid/);
  const wrongPolicy = validAgentProof();
  wrongPolicy.broker = { ...wrongPolicy.broker, policy_hash: 'c'.repeat(64) };
  assert.throws(() => validateAgentProof(wrongPolicy, contract), /agent_broker_proof_invalid/);
  const allowedNetwork = validAgentProof();
  allowedNetwork.checks.find((check) => check.label === 'outbound_ip_socket').actual = 'allowed';
  assert.throws(() => validateAgentProof(allowedNetwork, contract), /agent_network_boundary_proof_invalid/);
});

test('provisioning plans derive every host identifier from the principal key', () => {
  const validated = validateProvisioningPlan(plan);
  const again = deriveRuntimeBinding(plan.principal_key);
  assert.deepEqual(validated.binding, again);
  assert.match(validated.binding.osUser, /^oam-a-[0-9a-f]{12}$/);
  assert.equal(validated.hash, planHash(plan));
  assert.equal(validated.binding.stateDirectory, `/var/lib/oam-agents/${validated.binding.runtimeKey}`);
});

test('public projections and audit records never retain the broker token', () => {
  const projection = publicPlanProjection(plan);
  assert.equal(projection.broker_token, undefined);
  assert.equal(projection.principal_key, plan.principal_key);
  assert.doesNotMatch(JSON.stringify(projection), /A{20}/);
});

test('provisioning contract rejects extra fields and command-shaped identifiers', () => {
  assert.throws(() => validateProvisioningPlan({ ...plan, command: 'useradd root' }), /exactly/);
  assert.throws(() => validateProvisioningPlan({ ...plan, principal_key: 'agent:$(touch /tmp/pwned)' }), /UUID/);
  assert.throws(() => validateProvisioningPlan({ ...plan, profile_key: '../../arbitrary' }), /profile/);
});

test('suspension accepts no credential material', () => {
  const suspension = validateProvisioningPlan({
    operation: 'suspend_agent',
    plan_id: 'a90b29d6-c5ab-4a3f-921e-66bb17ad42a7',
    principal_key: plan.principal_key,
    profile_key: plan.profile_key,
    policy_hash: plan.policy_hash,
  });
  assert.equal(suspension.plan.operation, 'suspend_agent');
  assert.throws(() => validateProvisioningPlan({ ...suspension.plan, broker_token: plan.broker_token }), /exactly/);
});

test('quarantine seal contract accepts only a matching content-addressed key', () => {
  const sha256 = 'b'.repeat(64);
  assert.deepEqual(validateQuarantineSealRequest({
    storage_key: `bb/${sha256}`,
    sha256,
  }), { storage_key: `bb/${sha256}`, sha256 });
  assert.throws(() => validateQuarantineSealRequest({
    storage_key: `aa/${sha256}`,
    sha256,
  }), /match/);
  assert.throws(() => validateQuarantineSealRequest({
    storage_key: `bb/${sha256}`,
    sha256,
    path: '/etc/shadow',
  }), /exactly/);
});

test('root-side quarantine sealing verifies content and enforces sticky read-only storage', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oam-quarantine-seal-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const quarantineRoot = path.join(root, 'quarantine');
  const content = Buffer.from('Reviewed capability evidence.\n');
  const sha256 = createHash('sha256').update(content).digest('hex');
  const storageKey = `${sha256.slice(0, 2)}/${sha256}`;
  const target = path.join(quarantineRoot, storageKey);
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await fs.writeFile(target, content, { mode: 0o600 });

  const provisioner = createProvisioner({
    stateRoot: path.join(root, 'state'),
    logRoot: path.join(root, 'log'),
    credentialRoot: path.join(root, 'credentials'),
    agentStateRoot: path.join(root, 'agents'),
    passwdPath: path.join(root, 'passwd'),
    quarantineRoot,
    quarantineOwnerUid: process.getuid(),
    quarantineGroupGid: process.getgid(),
    quarantineSealedUid: process.getuid(),
  });
  const seal = await provisioner.sealQuarantineFile({ storage_key: storageKey, sha256 });
  const [fileStats, directoryStats, rootStats] = await Promise.all([
    fs.stat(target),
    fs.stat(path.dirname(target)),
    fs.stat(quarantineRoot),
  ]);

  assert.equal(seal.status, 'sealed');
  assert.equal(seal.sha256, sha256);
  assert.equal(fileStats.mode & 0o777, 0o440);
  assert.equal(directoryStats.mode & 0o1777, 0o1730);
  assert.equal(rootStats.mode & 0o1777, 0o1730);
  const audit = await fs.readFile(path.join(root, 'log', 'audit.jsonl'), 'utf8');
  assert.match(audit, /quarantine_file_sealed/);
  assert.doesNotMatch(audit, /Reviewed capability evidence/);
});

test('quarantine sealing rejects hash mismatches and hard-linked content before changing mode', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oam-quarantine-negative-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const quarantineRoot = path.join(root, 'quarantine');
  const expected = createHash('sha256').update('expected').digest('hex');
  const target = path.join(quarantineRoot, expected.slice(0, 2), expected);
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await fs.writeFile(target, 'different', { mode: 0o600 });
  const provisioner = createProvisioner({
    stateRoot: path.join(root, 'state'),
    logRoot: path.join(root, 'log'),
    credentialRoot: path.join(root, 'credentials'),
    agentStateRoot: path.join(root, 'agents'),
    quarantineRoot,
    quarantineOwnerUid: process.getuid(),
    quarantineGroupGid: process.getgid(),
    quarantineSealedUid: process.getuid(),
  });

  await assert.rejects(
    provisioner.sealQuarantineFile({ storage_key: `${expected.slice(0, 2)}/${expected}`, sha256: expected }),
    /quarantine_hash_mismatch/,
  );
  assert.equal((await fs.stat(target)).mode & 0o777, 0o600);

  await fs.writeFile(target, 'expected', { mode: 0o600 });
  await fs.link(target, `${target}.linked`);
  await assert.rejects(
    provisioner.sealQuarantineFile({ storage_key: `${expected.slice(0, 2)}/${expected}`, sha256: expected }),
    /quarantine_file_invalid/,
  );
});

test('root-side plan execution is serialized, audited, and idempotent without storing credentials', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oam-provisioner-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const commands = [];
  const commandRunner = async (binary, args) => {
    commands.push({ binary, args });
    if (binary.endsWith('/systemctl') && args[0] === 'is-active') return { code: 3, stdout: 'inactive\n', stderr: '' };
    if (binary.endsWith('/systemctl') && args[0] === 'is-enabled') return { code: 1, stdout: 'disabled\n', stderr: '' };
    if (binary.endsWith('/pgrep')) return { code: 1, stdout: '', stderr: '' };
    if (binary.endsWith('/id')) return { code: 0, stdout: 'oam-a-3a59ce936e32\n', stderr: '' };
    if (binary.endsWith('/passwd')) return { code: 0, stdout: 'oam-a-3a59ce936e32 L 2026-07-10 0 99999 7 -1\n', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const provisioner = createProvisioner({
    commandRunner,
    stateRoot: path.join(root, 'state'),
    logRoot: path.join(root, 'log'),
    credentialRoot: path.join(root, 'credentials'),
    agentStateRoot: path.join(root, 'agents'),
    passwdPath: path.join(root, 'passwd'),
  });
  await fs.writeFile(path.join(root, 'passwd'), 'root:x:0:0:root:/root:/bin/bash\n');
  const suspensionPlan = {
    operation: 'suspend_agent',
    plan_id: 'a90b29d6-c5ab-4a3f-921e-66bb17ad42a7',
    principal_key: plan.principal_key,
    profile_key: plan.profile_key,
    policy_hash: plan.policy_hash,
  };
  const first = await provisioner.executePlan(suspensionPlan);
  const countAfterFirst = commands.length;
  const replay = await provisioner.executePlan(suspensionPlan);
  assert.equal(first.record.status, 'succeeded');
  assert.equal(replay.replayed, true);
  assert.equal(commands.length, countAfterFirst);

  const job = await fs.readFile(path.join(root, 'state', 'jobs', `${suspensionPlan.plan_id}.json`), 'utf8');
  const audit = await fs.readFile(path.join(root, 'log', 'audit.jsonl'), 'utf8');
  assert.doesNotMatch(job, /broker_token|A{20}/);
  assert.doesNotMatch(audit, /broker_token|A{20}/);
  assert.equal(audit.trim().split('\n').length, 2);
});

test('resume compensates host state when broker-group staging fails', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oam-resume-compensation-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const commands = [];
  const binding = deriveRuntimeBinding(plan.principal_key);
  const commandRunner = async (binary, args) => {
    commands.push({ binary, args });
    if (binary.endsWith('/getent') && args[0] === 'passwd') {
      return { code: 0, stdout: `${binding.osUser}:x:62000:62000::${binding.stateDirectory}:/usr/sbin/nologin\n`, stderr: '' };
    }
    if (binary.endsWith('/getent') && args[0] === 'group') {
      return { code: 0, stdout: 'oam-agent-broker:x:983:\n', stderr: '' };
    }
    if (binary.endsWith('/usermod') && args.includes('--append')) {
      throw new Error('broker_group_assignment_failed');
    }
    if (binary.endsWith('/systemctl') && args[0] === 'is-active') {
      return { code: 3, stdout: 'inactive\n', stderr: '' };
    }
    if (binary.endsWith('/systemctl') && args[0] === 'is-enabled') {
      return { code: 1, stdout: 'disabled\n', stderr: '' };
    }
    if (binary.endsWith('/pgrep')) return { code: 1, stdout: '', stderr: '' };
    if (binary.endsWith('/id') && args[0] === '-nG') {
      return { code: 0, stdout: `${binding.osUser}\n`, stderr: '' };
    }
    if (binary.endsWith('/passwd')) {
      return { code: 0, stdout: `${binding.osUser} L 2026-07-11 0 99999 7 -1\n`, stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  const provisioner = createProvisioner({
    commandRunner,
    stateRoot: path.join(root, 'state'),
    logRoot: path.join(root, 'log'),
    credentialRoot: path.join(root, 'credentials'),
    agentStateRoot: path.join(root, 'agents'),
  });
  const record = (await provisioner.executePlan({
    ...plan,
    operation: 'resume_agent',
    plan_id: randomUUID(),
  })).record;

  assert.equal(record.status, 'failed');
  assert.equal(
    commands.some(({ binary, args }) => binary.endsWith('/systemctl') && args[0] === 'disable'),
    true,
  );
  assert.equal(
    commands.some(({ binary, args }) => binary.endsWith('/gpasswd') && args[0] === '--delete'),
    true,
  );
  assert.equal(
    commands.some(({ binary, args }) => binary.endsWith('/pkill') && args[0] === '-KILL'),
    true,
  );
});

test('suspension fails unless the unit and processes are fully revoked', async (t) => {
  for (const unsafe of ['enabled', 'process']) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), `oam-provisioner-${unsafe}-`));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const commandRunner = async (binary, args) => {
      if (binary.endsWith('/systemctl') && args[0] === 'is-active') return { code: 3, stdout: 'inactive\n', stderr: '' };
      if (binary.endsWith('/systemctl') && args[0] === 'is-enabled') {
        return unsafe === 'enabled'
          ? { code: 0, stdout: 'enabled\n', stderr: '' }
          : { code: 1, stdout: 'disabled\n', stderr: '' };
      }
      if (binary.endsWith('/pgrep')) return unsafe === 'process'
        ? { code: 0, stdout: '1234\n', stderr: '' }
        : { code: 1, stdout: '', stderr: '' };
      if (binary.endsWith('/id')) return { code: 0, stdout: 'oam-a-3a59ce936e32\n', stderr: '' };
      if (binary.endsWith('/passwd')) return { code: 0, stdout: 'oam-a-3a59ce936e32 L 2026-07-10 0 99999 7 -1\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const provisioner = createProvisioner({
      commandRunner,
      stateRoot: path.join(root, 'state'),
      logRoot: path.join(root, 'log'),
      credentialRoot: path.join(root, 'credentials'),
      agentStateRoot: path.join(root, 'agents'),
    });
    const record = (await provisioner.executePlan({
      operation: 'suspend_agent',
      plan_id: randomUUID(),
      principal_key: plan.principal_key,
      profile_key: plan.profile_key,
      policy_hash: plan.policy_hash,
    })).record;
    assert.equal(record.status, 'failed');
    assert.equal(record.error_code, 'suspension_enforcement_failed');
  }
});
