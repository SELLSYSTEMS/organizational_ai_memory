import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export async function verifyIdentityProofBundle(directory) {
  const manifest = await fs.readFile(path.join(directory, 'manifest.sha256'), 'utf8');
  const checks = [];
  for (const line of manifest.trim().split('\n')) {
    const match = line.match(/^([0-9a-f]{64})  ([a-z0-9.]+)$/);
    if (!match) throw new Error('identity_proof_manifest_invalid');
    const [, expected, name] = match;
    const actual = sha256(await fs.readFile(path.join(directory, name)));
    checks.push({ name, expected, actual, passed: expected === actual });
  }
  const report = JSON.parse(await fs.readFile(path.join(directory, 'report.json'), 'utf8'));
  const passed = checks.every((check) => check.passed)
    && report.overall_status === 'PASS'
    && report.results.every((result) => !result.required || result.status === 'PASS');
  return { passed, checks, overall_status: report.overall_status };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const directory = path.resolve(process.argv[2] || 'artifacts/evaluation/iam-isolation-proof');
  const result = await verifyIdentityProofBundle(directory);
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}
