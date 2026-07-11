import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..', '..');

function runNode(relativePath, args = [], { capture = false } = {}) {
  return execFileSync(process.execPath, [path.join(repositoryRoot, relativePath), ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });
}

runNode('scripts/evaluation/verify_public_repository.mjs');
runNode('scripts/evaluation/verify_identity_proof.mjs', [
  'artifacts/evaluation/identity-plane-proof',
]);
runNode('scripts/evaluation/verify_release_media_manifest.mjs');

const expectedSource = JSON.parse(fs.readFileSync(
  path.join(repositoryRoot, 'artifacts/evaluation/identity-plane-proof/report.json'),
  'utf8',
));
if (!/^[0-9a-f]{40}$/.test(expectedSource.source_commit || '')) {
  throw new Error('Identity proof source commit is missing or malformed.');
}
execFileSync('git', ['cat-file', '-e', `${expectedSource.source_commit}^{commit}`], {
  cwd: repositoryRoot,
  stdio: 'ignore',
});
execFileSync('git', ['merge-base', '--is-ancestor', expectedSource.source_commit, 'HEAD'], {
  cwd: repositoryRoot,
  stdio: 'ignore',
});

const expectedSourceDigest = expectedSource.source_sha256;
const actualSource = runNode('app/lib/source-build-digest.mjs', ['.'], { capture: true }).trim();
if (actualSource !== expectedSourceDigest) {
  throw new Error(
    `Source digest mismatch: expected ${expectedSourceDigest}, received ${actualSource}.`,
  );
}

console.log(JSON.stringify({
  public_repository: 'PASS',
  identity_proof: 'PASS',
  release_media: 'PASS',
  source_commit: expectedSource.source_commit,
  source_sha256: actualSource,
  passed: true,
}, null, 2));
