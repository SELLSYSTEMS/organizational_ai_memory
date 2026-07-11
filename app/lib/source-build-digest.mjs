import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOTS = Object.freeze([
  'app',
  'deploy/codex',
  'deploy/systemd',
  'deploy/nginx/organizational-ai-memory.conf.example',
  'sql',
  'scripts/demo/bootstrap_demo_corpora.mjs',
  'scripts/demo/import_capability_pack.mjs',
  'scripts/deploy/install_codex_sidecar.sh',
  'scripts/deploy/install_identity_plane.sh',
  'scripts/evaluation/identity-proof-report.mjs',
  'scripts/evaluation/run_identity_plane_proof.mjs',
  'scripts/evaluation/verify_identity_proof.mjs',
  'package.json',
  'package-lock.json',
  'node_modules',
]);

async function collectFiles(root, relative, output) {
  const absolute = path.join(root, relative);
  const stat = await fs.lstat(absolute);
  if (stat.isSymbolicLink()) {
    const normalized = relative.split(path.sep).join('/');
    const target = await fs.readlink(absolute);
    const resolved = path.resolve(path.dirname(absolute), target);
    const dependencyRoot = path.join(root, 'node_modules');
    const safeDependencyBinLink = normalized.startsWith('node_modules/.bin/')
      && !path.isAbsolute(target)
      && resolved.startsWith(`${dependencyRoot}${path.sep}`);
    if (!safeDependencyBinLink) throw new Error(`source_digest_symlink:${relative}`);
    return;
  }
  if (stat.isFile()) {
    output.push(relative.split(path.sep).join('/'));
    return;
  }
  if (!stat.isDirectory()) throw new Error(`source_digest_unsupported_entry:${relative}`);
  const entries = await fs.readdir(absolute, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    await collectFiles(root, path.join(relative, entry.name), output);
  }
}

export async function calculateSourceBuildDigest(projectRoot) {
  const root = path.resolve(projectRoot);
  const files = [];
  for (const relative of ROOTS) await collectFiles(root, relative, files);
  files.sort();
  const digest = crypto.createHash('sha256');
  for (const relative of files) {
    digest.update(relative);
    digest.update('\0');
    digest.update(await fs.readFile(path.join(root, relative)));
    digest.update('\0');
  }
  return Object.freeze({ sha256: digest.digest('hex'), files: Object.freeze(files) });
}

async function main() {
  const result = await calculateSourceBuildDigest(process.argv[2] || process.cwd());
  process.stdout.write(`${result.sha256}\n`);
}

if (process.argv[1]
    && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error?.message || 'source_digest_failed'}\n`);
    process.exitCode = 1;
  });
}
