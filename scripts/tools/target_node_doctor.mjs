import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const outputPath = process.argv[2] || path.join(repoRoot, 'artifacts', 'runtime', `target_node_doctor_${Date.now()}.json`);

function parseEnvText(text) {
  const parsed = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const normalized = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const match = normalized.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    let value = rawValue.trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    parsed[key] = value;
  }

  return parsed;
}

async function loadPlatformEnv() {
  const envPath = process.env.PLATFORM_ENV_PATH || path.join(process.env.APP_ETC_ROOT || '/etc/tg_ops', 'platform.env');
  const content = await fs.readFile(envPath, 'utf8').catch(() => null);
  if (!content) {
    return { path: envPath, loaded: false };
  }

  const parsed = parseEnvText(content);
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  return { path: envPath, loaded: true };
}

function runCommand(cmd, args) {
  try {
    const stdout = execFileSync(cmd, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return { ok: true, stdout };
  } catch (error) {
    return {
      ok: false,
      stdout: String(error.stdout ?? '').trim(),
      stderr: String(error.stderr ?? '').trim(),
      status: error.status ?? 1,
    };
  }
}

async function checkPlaywright() {
  try {
    await import('playwright');
    return { ok: true, details: 'module_resolved' };
  } catch (error) {
    return { ok: false, details: error.message };
  }
}

async function checkPg() {
  try {
    const mod = await import('pg');
    const { Client } = mod.default ?? mod;
    const client = new Client(
      process.env.DATABASE_URL
        ? { connectionString: process.env.DATABASE_URL }
        : {
            host: process.env.PGHOST || '127.0.0.1',
            port: parseInt(process.env.PGPORT || '5432', 10),
            database: process.env.PGDATABASE || 'tg_ops',
            user: process.env.PGUSER || 'tg_ops',
            password: process.env.PGPASSWORD || '',
            connectionTimeoutMillis: 2000,
          },
    );
    await client.connect();
    const res = await client.query('select 1 as ok');
    await client.end();
    return { ok: true, details: res.rows[0] };
  } catch (error) {
    return { ok: false, details: error.message };
  }
}

async function checkHttp(name, url) {
  try {
    const res = await fetch(url);
    const text = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      details: text.slice(0, 300),
      url,
      name,
    };
  } catch (error) {
    return { ok: false, status: 0, details: error.message, url, name };
  }
}

async function checkGitHubDoctor() {
  const script = path.join(repoRoot, 'scripts', 'tools', 'github_doctor.mjs');
  if (!(await fs.stat(script).catch(() => null))) {
    return { ok: false, details: 'github_doctor_missing' };
  }

  const result = runCommand('node', [script]);
  return {
    ok: result.ok,
    details: result.ok ? result.stdout : `${result.stderr || result.stdout}`.trim(),
  };
}

async function main() {
  const platformEnv = await loadPlatformEnv();
  const codex = runCommand('codex', ['--version']);
  const git = runCommand('git', ['--version']);
  const node = runCommand('node', ['-v']);
  const npm = runCommand('npm', ['-v']);
  const githubDoctor = await checkGitHubDoctor();
  const playwright = await checkPlaywright();
  const postgres = await checkPg();
  const qdrant = await checkHttp('qdrant', `${(process.env.QDRANT_URL || 'http://127.0.0.1:6333').replace(/\/+$/, '')}/`);
  const tei = await checkHttp('tei', `${(process.env.EMBED_BASE_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '')}/health`);

  const stat = await fs.statfs(repoRoot);
  const diskFreeBytes = stat.bavail * stat.bsize;

  const payload = {
    schema_version: 'v1',
    generated_at: new Date().toISOString(),
    repo_root: repoRoot,
    runtime: {
      user: os.userInfo().username,
      hostname: os.hostname(),
      platform: process.platform,
      arch: process.arch,
      loadavg: os.loadavg(),
      totalmem_bytes: os.totalmem(),
      freemem_bytes: os.freemem(),
      repo_disk_free_bytes: diskFreeBytes,
      platform_env: platformEnv,
    },
    checks: {
      node: { ok: node.ok, details: node.stdout || node.stderr || null },
      npm: { ok: npm.ok, details: npm.stdout || npm.stderr || null },
      git: { ok: git.ok, details: git.stdout || git.stderr || null },
      codex: { ok: codex.ok, details: codex.stdout || codex.stderr || null },
      playwright,
      github_doctor: githubDoctor,
      postgres,
      qdrant,
      tei,
    },
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(payload, null, 2));
  console.log(`WROTE=${outputPath}`);
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exit(1);
});
