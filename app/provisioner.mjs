import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import {
  publicPlanProjection,
  stableJson,
  validateProvisioningPlan,
  validateQuarantineSealRequest,
  provisionerContract,
} from './lib/provisioner-contract.mjs';
import { createHash } from 'node:crypto';

const execFileAsync = promisify(execFile);
const COMMAND_ENV = Object.freeze({
  LANG: 'C.UTF-8',
  LC_ALL: 'C.UTF-8',
  PATH: '/usr/sbin:/usr/bin:/sbin:/bin',
});
const BINARIES = Object.freeze({
  getent: '/usr/bin/getent',
  gpasswd: '/usr/bin/gpasswd',
  id: '/usr/bin/id',
  passwd: '/usr/bin/passwd',
  pgrep: '/usr/bin/pgrep',
  pkill: '/usr/bin/pkill',
  systemctl: '/usr/bin/systemctl',
  useradd: '/usr/sbin/useradd',
  usermod: '/usr/sbin/usermod',
});

function bounded(value, max = 500) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').slice(0, max);
}

function jsonResponse(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

async function readJsonBody(request) {
  if (request.headers['content-type'] !== 'application/json') {
    const error = new Error('content_type_invalid');
    error.statusCode = 415;
    throw error;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > provisionerContract.maxRequestBytes) {
      const error = new Error('request_too_large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('invalid_json');
    error.statusCode = 400;
    throw error;
  }
}

async function atomicJson(filePath, value, mode = 0o600) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode });
  await fs.rename(temporaryPath, filePath);
}

export function createCommandRunner() {
  return async (binary, args, options = {}) => {
    if (!Object.values(BINARIES).includes(binary)) throw new Error('binary_not_allowed');
    try {
      const result = await execFileAsync(binary, args, {
        timeout: options.timeout || 10_000,
        maxBuffer: 32_768,
        env: COMMAND_ENV,
      });
      return { code: 0, stdout: bounded(result.stdout), stderr: bounded(result.stderr) };
    } catch (error) {
      if (options.allowFailure) {
        return {
          code: Number.isInteger(error?.code) ? error.code : 1,
          stdout: bounded(error?.stdout),
          stderr: bounded(error?.stderr || error?.message),
        };
      }
      const commandError = new Error(options.errorCode || 'host_operation_failed');
      commandError.cause = error;
      throw commandError;
    }
  };
}

async function lookupPasswd(commandRunner, user) {
  const result = await commandRunner(BINARIES.getent, ['passwd', user], { allowFailure: true });
  if (result.code !== 0 || !result.stdout) return null;
  const fields = result.stdout.trim().split(':');
  if (fields.length < 7) throw new Error('passwd_record_invalid');
  return { user: fields[0], uid: Number(fields[2]), gid: Number(fields[3]), shell: fields[6] };
}

async function groupGid(commandRunner, group) {
  const result = await commandRunner(BINARIES.getent, ['group', group], { errorCode: 'broker_group_missing' });
  const fields = result.stdout.split(':');
  const gid = Number(fields[2]);
  if (!Number.isInteger(gid) || gid <= 0) throw new Error('broker_group_invalid');
  return gid;
}

async function managedAgentGroupMembers(commandRunner, group) {
  const result = await commandRunner(BINARIES.getent, ['group', group], {
    errorCode: 'broker_group_missing',
  });
  const fields = result.stdout.trim().split(':');
  if (fields.length < 4) throw new Error('broker_group_invalid');
  return new Set(fields[3].split(',').filter((user) => /^oam-a-[a-f0-9]{12}$/.test(user)));
}

const PROTECTED_PROBE_LABELS = new Set([
  'repository_read',
  'installed_application_read',
  'application_environment_read',
  'model_authentication_read',
]);
const ALLOWED_BROKER_ASSETS = new Set([
  'prompt:website_handoff_brief_v1',
  'workflow:portfolio_site_delivery_v1',
  'decision:source_first_before_generation_v1',
]);

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

export function validateAgentProof(proof, {
  principalKey,
  osUser,
  policyHash,
  notBefore,
  now = Date.now(),
} = {}) {
  if (!exactKeys(proof, [
    'schema_version', 'principal_key', 'runtime_user', 'checked_at', 'passed', 'checks', 'broker',
  ]) || proof.schema_version !== 1 || proof.principal_key !== principalKey
      || proof.runtime_user !== osUser || proof.passed !== true || !Array.isArray(proof.checks)
      || proof.checks.length !== 6) {
    throw new Error('agent_proof_contract_invalid');
  }
  const checkedAt = Date.parse(proof.checked_at);
  if (!Number.isFinite(checkedAt) || !Number.isFinite(notBefore)
      || checkedAt < notBefore - 1_000 || checkedAt > now + 2_000
      || now - checkedAt > 15_000) {
    throw new Error('agent_proof_freshness_invalid');
  }
  const byLabel = new Map();
  for (const check of proof.checks) {
    if (!check || typeof check.label !== 'string' || byLabel.has(check.label)) {
      throw new Error('agent_proof_checks_invalid');
    }
    byLabel.set(check.label, check);
  }
  for (const label of PROTECTED_PROBE_LABELS) {
    const check = byLabel.get(label);
    if (!check || check.expected !== 'denied' || check.actual !== 'denied'
        || check.passed !== true || !['EACCES', 'EPERM'].includes(check.code)) {
      throw new Error('agent_protected_path_proof_invalid');
    }
  }
  const workspace = byLabel.get('own_workspace_write');
  if (!workspace || workspace.expected !== 'allowed' || workspace.actual !== 'allowed'
      || workspace.passed !== true) {
    throw new Error('agent_workspace_proof_invalid');
  }
  const postgres = byLabel.get('direct_postgres_connect');
  if (!postgres || postgres.expected !== 'denied' || postgres.actual !== 'denied'
      || postgres.passed !== true || postgres.code !== 'postgres_authority_denied') {
    throw new Error('agent_postgres_proof_invalid');
  }
  const broker = proof.broker;
  if (!exactKeys(broker, [
    'passed', 'status', 'authorization', 'asset_key', 'source_count', 'policy_hash',
  ]) || broker.passed !== true || broker.status !== 200 || broker.authorization !== 'allowed'
      || !ALLOWED_BROKER_ASSETS.has(broker.asset_key)
      || !Number.isInteger(broker.source_count) || broker.source_count < 1
      || broker.policy_hash !== policyHash) {
    throw new Error('agent_broker_proof_invalid');
  }
  return proof;
}

async function waitForAgentProof(filePath, contract, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const proof = JSON.parse(await fs.readFile(filePath, 'utf8'));
      const stats = await fs.lstat(filePath);
      if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1
          || stats.uid !== contract.uid || (stats.mode & 0o777) !== 0o600) {
        throw new Error('agent_proof_file_invalid');
      }
      validateAgentProof(proof, { ...contract, now: Date.now() });
      await fs.chown(filePath, 0, 0);
      await fs.chmod(filePath, 0o400);
      const sealed = await fs.lstat(filePath);
      if (sealed.uid !== 0 || sealed.gid !== 0 || (sealed.mode & 0o777) !== 0o400) {
        throw new Error('agent_proof_seal_failed');
      }
      return proof;
    } catch {
      // The runtime writes the proof atomically after its first broker request.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('agent_proof_timeout');
}

function auditDigest(event) {
  return createHash('sha256').update(stableJson(event)).digest('hex');
}

export function createProvisioner(options = {}) {
  const commandRunner = options.commandRunner || createCommandRunner();
  const stateRoot = options.stateRoot || process.env.OAM_PROVISIONER_STATE || '/var/lib/oam-provisioner';
  const logRoot = options.logRoot || process.env.OAM_PROVISIONER_LOGS || '/var/log/oam-provisioner';
  const credentialRoot = options.credentialRoot || '/etc/oam-agents';
  const agentStateRoot = options.agentStateRoot || '/var/lib/oam-agents';
  const passwdPath = options.passwdPath || '/etc/passwd';
  const brokerGroup = options.brokerGroup || 'oam-agent-broker';
  const quarantineRoot = options.quarantineRoot
    || process.env.OAM_QUARANTINE_ROOT
    || '/var/lib/organizational-ai-memory-quarantine';
  const quarantineUser = options.quarantineUser || 'oam-operator';
  const quarantineGroup = options.quarantineGroup || 'oam-operator';
  const maxAgents = Number.parseInt(options.maxAgents || process.env.OAM_PROVISIONER_MAX_AGENTS || '8', 10);
  let queue = Promise.resolve();
  let auditQueue = Promise.resolve();

  async function initialize() {
    await Promise.all([
      fs.mkdir(path.join(stateRoot, 'jobs'), { recursive: true, mode: 0o700 }),
      fs.mkdir(logRoot, { recursive: true, mode: 0o700 }),
      fs.mkdir(credentialRoot, { recursive: true, mode: 0o700 }),
      fs.mkdir(agentStateRoot, { recursive: true, mode: 0o711 }),
    ]);
  }

  async function appendAudit(payload) {
    auditQueue = auditQueue.then(async () => {
      const statePath = path.join(stateRoot, 'audit-state.json');
      let previous = { sequence: 0, hash: '0'.repeat(64) };
      try {
        previous = JSON.parse(await fs.readFile(statePath, 'utf8'));
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      const event = {
        schema_version: 1,
        sequence: previous.sequence + 1,
        previous_hash: previous.hash,
        occurred_at: new Date().toISOString(),
        ...payload,
      };
      const hash = auditDigest(event);
      const record = { ...event, hash };
      await fs.appendFile(path.join(logRoot, 'audit.jsonl'), `${JSON.stringify(record)}\n`, { mode: 0o600 });
      await atomicJson(statePath, { sequence: record.sequence, hash });
      return record;
    });
    return auditQueue;
  }

  async function writeCredential(binding, token, principalKey) {
    const passwd = await lookupPasswd(commandRunner, binding.osUser);
    if (!passwd) throw new Error('agent_user_missing');
    await fs.mkdir(binding.credentialDirectory, { recursive: true, mode: 0o710 });
    await fs.chown(binding.credentialDirectory, 0, passwd.gid);
    await fs.chmod(binding.credentialDirectory, 0o710);
    const tokenPath = path.join(binding.credentialDirectory, 'broker.token');
    await fs.writeFile(tokenPath, `${token}\n`, { mode: 0o400 });
    await fs.chown(tokenPath, passwd.uid, passwd.gid);
    await fs.chmod(tokenPath, 0o400);
    const principalPath = path.join(binding.credentialDirectory, 'principal.key');
    await fs.writeFile(principalPath, `${principalKey}\n`, { mode: 0o400 });
    await fs.chown(principalPath, passwd.uid, passwd.gid);
    await fs.chmod(principalPath, 0o400);
  }

  async function createAgentUser(binding) {
    let passwd = await lookupPasswd(commandRunner, binding.osUser);
    if (!passwd) {
      await commandRunner(BINARIES.useradd, [
        '--system',
        '--user-group',
        '--home-dir', binding.stateDirectory,
        '--no-create-home',
        '--shell', '/usr/sbin/nologin',
        binding.osUser,
      ], { errorCode: 'agent_user_create_failed' });
      passwd = await lookupPasswd(commandRunner, binding.osUser);
    }
    if (!passwd || passwd.shell !== '/usr/sbin/nologin') throw new Error('agent_user_contract_failed');
    await fs.mkdir(binding.stateDirectory, { recursive: true, mode: 0o700 });
    await fs.chown(binding.stateDirectory, passwd.uid, passwd.gid);
    await fs.chmod(binding.stateDirectory, 0o700);
    return passwd;
  }

  async function ensureBrokerCapacity(binding) {
    const members = await managedAgentGroupMembers(commandRunner, brokerGroup);
    if (!members.has(binding.osUser) && members.size >= maxAgents) {
      throw new Error('agent_quota_exceeded');
    }
  }

  async function addBrokerGroup(binding) {
    await groupGid(commandRunner, brokerGroup);
    await ensureBrokerCapacity(binding);
    await commandRunner(BINARIES.usermod, ['--append', '--groups', brokerGroup, binding.osUser], {
      errorCode: 'broker_group_assignment_failed',
    });
  }

  async function stopAndRevoke(binding) {
    const steps = [];
    steps.push(await commandRunner(BINARIES.systemctl, ['disable', '--now', binding.unitName], { allowFailure: true }));
    steps.push(await commandRunner(BINARIES.pkill, ['-KILL', '-u', binding.osUser], { allowFailure: true }));
    steps.push(await commandRunner(BINARIES.gpasswd, ['--delete', binding.osUser, brokerGroup], { allowFailure: true }));
    steps.push(await commandRunner(BINARIES.usermod, ['--lock', binding.osUser], { allowFailure: true }));
    await fs.rm(path.join(binding.credentialDirectory, 'broker.token'), { force: true });
    await fs.rm(path.join(binding.credentialDirectory, 'principal.key'), { force: true });
    const [active, enabled, processes, groups, password] = await Promise.all([
      commandRunner(BINARIES.systemctl, ['is-active', binding.unitName], { allowFailure: true }),
      commandRunner(BINARIES.systemctl, ['is-enabled', binding.unitName], { allowFailure: true }),
      commandRunner(BINARIES.pgrep, ['-u', binding.osUser], { allowFailure: true }),
      commandRunner(BINARIES.id, ['-nG', binding.osUser], { allowFailure: true }),
      commandRunner(BINARIES.passwd, ['-S', binding.osUser], { allowFailure: true }),
    ]);
    const groupNames = groups.code === 0 ? groups.stdout.trim().split(/\s+/).filter(Boolean) : [];
    const passwordState = password.code === 0 ? password.stdout.trim().split(/\s+/)[1] : '';
    let credentialPresent = false;
    for (const name of ['broker.token', 'principal.key']) {
      try {
        await fs.lstat(path.join(binding.credentialDirectory, name));
        credentialPresent = true;
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    if (active.code !== 3 || enabled.code !== 1 || enabled.stdout.trim() !== 'disabled'
        || processes.code !== 1 || groups.code !== 0 || groupNames.includes(brokerGroup)
        || passwordState !== 'L' || credentialPresent) {
      throw new Error('suspension_enforcement_failed');
    }
    return {
      steps: steps.map((step) => ({ code: step.code })),
      verified: true,
      service_inactive: true,
      unit_disabled: true,
      processes_absent: true,
      account_locked: true,
      broker_group_removed: true,
      credentials_absent: true,
    };
  }

  async function quarantineOwnership() {
    if (Number.isInteger(options.quarantineOwnerUid)
        && Number.isInteger(options.quarantineGroupGid)) {
      return {
        sourceUid: options.quarantineOwnerUid,
        groupGid: options.quarantineGroupGid,
        sealedUid: Number.isInteger(options.quarantineSealedUid)
          ? options.quarantineSealedUid
          : options.quarantineOwnerUid,
      };
    }
    const passwd = await lookupPasswd(commandRunner, quarantineUser);
    if (!passwd) throw new Error('quarantine_user_missing');
    return {
      sourceUid: passwd.uid,
      groupGid: await groupGid(commandRunner, quarantineGroup),
      sealedUid: 0,
    };
  }

  async function sealQuarantineFile(input) {
    await initialize();
    const request = validateQuarantineSealRequest(input);
    const expectedRoot = path.resolve(quarantineRoot);
    let actualRoot;
    try {
      actualRoot = await fs.realpath(expectedRoot);
    } catch {
      throw new Error('quarantine_root_unavailable');
    }
    if (actualRoot !== expectedRoot) throw new Error('quarantine_root_invalid');
    const targetPath = path.join(expectedRoot, request.storage_key);
    const expectedDirectory = path.dirname(targetPath);
    let actualDirectory;
    try {
      actualDirectory = await fs.realpath(expectedDirectory);
    } catch {
      throw new Error('quarantine_storage_unavailable');
    }
    if (actualDirectory !== expectedDirectory || !targetPath.startsWith(`${expectedRoot}${path.sep}`)) {
      throw new Error('quarantine_storage_invalid');
    }
    const ownership = await quarantineOwnership();
    let rootHandle;
    let directoryHandle;
    let handle;
    try {
      rootHandle = await fs.open(expectedRoot, fsConstants.O_RDONLY
        | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
      directoryHandle = await fs.open(expectedDirectory, fsConstants.O_RDONLY
        | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
      handle = await fs.open(targetPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
      const [openedRoot, openedDirectory, openedTarget] = await Promise.all([
        fs.realpath(`/proc/self/fd/${rootHandle.fd}`),
        fs.realpath(`/proc/self/fd/${directoryHandle.fd}`),
        fs.realpath(`/proc/self/fd/${handle.fd}`),
      ]);
      if (openedRoot !== expectedRoot || openedDirectory !== expectedDirectory
          || openedTarget !== targetPath) {
        throw new Error('quarantine_storage_changed');
      }
      const before = await handle.stat();
      if (!before.isFile() || before.nlink !== 1
          || before.size < 1 || before.size > provisionerContract.maxQuarantineBytes) {
        throw new Error('quarantine_file_invalid');
      }
      if (![ownership.sourceUid, ownership.sealedUid].includes(before.uid)) {
        throw new Error('quarantine_owner_invalid');
      }
      const content = await handle.readFile();
      const digest = createHash('sha256').update(content).digest('hex');
      if (digest !== request.sha256) throw new Error('quarantine_hash_mismatch');
      const [rootBefore, directoryBefore] = await Promise.all([
        rootHandle.stat(),
        directoryHandle.stat(),
      ]);
      if (rootBefore.uid !== ownership.sealedUid || rootBefore.gid !== ownership.groupGid) {
        await rootHandle.chown(ownership.sealedUid, ownership.groupGid);
      }
      await rootHandle.chmod(0o1730);
      if (directoryBefore.uid !== ownership.sealedUid || directoryBefore.gid !== ownership.groupGid) {
        await directoryHandle.chown(ownership.sealedUid, ownership.groupGid);
      }
      await directoryHandle.chmod(0o1730);
      if (before.uid !== ownership.sealedUid || before.gid !== ownership.groupGid) {
        await handle.chown(ownership.sealedUid, ownership.groupGid);
      }
      await handle.chmod(0o440);
      const after = await handle.stat();
      if (after.uid !== ownership.sealedUid || after.gid !== ownership.groupGid
          || (after.mode & 0o777) !== 0o440 || after.nlink !== 1) {
        throw new Error('quarantine_seal_verification_failed');
      }
      const seal = {
        schema_version: 1,
        status: 'sealed',
        storage_key: request.storage_key,
        sha256: request.sha256,
        size_bytes: after.size,
        owner_enforced: true,
        read_only_mode: '0440',
        sealed_at: new Date().toISOString(),
      };
      await appendAudit({
        event_type: 'quarantine_file_sealed',
        storage_key: seal.storage_key,
        sha256: seal.sha256,
        size_bytes: seal.size_bytes,
        read_only_mode: seal.read_only_mode,
      });
      return seal;
    } finally {
      await handle?.close().catch(() => {});
      await directoryHandle?.close().catch(() => {});
      await rootHandle?.close().catch(() => {});
    }
  }

  async function provision(validated) {
    const { plan, binding } = validated;
    await ensureBrokerCapacity(binding);
    const passwd = await createAgentUser(binding);
    try {
      await addBrokerGroup(binding);
      await writeCredential(binding, plan.broker_token, plan.principal_key);
      const proofPath = path.join(binding.stateDirectory, 'agent-proof.json');
      await fs.rm(proofPath, { force: true });
      const notBefore = Date.now();
      await commandRunner(BINARIES.systemctl, ['daemon-reload'], { errorCode: 'systemd_reload_failed' });
      await commandRunner(BINARIES.systemctl, ['enable', '--now', binding.unitName], {
        timeout: 15_000,
        errorCode: 'agent_service_start_failed',
      });
      const proof = await waitForAgentProof(proofPath, {
        principalKey: plan.principal_key,
        osUser: binding.osUser,
        policyHash: plan.policy_hash,
        notBefore,
        uid: passwd.uid,
      });
      return { status: 'succeeded', proof };
    } catch (error) {
      await stopAndRevoke(binding).catch(() => {});
      throw error;
    }
  }

  async function resume(validated) {
    const { plan, binding } = validated;
    const passwd = await lookupPasswd(commandRunner, binding.osUser);
    if (!passwd) throw new Error('agent_user_missing');
    try {
      await addBrokerGroup(binding);
      await writeCredential(binding, plan.broker_token, plan.principal_key);
      const proofPath = path.join(binding.stateDirectory, 'agent-proof.json');
      await fs.rm(proofPath, { force: true });
      const notBefore = Date.now();
      await commandRunner(BINARIES.systemctl, ['enable', '--now', binding.unitName], {
        timeout: 15_000,
        errorCode: 'agent_service_resume_failed',
      });
      const proof = await waitForAgentProof(proofPath, {
        principalKey: plan.principal_key,
        osUser: binding.osUser,
        policyHash: plan.policy_hash,
        notBefore,
        uid: passwd.uid,
      });
      return { status: 'succeeded', proof };
    } catch (error) {
      await stopAndRevoke(binding).catch(() => {});
      throw error;
    }
  }

  async function verify(validated) {
    const { plan, binding } = validated;
    const passwd = await lookupPasswd(commandRunner, binding.osUser);
    if (!passwd) throw new Error('agent_user_missing');
    const proofPath = path.join(binding.stateDirectory, 'agent-proof.json');
    await fs.rm(proofPath, { force: true });
    const notBefore = Date.now();
    await commandRunner(BINARIES.systemctl, ['restart', binding.unitName], {
      timeout: 15_000,
      errorCode: 'agent_service_verify_failed',
    });
    try {
      const proof = await waitForAgentProof(proofPath, {
        principalKey: plan.principal_key,
        osUser: binding.osUser,
        policyHash: plan.policy_hash,
        notBefore,
        uid: passwd.uid,
      });
      const active = await commandRunner(BINARIES.systemctl, ['is-active', binding.unitName], { allowFailure: true });
      if (active.code !== 0) throw new Error('agent_service_verify_failed');
      return { status: 'succeeded', proof, service_active: true };
    } catch (error) {
      await stopAndRevoke(binding).catch(() => {});
      throw error;
    }
  }

  async function executePlan(input) {
    await initialize();
    const validated = validateProvisioningPlan(input);
    const jobPath = path.join(stateRoot, 'jobs', `${validated.plan.plan_id}.json`);
    try {
      const existing = JSON.parse(await fs.readFile(jobPath, 'utf8'));
      if (existing.plan_hash !== validated.hash) {
        const error = new Error('idempotency_conflict');
        error.statusCode = 409;
        throw error;
      }
      return { replayed: true, record: existing };
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }

    const startedAt = new Date().toISOString();
    const baseRecord = {
      schema_version: 1,
      plan_id: validated.plan.plan_id,
      plan_hash: validated.hash,
      operation: validated.plan.operation,
      principal_key: validated.plan.principal_key,
      profile_key: validated.plan.profile_key,
      policy_hash: validated.plan.policy_hash,
      binding: validated.binding,
      started_at: startedAt,
    };
    await atomicJson(jobPath, { ...baseRecord, status: 'applying' });
    await appendAudit({
      event_type: 'provisioning_started',
      plan: publicPlanProjection(validated.plan),
      plan_hash: validated.hash,
      binding: validated.binding,
    });

    try {
      let result;
      if (validated.plan.operation === 'provision_agent') result = await provision(validated);
      if (validated.plan.operation === 'resume_agent') result = await resume(validated);
      if (validated.plan.operation === 'verify_agent') result = await verify(validated);
      if (validated.plan.operation === 'suspend_agent') {
        const suspension = await stopAndRevoke(validated.binding);
        result = { status: 'succeeded', suspension: 'enforced', ...suspension };
      }
      if (validated.plan.operation === 'rollback_agent') {
        const suspension = await stopAndRevoke(validated.binding);
        result = { status: 'rolled_back', suspension: 'enforced', ...suspension };
      }
      const record = {
        ...baseRecord,
        ...result,
        completed_at: new Date().toISOString(),
      };
      await atomicJson(jobPath, record);
      await appendAudit({
        event_type: 'provisioning_completed',
        plan_id: record.plan_id,
        plan_hash: record.plan_hash,
        operation: record.operation,
        principal_key: record.principal_key,
        status: record.status,
      });
      return { replayed: false, record };
    } catch (error) {
      const record = {
        ...baseRecord,
        status: 'failed',
        error_code: bounded(error?.message || 'provisioning_failed', 100),
        completed_at: new Date().toISOString(),
      };
      await atomicJson(jobPath, record);
      await appendAudit({
        event_type: 'provisioning_failed',
        plan_id: record.plan_id,
        plan_hash: record.plan_hash,
        operation: record.operation,
        principal_key: record.principal_key,
        status: record.status,
        error_code: record.error_code,
      });
      return { replayed: false, record };
    }
  }

  function enqueue(input) {
    const execution = queue.then(() => executePlan(input));
    queue = execution.catch(() => {});
    return execution;
  }

  function enqueueSeal(input) {
    const execution = queue.then(() => sealQuarantineFile(input));
    queue = execution.catch(() => {});
    return execution;
  }

  return Object.freeze({
    initialize,
    executePlan: enqueue,
    sealQuarantineFile: enqueueSeal,
    appendAudit,
  });
}

export function createProvisionerHandler(provisioner) {
  return async (request, response) => {
    const isPlan = request.method === 'POST' && request.url === '/v1/jobs';
    const isSeal = request.method === 'POST' && request.url === '/v1/quarantine/seal';
    if (!isPlan && !isSeal) {
      jsonResponse(response, 404, { error: { code: 'not_found' } });
      return;
    }
    try {
      const input = await readJsonBody(request);
      if (isSeal) {
        jsonResponse(response, 200, { seal: await provisioner.sealQuarantineFile(input) });
        return;
      }
      const result = await provisioner.executePlan(input);
      const status = result.record.status === 'failed' ? 422 : 200;
      jsonResponse(response, status, result);
    } catch (error) {
      jsonResponse(response, error?.statusCode || 400, {
        error: { code: bounded(error?.message || 'invalid_request', 100) },
      });
    }
  };
}

export async function startProvisioner(options = {}) {
  if (typeof process.getuid === 'function' && process.getuid() !== 0) {
    throw new Error('provisioner_must_run_as_root');
  }
  const socketPath = options.socketPath
    || process.env.OAM_PROVISIONER_SOCKET
    || '/run/oam-provisioner/provisioner.sock';
  const socketGroup = options.socketGroup || process.env.OAM_PROVISIONER_SOCKET_GROUP || 'oam-operator';
  const provisioner = options.provisioner || createProvisioner(options);
  await provisioner.initialize();
  await fs.rm(socketPath, { force: true });
  const server = http.createServer((request, response) => {
    createProvisionerHandler(provisioner)(request, response).catch(() => {
      if (!response.headersSent) jsonResponse(response, 500, { error: { code: 'internal_error' } });
      else response.destroy();
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const gid = await groupGid(createCommandRunner(), socketGroup);
  await fs.chown(socketPath, 0, gid);
  await fs.chmod(socketPath, 0o660);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  startProvisioner().catch((error) => {
    console.error('Provisioner failed to start.', { error_code: bounded(error?.message, 100) });
    process.exitCode = 1;
  });
}
