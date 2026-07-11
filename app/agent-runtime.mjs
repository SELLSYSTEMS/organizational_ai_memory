import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;

const DEFAULT_PROBES = Object.freeze([
  ['repository_read', '/home/admin/organizational-ai-memory/README.md'],
  ['installed_application_read', '/opt/organizational-ai-memory/app/server.mjs'],
  ['application_environment_read', '/etc/tg_ops/platform.env'],
  ['model_authentication_read', '/var/lib/oam-codex/.codex/auth.json'],
]);

function boundedText(value, max = 240) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').slice(0, max);
}

async function atomicJson(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporaryPath, filePath);
}

async function accessProbe(label, targetPath) {
  try {
    await fs.access(targetPath);
    return { label, expected: 'denied', actual: 'allowed', passed: false };
  } catch (error) {
    const denied = error?.code === 'EACCES' || error?.code === 'EPERM';
    return {
      label,
      expected: 'denied',
      actual: denied ? 'denied' : 'probe_failed',
      passed: denied,
      code: boundedText(denied ? error.code : 'access_probe_failed', 40),
    };
  }
}

async function ownWorkspaceProbe(stateDirectory) {
  const probePath = path.join(stateDirectory, '.workspace-write-proof');
  try {
    await fs.writeFile(probePath, 'workspace-write-allowed\n', { mode: 0o600 });
    await fs.rm(probePath, { force: true });
    return { label: 'own_workspace_write', expected: 'allowed', actual: 'allowed', passed: true };
  } catch (error) {
    return {
      label: 'own_workspace_write',
      expected: 'allowed',
      actual: 'denied',
      passed: false,
      code: boundedText(error?.code || 'write_failed', 40),
    };
  }
}

async function postgresProbe(osUser) {
  try {
    await execFileAsync('/usr/bin/psql', ['-X', '-w', '-d', 'tg_ops', '-c', 'SELECT 1'], {
      timeout: 3_000,
      maxBuffer: 8_192,
      env: {
        HOME: '/var/empty',
        LANG: 'C.UTF-8',
        PATH: '/usr/bin:/bin',
        PGHOST: '/var/run/postgresql',
        PGUSER: osUser,
      },
    });
    return { label: 'direct_postgres_connect', expected: 'denied', actual: 'allowed', passed: false };
  } catch (error) {
    const stderr = String(error?.stderr || '');
    const denied = /FATAL:\s+(?:role .* does not exist|Peer authentication failed|password authentication failed)|permission denied/i.test(stderr);
    return {
      label: 'direct_postgres_connect',
      expected: 'denied',
      actual: denied ? 'denied' : 'probe_failed',
      passed: denied,
      code: denied ? 'postgres_authority_denied' : 'postgres_probe_failed',
    };
  }
}

export async function requestBrokerRecommendation({ socketPath, token, principalKey }) {
  const body = JSON.stringify({ task: 'website delivery handoff' });
  return new Promise((resolve) => {
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
          resolve({ passed: false, status: response.statusCode, reason: 'response_too_large' });
          return;
        }
        try {
          const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const passed = response.statusCode === 200
            && payload?.authorization === 'allowed'
            && typeof payload?.capability?.asset_key === 'string'
            && Array.isArray(payload?.capability?.source_turn_ids)
            && payload.capability.source_turn_ids.length > 0;
          resolve({
            passed,
            status: response.statusCode,
            authorization: boundedText(payload?.authorization, 40),
            asset_key: boundedText(payload?.capability?.asset_key, 120),
            source_count: Array.isArray(payload?.capability?.source_turn_ids)
              ? payload.capability.source_turn_ids.length
              : 0,
            policy_hash: boundedText(payload?.policy_hash, 64),
          });
        } catch {
          resolve({ passed: false, status: response.statusCode, reason: 'invalid_json' });
        }
      });
    });
    request.on('timeout', () => request.destroy(new Error('broker_timeout')));
    request.on('error', (error) => resolve({ passed: false, reason: boundedText(error?.message, 80) }));
    request.end(body);
  });
}

export async function requestBrokerPersonalContext({ socketPath, token, principalKey, query }) {
  const body = JSON.stringify({ query });
  return new Promise((resolve) => {
    const request = http.request({
      socketPath,
      path: '/v1/agent/personal-context',
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
        if (size <= 65_536) chunks.push(chunk);
      });
      response.on('end', () => {
        if (size > 65_536) {
          resolve({ passed: false, status: response.statusCode, reason: 'response_too_large' });
          return;
        }
        try {
          const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const items = Array.isArray(payload?.items) ? payload.items : [];
          const citations = Array.isArray(payload?.citations) ? payload.citations : [];
          const citationsValid = items.length === citations.length && items.every((item, index) => {
            const citation = item?.citation;
            const projected = citations[index];
            const sourceType = item?.source_type;
            const typedIdField = sourceType === 'profile' ? 'profile_id' : 'memory_id';
            return ['memory', 'profile'].includes(sourceType)
              && UUID.test(item?.id || '')
              && Number.isSafeInteger(item?.revision)
              && item.revision >= 1
              && SHA256.test(item?.content_sha256 || '')
              && citation?.source_type === sourceType
              && citation?.source_id === item.id
              && citation?.[typedIdField] === item.id
              && citation?.revision === item.revision
              && citation?.content_sha256 === item.content_sha256
              && projected?.source_type === citation.source_type
              && projected?.source_id === citation.source_id
              && projected?.[typedIdField] === citation[typedIdField]
              && projected?.revision === citation.revision
              && projected?.content_sha256 === citation.content_sha256;
          });
          resolve({
            passed: response.statusCode === 200
              && payload?.authorization === 'allowed'
              && citationsValid
              && UUID.test(payload?.audit_event_key || ''),
            status: response.statusCode,
            authorization: boundedText(payload?.authorization, 40),
            matched_count: items.length,
            citation_count: citations.length,
            audit_event_key: boundedText(payload?.audit_event_key, 80),
            citation_digests: citationsValid ? citations.map((citation) => ({
              source_type: citation.source_type,
              source_id: citation.source_id,
              revision: citation.revision,
              content_sha256: citation.content_sha256,
            })) : [],
          });
        } catch {
          resolve({ passed: false, status: response.statusCode, reason: 'invalid_json' });
        }
      });
    });
    request.on('timeout', () => request.destroy(new Error('broker_timeout')));
    request.on('error', (error) => resolve({ passed: false, reason: boundedText(error?.message, 80) }));
    request.end(body);
  });
}

export async function runAgentProof(options = {}) {
  const stateDirectory = options.stateDirectory || process.env.OAM_AGENT_STATE_DIR;
  const tokenFile = options.tokenFile || process.env.OAM_AGENT_TOKEN_FILE;
  const principalKeyFile = options.principalKeyFile || process.env.OAM_AGENT_PRINCIPAL_KEY_FILE;
  const principalKey = options.principalKey
    || process.env.OAM_AGENT_PRINCIPAL_KEY
    || (principalKeyFile ? (await fs.readFile(principalKeyFile, 'utf8')).trim() : '');
  const osUser = options.osUser || process.env.OAM_AGENT_OS_USER || process.env.USER;
  const socketPath = options.socketPath
    || process.env.OAM_AGENT_BROKER_SOCKET
    || '/run/organizational-ai-memory-broker/agent.sock';
  if (!stateDirectory || !tokenFile || !principalKey || !osUser) {
    throw new Error('agent_runtime_configuration_invalid');
  }

  const token = (await fs.readFile(tokenFile, 'utf8')).trim();
  const access = await Promise.all((options.probes || DEFAULT_PROBES)
    .map(([label, targetPath]) => accessProbe(label, targetPath)));
  const workspace = await ownWorkspaceProbe(stateDirectory);
  const postgres = await postgresProbe(osUser);
  const broker = await requestBrokerRecommendation({ socketPath, token, principalKey });
  const personalQuery = options.personalQuery || process.env.OAM_AGENT_PERSONAL_CONTEXT_QUERY || '';
  const personalBroker = personalQuery
    ? await requestBrokerPersonalContext({
      socketPath,
      token,
      principalKey,
      query: personalQuery,
    })
    : null;
  const checks = [...access, workspace, postgres];
  const passed = checks.every((check) => check.passed)
    && broker.passed
    && (!personalBroker || personalBroker.passed);
  const result = {
    schema_version: 1,
    principal_key: principalKey,
    runtime_user: osUser,
    checked_at: new Date().toISOString(),
    passed,
    checks,
    broker,
    personal_broker: personalBroker,
  };
  await atomicJson(path.join(stateDirectory, 'agent-proof.json'), result);
  return result;
}

async function main() {
  const run = async () => {
    try {
      await runAgentProof();
    } catch (error) {
      const stateDirectory = process.env.OAM_AGENT_STATE_DIR;
      if (stateDirectory) {
        await atomicJson(path.join(stateDirectory, 'agent-proof.json'), {
          schema_version: 1,
          checked_at: new Date().toISOString(),
          passed: false,
          error: boundedText(error?.message || 'agent_runtime_failed', 120),
        }).catch(() => {});
      }
    }
  };
  await run();
  if (!process.argv.includes('--once')) setInterval(() => {}, 60_000);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => {
    process.exitCode = 1;
  });
}
