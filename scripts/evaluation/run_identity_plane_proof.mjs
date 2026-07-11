import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deriveRuntimeBinding } from '../../app/lib/provisioner-contract.mjs';
import { calculateSourceBuildDigest } from '../../app/lib/source-build-digest.mjs';
import {
  createPublicIdentityProofProjection,
  PUBLIC_IDENTITY_PROOF_CHECKS,
} from '../../app/lib/public-identity-proof.mjs';
import {
  createIdentityProofReport,
  writeIdentityProofBundle,
} from './identity-proof-report.mjs';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), '../..');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AGENT_KEY = /^agent:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TOKEN = /^[A-Za-z0-9_-]{32,128}$/;
const HASH = /^[0-9a-f]{64}$/;
const CHECK_IDS = Object.freeze(Object.keys(PUBLIC_IDENTITY_PROOF_CHECKS));
const LIVE_CONFIRMATION = 'RUN_ISOLATED_IDENTITY_PROOF';
const MAX_HTTP_BYTES = 2_000_000;

class ProofProbeError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ProofProbeError';
    this.code = code;
  }
}

function probeFail(code) {
  throw new ProofProbeError(code);
}

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function safeErrorCode(error) {
  const candidate = String(error?.code || error?.message || 'probe_failed').toLowerCase();
  return /^[a-z][a-z0-9_]{1,79}$/.test(candidate) ? candidate : 'probe_failed';
}

function resultEvidence(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

function isReady(value) {
  return value?.status === 'ready'
    && value?.checks?.database === 'available'
    && value?.checks?.public_corpus === 'available'
    && value?.checks?.capability_pack === 'available';
}

function noMatch(value) {
  return value?.status === 'no_match'
    && value?.resolution?.kind === 'none'
    && (!Array.isArray(value.asset_matches) || value.asset_matches.length === 0)
    && (!Array.isArray(value.task_matches) || value.task_matches.length === 0);
}

function agentProofCheck(proof, label) {
  return Array.isArray(proof?.checks)
    ? proof.checks.find((item) => item?.label === label)
    : null;
}

function checkedEvidence(check) {
  return {
    label: check?.label || 'missing',
    expected: check?.expected || null,
    actual: check?.actual || null,
    passed: check?.passed === true,
    code_class: typeof check?.code === 'string' ? 'bounded_denial_code' : null,
  };
}

function permissionEvidence(access) {
  const permissions = Array.isArray(access?.permissions) ? access.permissions : [];
  const denials = Array.isArray(access?.explicit_denials) ? access.explicit_denials : [];
  const findings = Array.isArray(access?.runtime_findings) ? access.runtime_findings : [];
  return {
    department_read_allowed: permissions.includes('memory.department.read'),
    candidate_create_allowed: permissions.includes('candidate.create'),
    canonical_write_allowed: permissions.includes('memory.canonical.write'),
    canonical_write_explicitly_denied: denials.includes('memory.canonical.write'),
    privilege_escalation_allowed: permissions.some((value) => [
      'provisioning.confirm',
      'principal.suspend',
      'candidate.promote_as_draft',
    ].includes(value)),
    missing_broker_finding: findings.some((value) => value?.code === 'agent_broker_binding_required'),
  };
}

async function secureJson(filePath, expectedKeys, errorPrefix) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
    probeFail(`${errorPrefix}_path_invalid`);
  }
  let handle;
  try {
    const real = await fs.realpath(filePath);
    if (real !== path.resolve(filePath)) probeFail(`${errorPrefix}_symlink_denied`);
    handle = await fs.open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const stats = await handle.stat();
    const currentUid = typeof process.getuid === 'function' ? process.getuid() : stats.uid;
    if (!stats.isFile() || stats.size < 2 || stats.size > 16_384
        || (stats.mode & 0o077) !== 0 || ![0, currentUid].includes(stats.uid)) {
      probeFail(`${errorPrefix}_permissions_invalid`);
    }
    const value = JSON.parse(await handle.readFile('utf8'));
    if (!exactKeys(value, expectedKeys)) probeFail(`${errorPrefix}_schema_invalid`);
    return value;
  } catch (error) {
    if (error instanceof ProofProbeError) throw error;
    probeFail(`${errorPrefix}_unavailable`);
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function loadProofCredentials(filePath) {
  const value = await secureJson(
    filePath,
    ['schema_version', 'architect_token', 'reviewer_token'],
    'proof_credentials',
  );
  if (value.schema_version !== 1
      || !TOKEN.test(value.architect_token || '')
      || !TOKEN.test(value.reviewer_token || '')
      || value.architect_token === value.reviewer_token) {
    probeFail('proof_credentials_invalid');
  }
  return Object.freeze({
    architectToken: value.architect_token,
    reviewerToken: value.reviewer_token,
  });
}

async function loadDatabaseCredentials(filePath) {
  const value = await secureJson(
    filePath,
    ['schema_version', 'host', 'port', 'database', 'user', 'password'],
    'database_probe_credentials',
  );
  if (value.schema_version !== 1
      || typeof value.host !== 'string' || !value.host || value.host.length > 255
      || !Number.isInteger(value.port) || value.port < 1 || value.port > 65_535
      || typeof value.database !== 'string' || !/^[a-zA-Z0-9_.-]{1,63}$/.test(value.database)
      || typeof value.user !== 'string' || !/^[a-zA-Z0-9_.-]{1,63}$/.test(value.user)
      || typeof value.password !== 'string' || value.password.length < 16 || value.password.length > 512) {
    probeFail('database_probe_credentials_invalid');
  }
  return value;
}

function validatedBaseUrl(value, { loopbackOnly }) {
  let url;
  try {
    url = new URL(value);
  } catch {
    probeFail('proof_base_url_invalid');
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    probeFail('proof_base_url_invalid');
  }
  const loopback = ['127.0.0.1', '::1', 'localhost'].includes(url.hostname);
  if (!['http:', 'https:'].includes(url.protocol)
      || (loopbackOnly && (!loopback || url.protocol !== 'http:'))
      || (!loopback && url.protocol !== 'https:')) {
    probeFail('proof_base_url_invalid');
  }
  return url.origin;
}

async function fetchJson(baseUrl, requestPath, options = {}) {
  const url = new URL(requestPath, `${baseUrl}/`);
  if (url.origin !== baseUrl) probeFail('http_origin_escape_denied');
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: options.headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: 'error',
    signal: AbortSignal.timeout(options.timeoutMs || 15_000),
  }).catch(() => probeFail('http_probe_unavailable'));
  const declared = Number.parseInt(response.headers.get('content-length') || '', 10);
  if (Number.isFinite(declared) && declared > MAX_HTTP_BYTES) probeFail('http_response_too_large');
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_HTTP_BYTES) probeFail('http_response_too_large');
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    probeFail('http_response_invalid');
  }
  return { response, payload };
}

class OperatorSession {
  #baseUrl;
  #cookie;
  #csrf;

  constructor(baseUrl) {
    this.#baseUrl = baseUrl;
    this.#cookie = '';
    this.#csrf = '';
  }

  async authenticate(token) {
    const { response, payload } = await fetchJson(this.#baseUrl, '/api/v1/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: { token },
    });
    if (response.status !== 201 || !payload?.data?.session?.actor || !payload?.data?.csrf_token) {
      probeFail('operator_authentication_failed');
    }
    const cookie = response.headers.get('set-cookie')?.split(';', 1)[0] || '';
    if (!cookie.startsWith('oam_operator_session=')) probeFail('operator_session_cookie_missing');
    this.#cookie = cookie;
    this.#csrf = payload.data.csrf_token;
    return payload.data.session.actor;
  }

  async request(method, requestPath, body) {
    const headers = { cookie: this.#cookie };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (!['GET', 'HEAD'].includes(method)) headers['x-oam-csrf-token'] = this.#csrf;
    const { response, payload } = await fetchJson(this.#baseUrl, requestPath, {
      method,
      headers,
      body,
      timeoutMs: 30_000,
    });
    if (response.status < 200 || response.status >= 300 || !Object.hasOwn(payload || {}, 'data')) {
      const code = typeof payload?.error?.code === 'string' ? payload.error.code : 'operator_request_failed';
      probeFail(/^[a-z][a-z0-9_]{1,79}$/.test(code) ? code : 'operator_request_failed');
    }
    return payload.data;
  }
}

async function runFile(binary, args, {
  allowFailure = false,
  cwd,
  env,
  timeout = 8_000,
} = {}) {
  const allowed = new Set(['/usr/bin/getent', '/usr/bin/id', '/usr/bin/passwd', '/usr/bin/psql', '/usr/bin/systemctl', '/usr/bin/git']);
  if (!allowed.has(binary) || !Array.isArray(args) || args.some((item) => typeof item !== 'string')) {
    probeFail('probe_command_contract_invalid');
  }
  try {
    const result = await execFileAsync(binary, args, {
      cwd,
      env: env || { LANG: 'C.UTF-8', PATH: '/usr/bin:/bin' },
      maxBuffer: 262_144,
      timeout,
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    if (!allowFailure) probeFail('probe_command_failed');
    return {
      code: Number.isInteger(error?.code) ? error.code : 1,
      stdout: String(error?.stdout || ''),
      stderr: String(error?.stderr || ''),
    };
  }
}

async function fileState(filePath) {
  try {
    const stats = await fs.stat(filePath);
    return {
      exists: true,
      uid: stats.uid,
      gid: stats.gid,
      mode: stats.mode & 0o777,
      directory: stats.isDirectory(),
      socket: stats.isSocket(),
    };
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'EACCES') {
      return { exists: false, access_code: error.code };
    }
    probeFail('host_file_probe_failed');
  }
}

function validateBinding(binding, principalKey) {
  if (!AGENT_KEY.test(principalKey || '')) probeFail('agent_principal_contract_invalid');
  const expected = deriveRuntimeBinding(principalKey);
  if (!binding || Object.keys(expected).some((key) => binding[key] !== expected[key])) {
    probeFail('runtime_binding_contract_invalid');
  }
  return expected;
}

async function hostProbe(binding, principalKey, brokerSocketPath, phase) {
  const expected = validateBinding(binding, principalKey);
  const passwd = await runFile('/usr/bin/getent', ['passwd', expected.osUser], { allowFailure: true });
  const fields = passwd.code === 0 ? passwd.stdout.trim().split(':') : [];
  const uid = Number(fields[2]);
  const gid = Number(fields[3]);
  const service = await runFile('/usr/bin/systemctl', [
    'show', expected.unitName, '--no-pager',
    '--property=ActiveState', '--property=SubState', '--property=User',
    '--property=NoNewPrivileges',
  ], { allowFailure: true });
  const properties = Object.fromEntries(service.stdout.trim().split('\n').filter(Boolean).map((line) => {
    const index = line.indexOf('=');
    return index < 0 ? [line, ''] : [line.slice(0, index), line.slice(index + 1)];
  }));
  const state = await fileState(expected.stateDirectory);
  const credential = await fileState(expected.credentialDirectory);
  const token = await fileState(path.join(expected.credentialDirectory, 'broker.token'));
  const principal = await fileState(path.join(expected.credentialDirectory, 'principal.key'));
  const socket = await fileState(brokerSocketPath);
  const groups = await runFile('/usr/bin/id', ['-nG', expected.osUser], { allowFailure: true });
  const password = phase === 'suspended'
    ? await runFile('/usr/bin/passwd', ['-S', expected.osUser], { allowFailure: true })
    : { code: 1, stdout: '' };
  const groupNames = groups.code === 0 ? groups.stdout.trim().split(/\s+/).filter(Boolean) : [];
  return {
    phase,
    user_exists: passwd.code === 0 && fields.length >= 7 && Number.isInteger(uid) && uid > 0,
    uid,
    gid,
    system_uid: Number.isInteger(uid) && uid > 0 && uid < 1_000,
    locked_shell: fields[6] === '/usr/sbin/nologin',
    state_owned_private: state.exists && state.directory && state.uid === uid && (state.mode & 0o077) === 0,
    credential_root_owned: credential.exists && credential.directory && credential.uid === 0 && (credential.mode & 0o067) === 0,
    token_owned_private: token.exists && token.uid === uid && token.mode === 0o400,
    principal_owned_private: principal.exists && principal.uid === uid && principal.mode === 0o400,
    service_active: properties.ActiveState === 'active' && properties.SubState === 'running',
    service_user_matches: properties.User === expected.osUser,
    no_new_privileges: properties.NoNewPrivileges === 'yes',
    broker_socket_present: socket.exists && socket.socket,
    broker_group_member: groupNames.includes('oam-agent-broker'),
    account_locked: password.code === 0 && password.stdout.trim().split(/\s+/)[1] === 'L',
    credential_files_absent: !token.exists && !principal.exists,
  };
}

async function databaseProbe(filePath) {
  const credential = await loadDatabaseCredentials(filePath);
  const env = {
    HOME: '/var/empty',
    LANG: 'C.UTF-8',
    PATH: '/usr/bin:/bin',
    PGHOST: credential.host,
    PGPORT: String(credential.port),
    PGDATABASE: credential.database,
    PGUSER: credential.user,
    PGPASSWORD: credential.password,
  };
  const catalogSql = `WITH relations AS (
    SELECT max(c.oid) FILTER (WHERE n.nspname = 'memory' AND c.relname = 'capability_assets') AS canonical_oid,
           bool_or(c.relrowsecurity AND c.relforcerowsecurity)
             FILTER (WHERE n.nspname = 'identity' AND c.relname = 'broker_credentials') AS broker_rls,
           bool_or(c.relrowsecurity AND c.relforcerowsecurity)
             FILTER (WHERE n.nspname = 'governance' AND c.relname = 'capability_grants') AS grant_rls
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  ) SELECT json_build_object(
    'least_privileged', NOT role.rolsuper AND NOT role.rolcreatedb AND NOT role.rolcreaterole
      AND NOT role.rolreplication AND NOT role.rolbypassrls,
    'public_schema_usage', has_schema_privilege(current_user, 'oam_public', 'USAGE'),
    'memory_schema_denied', NOT has_schema_privilege(current_user, 'memory', 'USAGE'),
    'canonical_exists', relations.canonical_oid IS NOT NULL,
    'canonical_select_denied', NOT coalesce(has_table_privilege(current_user, relations.canonical_oid, 'SELECT'), false),
    'canonical_insert_denied', NOT coalesce(has_table_privilege(current_user, relations.canonical_oid, 'INSERT'), false),
    'canonical_update_denied', NOT coalesce(has_table_privilege(current_user, relations.canonical_oid, 'UPDATE'), false),
    'canonical_delete_denied', NOT coalesce(has_table_privilege(current_user, relations.canonical_oid, 'DELETE'), false),
    'broker_rls_forced', coalesce(relations.broker_rls, false),
    'grant_rls_forced', coalesce(relations.grant_rls, false)
  ) FROM pg_catalog.pg_roles role CROSS JOIN relations WHERE role.rolname = current_user`;
  const baseArgs = ['-X', '-w', '--no-align', '--tuples-only', '--set=ON_ERROR_STOP=1'];
  const catalog = await runFile('/usr/bin/psql', [...baseArgs, '--command', catalogSql], {
    env,
    timeout: 8_000,
  });
  let controls;
  try {
    controls = JSON.parse(catalog.stdout.trim());
  } catch {
    probeFail('database_catalog_probe_invalid');
  }
  const mutation = await runFile('/usr/bin/psql', [
    ...baseArgs,
    '--set=VERBOSITY=verbose',
    '--command', 'BEGIN; UPDATE memory.capability_assets SET title = title WHERE false; ROLLBACK;',
  ], { env, timeout: 8_000, allowFailure: true });
  return {
    ...controls,
    real_mutation_denied: mutation.code !== 0 && /42501/.test(mutation.stderr),
  };
}

function unixBrokerRequest(socketPath, token, principalKey) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ task: 'website delivery handoff' });
    const request = http.request({
      socketPath,
      path: '/v1/agent/recommendation',
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-length': Buffer.byteLength(body),
        'content-type': 'application/json',
        'x-oam-principal': principalKey,
      },
      timeout: 4_000,
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size <= 32_768) chunks.push(chunk);
      });
      response.on('end', () => {
        if (size > 32_768) {
          resolve({ status: response.statusCode, code: 'response_too_large' });
          return;
        }
        let payload = {};
        try {
          payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          // Invalid responses fail the proof without exposing their body.
        }
        resolve({
          status: response.statusCode,
          authorization: payload?.authorization || null,
          code: payload?.error?.code || null,
          provenance_count: Array.isArray(payload?.capability?.source_turn_ids)
            ? payload.capability.source_turn_ids.length
            : 0,
        });
      });
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve({ status: 0, code: 'broker_unavailable' }));
    request.end(body);
  });
}

export function createLiveIdentityProofAdapter({
  operatorBaseUrl = 'http://127.0.0.1:3010',
  publicBaseUrl = 'http://127.0.0.1:3000',
  databaseCredentialFile,
  brokerSocketPath = '/run/organizational-ai-memory-broker/agent.sock',
} = {}) {
  const operatorOrigin = validatedBaseUrl(operatorBaseUrl, { loopbackOnly: true });
  const publicOrigin = validatedBaseUrl(publicBaseUrl, { loopbackOnly: false });
  if (typeof databaseCredentialFile !== 'string' || !path.isAbsolute(databaseCredentialFile)) {
    throw new TypeError('An absolute database probe credential path is required.');
  }
  if (typeof brokerSocketPath !== 'string' || !path.isAbsolute(brokerSocketPath)) {
    throw new TypeError('An absolute broker socket path is required.');
  }
  const capturedCredentials = new Map();

  async function operator(role, token) {
    const client = new OperatorSession(operatorOrigin);
    const actor = await client.authenticate(token);
    return { role, actor, client };
  }

  async function planAndConfirm(session, principalId, operation) {
    const job = await session.client.request('POST', '/api/v1/provisioning/plans', {
      principal_id: principalId,
      operation,
    });
    if (!UUID.test(job?.id || '') || !Number.isInteger(job?.revision)) {
      probeFail('provisioning_plan_contract_invalid');
    }
    const confirmation = await session.client.request(
      'POST',
      `/api/v1/provisioning/plans/${job.id}/confirm`,
      { expected_revision: job.revision },
    );
    return { job, confirmation };
  }

  return Object.freeze({
    async ready() {
      const { response, payload } = await fetchJson(publicOrigin, '/api/readyz');
      if (response.status !== 200) probeFail('public_application_not_ready');
      return payload;
    },

    authenticate: operator,

    async createHuman(session, input) {
      return session.client.request('POST', '/api/v1/humans', input);
    },

    async createAndProvisionAgent(session, input) {
      const agent = await session.client.request('POST', '/api/v1/agents', {
        display_name: input.display_name,
      });
      if (!UUID.test(agent?.id || '') || !AGENT_KEY.test(agent?.principal_key || '')) {
        probeFail('agent_creation_contract_invalid');
      }
      const { job, confirmation } = await planAndConfirm(session, agent.id, 'provision_agent');
      const record = confirmation?.provisioner?.record;
      return { agent, job, confirmation, record, binding: record?.binding, proof: record?.proof };
    },

    async effectiveAccess(session, principalId) {
      return session.client.request('GET', `/api/v1/access/${principalId}`);
    },

    async host(binding, principalKey, phase) {
      return hostProbe(binding, principalKey, brokerSocketPath, phase);
    },

    async database() {
      return databaseProbe(databaseCredentialFile);
    },

    async publicSearch(query) {
      const { response, payload } = await fetchJson(publicOrigin, '/api/public/capability-search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: { query },
      });
      if (response.status !== 200) probeFail('public_search_failed');
      return payload;
    },

    async createUpload(session, input) {
      return session.client.request('POST', '/api/v1/uploads', input);
    },

    async createCandidate(session, uploadId, input) {
      return session.client.request('POST', `/api/v1/uploads/${uploadId}/candidates`, input);
    },

    async listCandidates(session) {
      return session.client.request('GET', '/api/v1/candidates');
    },

    async reviewCandidate(session, candidateId, input) {
      return session.client.request('POST', `/api/v1/candidates/${candidateId}/reviews`, input);
    },

    async promoteCandidate(session, candidateId, input) {
      return session.client.request('POST', `/api/v1/candidates/${candidateId}/promote`, input);
    },

    async prepareSuspensionProbe(binding, principalKey) {
      const expected = validateBinding(binding, principalKey);
      const value = (await fs.readFile(path.join(expected.credentialDirectory, 'broker.token'), 'utf8')).trim();
      if (!TOKEN.test(value)) probeFail('broker_credential_capture_failed');
      capturedCredentials.set(principalKey, value);
      return { captured: true };
    },

    async suspend(session, principalId, reason) {
      return session.client.request('POST', `/api/v1/principals/${principalId}/suspend`, { reason });
    },

    async state(session) {
      return session.client.request('GET', '/api/v1/state');
    },

    async suspendedBroker(principalKey) {
      const token = capturedCredentials.get(principalKey);
      capturedCredentials.delete(principalKey);
      if (!token) probeFail('broker_credential_not_captured');
      return unixBrokerRequest(brokerSocketPath, token, principalKey);
    },
  });
}

function createRecorder({ mode, now }) {
  const results = new Map();

  function store(id, status, evidence = {}, internalObserved = null, durationMs = 0) {
    const contract = PUBLIC_IDENTITY_PROOF_CHECKS[id];
    if (!contract || results.has(id)) throw new TypeError(`Duplicate or unknown proof result: ${id}`);
    const observed = status === 'PASS'
      ? contract.pass_observed
      : internalObserved || (status === 'NOT_RUN'
        ? 'Required control was not run because a dependency did not pass.'
        : 'Required control did not produce passing evidence.');
    results.set(id, {
      id,
      category: contract.plane,
      title: contract.title,
      required: true,
      status,
      expected: contract.expected,
      observed,
      enforcement_point: contract.enforcement,
      evidence: resultEvidence(evidence),
      duration_ms: durationMs,
    });
  }

  async function check(id, action, evaluate, evidenceOf = (value) => value) {
    const started = now();
    try {
      const value = await action();
      const evidence = resultEvidence(evidenceOf(value));
      const passed = evaluate(value) === true;
      store(id, passed ? 'PASS' : 'FAIL', evidence, null, now() - started);
      return passed ? value : null;
    } catch (error) {
      const code = safeErrorCode(error);
      store(id, 'FAIL', { error_class: code }, `Probe failed closed (${code}).`, now() - started);
      return null;
    }
  }

  function derived(id, value, evaluate, evidenceOf = (item) => item) {
    if (value === null || value === undefined) {
      store(id, 'NOT_RUN', { reason: 'dependency_not_passed' });
      return null;
    }
    try {
      const passed = evaluate(value) === true;
      store(id, passed ? 'PASS' : 'FAIL', resultEvidence(evidenceOf(value)));
      return passed ? value : null;
    } catch (error) {
      const code = safeErrorCode(error);
      store(id, 'FAIL', { error_class: code }, `Probe failed closed (${code}).`);
      return null;
    }
  }

  function skip(id, reason = 'dependency_not_passed') {
    if (!results.has(id)) store(id, 'NOT_RUN', { reason });
  }

  function complete() {
    for (const id of CHECK_IDS) {
      if (!results.has(id)) skip(id, mode === 'dry-run' ? 'dry_run' : 'dependency_not_passed');
    }
    return CHECK_IDS.map((id) => results.get(id));
  }

  return { check, derived, skip, complete };
}

function safeRunKey(value) {
  const normalized = String(value || '').replaceAll('-', '').toLowerCase();
  if (!/^[0-9a-f]{12,32}$/.test(normalized)) throw new TypeError('runId must contain 12 to 32 hexadecimal characters.');
  return normalized;
}

async function writePublicProjection(outputDirectory, projection) {
  const content = `${JSON.stringify(projection, null, 2)}\n`;
  const target = path.join(outputDirectory, 'public-proof.json');
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, content, { mode: 0o644 });
  await fs.rename(temporary, target);
  await fs.writeFile(
    path.join(outputDirectory, 'public-proof.sha256'),
    `${crypto.createHash('sha256').update(content).digest('hex')}  public-proof.json\n`,
    { mode: 0o644 },
  );
}

export async function runIdentityPlaneProof({
  mode = 'dry-run',
  confirmMutations = '',
  adapter = null,
  credentials = null,
  outputDirectory = null,
  environment = 'local-proof',
  sourceCommit = 'unknown',
  sourceSha256 = '0'.repeat(64),
  migrationSha256 = '0'.repeat(64),
  harnessSha256 = '0'.repeat(64),
  generatedAt = new Date().toISOString(),
  runId = crypto.randomUUID(),
  clock = () => Date.now(),
} = {}) {
  if (!['dry-run', 'live'].includes(mode)) throw new TypeError('mode must be dry-run or live.');
  if (mode === 'live' && confirmMutations !== LIVE_CONFIRMATION) {
    throw new TypeError(`Live proof requires confirmation value ${LIVE_CONFIRMATION}.`);
  }
  if (mode === 'live' && (!adapter || !credentials)) {
    throw new TypeError('Live proof requires an adapter and separate operator credentials.');
  }
  if (!HASH.test(sourceSha256) || !HASH.test(migrationSha256) || !HASH.test(harnessSha256)) {
    throw new TypeError('Source, migration, and harness hashes must be SHA-256 digests.');
  }

  const recorder = createRecorder({ mode, now: clock });
  const runKey = safeRunKey(runId);

  if (mode === 'live') {
    const readiness = await recorder.check(
      'APP-01',
      () => adapter.ready(),
      isReady,
      (value) => ({ ready: isReady(value), checks_available: Object.keys(value?.checks || {}).sort() }),
    );
    const architect = readiness ? await recorder.check(
      'APP-02',
      () => adapter.authenticate('architect', credentials.architectToken),
      (value) => value?.actor?.membership_role === 'architect' && UUID.test(value.actor.principal_id || ''),
      (value) => ({ authenticated: true, membership_role: value?.actor?.membership_role || null }),
    ) : null;
    if (!architect) recorder.skip('APP-04');
    const reviewer = readiness ? await recorder.check(
      'APP-03',
      () => adapter.authenticate('reviewer', credentials.reviewerToken),
      (value) => value?.actor?.membership_role === 'reviewer'
        && UUID.test(value.actor.principal_id || '')
        && value.actor.principal_id !== architect?.actor?.principal_id,
      (value) => ({
        authenticated: true,
        membership_role: value?.actor?.membership_role || null,
        distinct_from_architect: value?.actor?.principal_id !== architect?.actor?.principal_id,
      }),
    ) : null;

    if (architect) {
      await recorder.check(
        'APP-04',
        () => adapter.createHuman(architect, {
          principal_key: `human:proof_${runKey}`,
          display_name: 'Identity proof participant',
          external_issuer: 'https://identity-proof.invalid',
          external_subject: `proof-${runKey}`,
          membership_role: 'member',
        }),
        (value) => value?.principal_kind === 'human'
          && value?.status === 'active'
          && value?.logical_only === true
          && Array.isArray(value?.runtime_bindings)
          && value.runtime_bindings.length === 0,
        (value) => ({
          principal_kind: value?.principal_kind || null,
          status: value?.status || null,
          logical_only: value?.logical_only === true,
          runtime_binding_count: Array.isArray(value?.runtime_bindings) ? value.runtime_bindings.length : -1,
        }),
      );
    }

    const provisioned = architect ? await recorder.check(
      'PRO-01',
      () => adapter.createAndProvisionAgent(architect, {
        display_name: `Identity proof reuse agent ${runKey}`,
      }),
      (value) => value?.agent?.status === 'draft'
        && value?.agent?.inherits_permissions === false
        && value?.job?.status === 'queued'
        && value?.job?.department_id === architect.actor.department_id
        && value?.confirmation?.confirmed?.status === 'confirmed'
        && value?.confirmation?.confirmed?.department_id === architect.actor.department_id
        && value?.record?.status === 'succeeded'
        && value?.proof?.passed === true,
      (value) => ({
        agent_started_as_draft: value?.agent?.status === 'draft',
        permission_inheritance: value?.agent?.inherits_permissions === true,
        queued: value?.job?.status === 'queued',
        department_bound: value?.job?.department_id === architect?.actor?.department_id
          && value?.confirmation?.confirmed?.department_id === architect?.actor?.department_id,
        revision_confirmed: value?.confirmation?.confirmed?.status === 'confirmed',
        provisioner_succeeded: value?.record?.status === 'succeeded',
        runtime_proof_passed: value?.proof?.passed === true,
      }),
    ) : null;

    if (provisioned) {
      await recorder.check(
        'POL-01',
        () => adapter.effectiveAccess(architect, provisioned.agent.id),
        (value) => {
          const evidence = permissionEvidence(value);
          return evidence.department_read_allowed
            && evidence.candidate_create_allowed
            && !evidence.canonical_write_allowed
            && evidence.canonical_write_explicitly_denied
            && !evidence.privilege_escalation_allowed
            && !evidence.missing_broker_finding;
        },
        permissionEvidence,
      );
    } else {
      recorder.skip('POL-01');
    }

    const host = provisioned ? await recorder.check(
      'OS-01',
      () => adapter.host(provisioned.binding, provisioned.agent.principal_key, 'active'),
      (value) => value?.user_exists && value?.system_uid && value?.locked_shell
        && value?.state_owned_private && value?.credential_root_owned
        && value?.token_owned_private && value?.principal_owned_private
        && value?.broker_group_member,
      (value) => ({
        user_exists: value?.user_exists === true,
        system_uid: value?.system_uid === true,
        locked_shell: value?.locked_shell === true,
        state_owned_private: value?.state_owned_private === true,
        credential_root_owned: value?.credential_root_owned === true,
        credential_files_owned_private: value?.token_owned_private === true
          && value?.principal_owned_private === true,
        broker_group_member: value?.broker_group_member === true,
      }),
    ) : null;
    const proof = provisioned?.proof;
    const outboundIpSocket = agentProofCheck(proof, 'outbound_ip_socket');
    recorder.derived(
      'SYS-01',
      host && proof ? { host, outboundIpSocket } : null,
      (value) => value.host.service_active && value.host.service_user_matches
        && value.host.no_new_privileges && value.host.broker_socket_present
        && value.outboundIpSocket?.passed === true
        && value.outboundIpSocket.actual === 'denied',
      (value) => ({
        active: value?.host?.service_active === true,
        dedicated_identity: value?.host?.service_user_matches === true,
        no_new_privileges: value?.host?.no_new_privileges === true,
        broker_socket_present: value?.host?.broker_socket_present === true,
        outbound_ip_socket: checkedEvidence(value?.outboundIpSocket),
      }),
    );

    const protectedChecks = [
      agentProofCheck(proof, 'repository_read'),
      agentProofCheck(proof, 'installed_application_read'),
      agentProofCheck(proof, 'application_environment_read'),
      agentProofCheck(proof, 'model_authentication_read'),
    ];
    recorder.derived(
      'OS-02',
      proof,
      () => protectedChecks.every((item) => item?.passed === true && item.actual === 'denied'),
      () => ({ checks: protectedChecks.map(checkedEvidence) }),
    );
    const workspace = agentProofCheck(proof, 'own_workspace_write');
    recorder.derived(
      'OS-03',
      proof,
      () => workspace?.passed === true && workspace.actual === 'allowed',
      () => checkedEvidence(workspace),
    );
    const directDatabase = agentProofCheck(proof, 'direct_postgres_connect');
    recorder.derived(
      'DB-01',
      proof,
      () => directDatabase?.passed === true && directDatabase.actual === 'denied',
      () => checkedEvidence(directDatabase),
    );
    recorder.derived(
      'BRK-01',
      proof,
      () => proof?.broker?.passed === true
        && proof.broker.status === 200
        && proof.broker.authorization === 'allowed'
        && proof.broker.source_count > 0
        && typeof proof.broker.asset_key === 'string'
        && proof.broker.asset_key.length > 0,
      () => ({
        allowed: proof?.broker?.authorization === 'allowed',
        status: proof?.broker?.status || 0,
        provenance_present: Number(proof?.broker?.source_count || 0) > 0,
        governed_asset_present: typeof proof?.broker?.asset_key === 'string'
          && proof.broker.asset_key.length > 0,
        policy_hash_present: HASH.test(proof?.broker?.policy_hash || ''),
      }),
    );

    const database = readiness ? await recorder.check(
      'DB-02',
      () => adapter.database(),
      (value) => value?.canonical_exists === true
        && value?.canonical_insert_denied === true
        && value?.canonical_update_denied === true
        && value?.canonical_delete_denied === true
        && value?.real_mutation_denied === true,
      (value) => ({
        canonical_exists: value?.canonical_exists === true,
        insert_denied: value?.canonical_insert_denied === true,
        update_denied: value?.canonical_update_denied === true,
        delete_denied: value?.canonical_delete_denied === true,
        real_mutation_denied: value?.real_mutation_denied === true,
      }),
    ) : null;
    recorder.derived(
      'DB-03',
      database,
      (value) => value.least_privileged === true
        && value.public_schema_usage === true
        && value.memory_schema_denied === true
        && value.canonical_select_denied === true
        && value.broker_rls_forced === true
        && value.grant_rls_forced === true,
      (value) => ({
        least_privileged: value?.least_privileged === true,
        fixed_public_views_allowed: value?.public_schema_usage === true,
        canonical_schema_denied: value?.memory_schema_denied === true,
        canonical_select_denied: value?.canonical_select_denied === true,
        broker_row_policy_forced: value?.broker_rls_forced === true,
        grant_row_policy_forced: value?.grant_rls_forced === true,
      }),
    );

    const isolationQuery = `proofisolated${runKey}`;
    let candidate = null;
    if (architect) {
      const quarantine = await recorder.check(
        'QUA-01',
        async () => {
          const upload = await adapter.createUpload(architect, {
            original_name: `identity-proof-${runKey}.md`,
            media_type: 'text/markdown',
            content: `# Governed identity proof\n\nReference: ${isolationQuery}\n\nUse approved evidence only.\n`,
          });
          const created = await adapter.createCandidate(architect, upload.id, {
            candidate_type: 'best_practice',
            title: `Governed identity proof ${isolationQuery}`,
            payload: {
              schema_version: 1,
              purpose: 'Verify bounded capture, review, and draft promotion.',
              constraints: ['Use approved public evidence only.'],
            },
          });
          const listed = await adapter.listCandidates(architect);
          const item = Array.isArray(listed?.items)
            ? listed.items.find((value) => value.id === created.id)
            : null;
          return { upload, candidate: created, listed: item };
        },
        (value) => value?.upload?.status === 'ready_for_review'
          && value?.upload?.seal?.status === 'sealed'
          && value.upload.seal.owner_enforced === true
          && value.upload.seal.read_only_mode === '0440'
          && value.upload.seal.sha256 === value.upload.sha256
          && value?.candidate?.status === 'review_pending'
          && Number.isInteger(value?.candidate?.revision)
          && HASH.test(value?.candidate?.content_hash || '')
          && value?.candidate?.source_upload_sha256 === value?.upload?.sha256
          && value?.candidate?.submitted_by_principal_id === architect.actor.principal_id
          && value?.listed?.status === 'review_pending'
          && typeof value?.listed?.produced_by_principal_key === 'string'
          && value.listed.produced_by_principal_key.startsWith('service:')
          && value?.listed?.submitted_by_principal_key === architect.actor.principal_key
          && value?.listed?.source_upload_sha256 === value?.upload?.sha256
          && Array.isArray(value?.listed?.evidence)
          && value.listed.evidence.length === 1
          && value.listed.evidence[0]?.evidence_kind === 'upload_text'
          && value.listed.evidence[0]?.evidence_ref === `sha256:${value.upload.sha256}`,
        (value) => ({
          upload_validated: value?.upload?.status === 'ready_for_review',
          upload_hash_sealed: value?.upload?.seal?.status === 'sealed'
            && value?.upload?.seal?.sha256 === value?.upload?.sha256,
          root_owned_read_only: value?.upload?.seal?.owner_enforced === true
            && value?.upload?.seal?.read_only_mode === '0440',
          candidate_review_pending: value?.candidate?.status === 'review_pending',
          produced_by_governed_service: value?.listed?.produced_by_principal_key?.startsWith('service:') === true,
          submitted_by_authenticated_human: value?.listed?.submitted_by_principal_key
            === architect?.actor?.principal_key,
          source_hash_bound: value?.candidate?.source_upload_sha256 === value?.upload?.sha256,
          evidence_derived_from_upload: value?.listed?.evidence?.[0]?.evidence_ref
            === `sha256:${value?.upload?.sha256}`,
          content_hash_present: HASH.test(value?.candidate?.content_hash || ''),
        }),
      );
      candidate = quarantine?.candidate || null;
    } else {
      recorder.skip('QUA-01');
    }

    const candidateIsolation = candidate && readiness ? await recorder.check(
      'QUA-02',
      () => adapter.publicSearch(isolationQuery),
      noMatch,
      (value) => ({ no_match: noMatch(value), result_status: value?.status || null }),
    ) : null;
    if (!candidateIsolation) recorder.skip('QUA-02');

    let promoted = null;
    if (candidate && reviewer && candidateIsolation) {
      const reviewed = await recorder.check(
        'GOV-01',
        async () => {
          const review = await adapter.reviewCandidate(reviewer, candidate.id, {
            action: 'approve_for_draft',
            reason: 'Evidence is bounded, public-safe, and suitable for an architect draft decision.',
            expected_revision: candidate.revision,
          });
          const listed = await adapter.listCandidates(reviewer);
          return {
            review,
            candidate: listed?.items?.find((value) => value.id === candidate.id) || null,
          };
        },
        (value) => value?.review?.status === 'reviewed'
          && Number.isInteger(value?.review?.revision)
          && value.review.revision === candidate.revision + 1
          && HASH.test(value?.candidate?.content_hash || '')
          && value.candidate.approved_content_hash === value.candidate.content_hash
          && value.candidate.reviews?.at(-1)?.candidate_content_hash === value.candidate.content_hash,
        (value) => ({
          independent_actor: reviewer.actor.principal_id !== architect?.actor?.principal_id,
          status: value?.review?.status || null,
          revision_advanced_once: value?.review?.revision === candidate.revision + 1,
          approved_hash_bound: value?.candidate?.approved_content_hash
            === value?.candidate?.content_hash,
          review_hash_bound: value?.candidate?.reviews?.at(-1)?.candidate_content_hash
            === value?.candidate?.content_hash,
        }),
      );
      if (reviewed && architect) {
        promoted = await recorder.check(
          'GOV-02',
          () => adapter.promoteCandidate(architect, candidate.id, {
            expected_revision: reviewed.review.revision,
          }),
          (value) => value?.review_status === 'draft'
            && UUID.test(value?.draft_id || '')
            && typeof value?.draft_key === 'string',
          (value) => ({
            review_status: value?.review_status || null,
            draft_created: UUID.test(value?.draft_id || ''),
            canonical_write_claimed: value?.review_status !== 'draft',
          }),
        );
      } else {
        recorder.skip('GOV-02');
      }
    } else {
      recorder.skip('GOV-01');
      recorder.skip('GOV-02');
    }
    if (promoted) {
      await recorder.check(
        'GOV-03',
        () => adapter.publicSearch(isolationQuery),
        noMatch,
        (value) => ({ no_match: noMatch(value), result_status: value?.status || null }),
      );
    } else {
      recorder.skip('GOV-03');
    }

    let prepared = null;
    if (provisioned) {
      try {
        prepared = await adapter.prepareSuspensionProbe(
          provisioned.binding,
          provisioned.agent.principal_key,
        );
      } catch {
        prepared = null;
      }
    }
    const suspended = provisioned && architect ? await recorder.check(
      'SUS-01',
      async () => {
        const response = await adapter.suspend(
          architect,
          provisioned.agent.id,
          'End the bounded identity proof and revoke every runtime authorization.',
        );
        const access = await adapter.effectiveAccess(architect, provisioned.agent.id);
        const state = await adapter.state(architect);
        const principal = Array.isArray(state?.principals)
          ? state.principals.find((item) => item.id === provisioned.agent.id)
          : null;
        return { response, access, principal, state };
      },
      (value) => value?.response?.principal?.status === 'suspended'
        && value?.response?.enforcement?.record?.status === 'succeeded'
        && value?.principal?.status === 'suspended'
        && Array.isArray(value?.access?.permissions)
        && value.access.permissions.length === 0,
      (value) => ({
        principal_suspended: value?.principal?.status === 'suspended',
        enforcement_succeeded: value?.response?.enforcement?.record?.status === 'succeeded',
        effective_permission_count: Array.isArray(value?.access?.permissions)
          ? value.access.permissions.length
          : -1,
      }),
    ) : null;

    if (suspended) {
      await recorder.check(
        'SUS-02',
        () => adapter.host(provisioned.binding, provisioned.agent.principal_key, 'suspended'),
        (value) => value?.user_exists && value?.locked_shell && value?.account_locked
          && !value?.service_active && value?.credential_files_absent
          && !value?.broker_group_member,
        (value) => ({
          identity_preserved_for_audit: value?.user_exists === true,
          locked_shell: value?.locked_shell === true,
          account_locked: value?.account_locked === true,
          service_stopped: value?.service_active === false,
          credential_files_absent: value?.credential_files_absent === true,
          broker_group_removed: value?.broker_group_member === false,
        }),
      );
      if (prepared?.captured) {
        await recorder.check(
          'SUS-03',
          () => adapter.suspendedBroker(provisioned.agent.principal_key),
          (value) => value?.status === 401 && value?.code === 'authentication_failed',
          (value) => ({
            rejected: value?.status === 401,
            authorization_absent: !value?.authorization,
            denial_class: value?.code === 'authentication_failed' ? 'inactive_credential' : 'unexpected',
          }),
        );
      } else {
        recorder.skip('SUS-03', 'pre_suspension_credential_not_captured');
      }
    } else {
      recorder.skip('SUS-02');
      recorder.skip('SUS-03');
    }
  }

  const report = createIdentityProofReport({
    environment,
    source_commit: sourceCommit,
    source_sha256: sourceSha256,
    migration_sha256: migrationSha256,
    harness_sha256: harnessSha256,
    generated_at: generatedAt,
    results: recorder.complete(),
  });
  const publicProjection = createPublicIdentityProofProjection(report);
  if (outputDirectory) {
    await writeIdentityProofBundle(outputDirectory, report);
    await writePublicProjection(outputDirectory, publicProjection);
  }
  return Object.freeze({ report, publicProjection, outputDirectory });
}

async function sha256Files(paths) {
  const digest = crypto.createHash('sha256');
  for (const filePath of paths) {
    digest.update(path.basename(filePath));
    digest.update('\0');
    digest.update(await fs.readFile(filePath));
    digest.update('\0');
  }
  return digest.digest('hex');
}

async function sourceCommit() {
  const result = await runFile('/usr/bin/git', ['rev-parse', 'HEAD'], {
    cwd: projectRoot,
    env: { LANG: 'C.UTF-8', PATH: '/usr/bin:/bin' },
  });
  const commit = result.stdout.trim();
  return /^[0-9a-f]{40}$/.test(commit) ? commit : 'unknown';
}

export async function runIdentityPlaneProofCli(env = process.env) {
  const mode = env.OAM_IDENTITY_PROOF_MODE || 'dry-run';
  const outputDirectory = path.resolve(
    projectRoot,
    env.OAM_IDENTITY_PROOF_OUTPUT || 'artifacts/evaluation/identity-plane-proof',
  );
  if (outputDirectory !== projectRoot && !outputDirectory.startsWith(`${projectRoot}${path.sep}`)) {
    throw new TypeError('Proof output directory must be inside the project.');
  }
  const migrationFiles = [
    path.join(projectRoot, 'sql/capability_memory_schema_v1.sql'),
    path.join(projectRoot, 'sql/capability_memory_schema_v2.sql'),
    path.join(projectRoot, 'sql/identity_data_plane_v1.sql'),
    path.join(projectRoot, 'sql/identity_data_plane_v2_public_asset_eligibility.sql'),
    path.join(projectRoot, 'sql/identity_data_plane_v3_capture_integrity.sql'),
    path.join(projectRoot, 'sql/identity_data_plane_v4_provisioning_scope.sql'),
    path.join(projectRoot, 'sql/identity_data_plane_v5_audit_scope.sql'),
    path.join(projectRoot, 'sql/identity_data_plane_v6_security_review.sql'),
    path.join(projectRoot, 'sql/identity_data_plane_v7_operator_context.sql'),
    path.join(projectRoot, 'sql/identity_policy_plane_v1.sql'),
    path.join(projectRoot, 'sql/identity_demo_seed_v1.sql'),
    path.join(projectRoot, 'sql/identity_operator_context_seed_v1.sql'),
    path.join(projectRoot, 'sql/identity_runtime_logins_v1.sql'),
  ];
  const source = await calculateSourceBuildDigest(projectRoot);
  const common = {
    mode,
    confirmMutations: env.OAM_IDENTITY_PROOF_CONFIRM_MUTATIONS || '',
    outputDirectory,
    environment: env.OAM_IDENTITY_PROOF_ENVIRONMENT || 'target-instance',
    sourceCommit: await sourceCommit(),
    sourceSha256: source.sha256,
    migrationSha256: await sha256Files(migrationFiles),
    harnessSha256: await sha256Files([
      scriptPath,
      path.join(projectRoot, 'scripts/evaluation/identity-proof-report.mjs'),
      path.join(projectRoot, 'scripts/evaluation/verify_identity_proof.mjs'),
      path.join(projectRoot, 'app/lib/public-identity-proof.mjs'),
    ]),
  };
  if (mode === 'dry-run') return runIdentityPlaneProof(common);
  if (mode !== 'live') throw new TypeError('OAM_IDENTITY_PROOF_MODE must be dry-run or live.');
  const credentialPath = env.OAM_IDENTITY_PROOF_CREDENTIAL_FILE;
  const databaseCredentialFile = env.OAM_IDENTITY_PROOF_DB_CREDENTIAL_FILE;
  if (!credentialPath || !databaseCredentialFile) {
    throw new TypeError('Live proof credential files are required.');
  }
  const credentials = await loadProofCredentials(credentialPath);
  const adapter = createLiveIdentityProofAdapter({
    operatorBaseUrl: env.OAM_IDENTITY_PROOF_OPERATOR_URL || 'http://127.0.0.1:3010',
    publicBaseUrl: env.OAM_IDENTITY_PROOF_PUBLIC_URL || 'http://127.0.0.1:3000',
    databaseCredentialFile,
    brokerSocketPath: env.OAM_IDENTITY_PROOF_BROKER_SOCKET
      || '/run/organizational-ai-memory-broker/agent.sock',
  });
  return runIdentityPlaneProof({ ...common, adapter, credentials });
}

function isMain() {
  return process.argv[1]
    && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isMain()) {
  try {
    const output = await runIdentityPlaneProofCli();
    console.log(JSON.stringify({
      overall_status: output.report.overall_status,
      counts: output.report.counts,
      output_directory: output.outputDirectory,
    }));
    if (output.report.overall_status !== 'PASS') process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ error: { code: safeErrorCode(error) } }));
    process.exitCode = 1;
  }
}
