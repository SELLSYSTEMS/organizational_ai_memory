import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const STATUSES = new Set(['PASS', 'FAIL', 'NOT_RUN', 'NOT_APPLICABLE']);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeXml(value) {
  return escapeHtml(value);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function safeText(value, max = 1_000) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
}

function validateResult(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Proof result is required.');
  if (!/^[A-Z]+-[0-9]{2,3}$/.test(input.id)) throw new TypeError('Proof result ID is invalid.');
  if (!STATUSES.has(input.status)) throw new TypeError('Proof result status is invalid.');
  if (typeof input.required !== 'boolean') throw new TypeError('Proof result required flag is invalid.');
  return Object.freeze({
    id: input.id,
    category: safeText(input.category, 80),
    title: safeText(input.title, 200),
    required: input.required,
    status: input.status,
    expected: safeText(input.expected, 500),
    observed: safeText(input.observed, 1_000),
    enforcement_point: safeText(input.enforcement_point, 200),
    evidence_sha256: /^[0-9a-f]{64}$/.test(input.evidence_sha256 || '')
      ? input.evidence_sha256
      : sha256(stableJson(input.evidence || {})),
    duration_ms: Math.max(0, Math.round(Number(input.duration_ms) || 0)),
  });
}

export function createIdentityProofReport({
  environment,
  source_commit,
  source_sha256,
  migration_sha256,
  harness_sha256,
  generated_at = new Date().toISOString(),
  results = [],
}) {
  if (!/^[0-9a-f]{64}$/.test(source_sha256 || '')) {
    throw new TypeError('Source SHA-256 is required.');
  }
  const normalized = results.map(validateResult).sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(normalized.map((result) => result.id)).size !== normalized.length) {
    throw new TypeError('Proof result IDs must be unique.');
  }
  const requiredFailures = normalized.filter((result) =>
    result.required && result.status !== 'PASS');
  const counts = Object.fromEntries([...STATUSES].map((status) => [
    status.toLowerCase(),
    normalized.filter((result) => result.status === status).length,
  ]));
  return Object.freeze({
    schema_version: 1,
    product: 'Organizational AI Memory',
    environment: safeText(environment, 80),
    source_commit: safeText(source_commit, 80),
    source_sha256,
    migration_sha256: safeText(migration_sha256, 64),
    harness_sha256: safeText(harness_sha256, 64),
    generated_at,
    overall_status: requiredFailures.length ? 'FAIL' : 'PASS',
    counts,
    results: normalized,
  });
}

function reportHtml(report) {
  const rows = report.results.map((result) => `
    <tr>
      <td><code>${escapeHtml(result.id)}</code></td>
      <td>${escapeHtml(result.category)}</td>
      <td>${escapeHtml(result.title)}</td>
      <td><strong>${escapeHtml(result.status)}</strong></td>
      <td>${escapeHtml(result.expected)}</td>
      <td>${escapeHtml(result.observed)}</td>
      <td>${escapeHtml(result.enforcement_point)}</td>
    </tr>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Organizational AI Memory identity proof</title>
<style>body{font:14px/1.45 system-ui,sans-serif;margin:32px;color:#17211e;background:#fff}h1{font-size:26px}dl{display:grid;grid-template-columns:160px 1fr;max-width:840px}dt,dd{padding:5px 0;margin:0;border-bottom:1px solid #d8dfdc}table{border-collapse:collapse;width:100%;margin-top:24px}th,td{border:1px solid #d8dfdc;padding:8px;text-align:left;vertical-align:top}th{background:#f4f7f6}code{overflow-wrap:anywhere}.PASS{color:#06735f}.FAIL{color:#b42318}</style></head>
<body><h1>Organizational AI Memory identity proof</h1>
<dl><dt>Overall</dt><dd class="${escapeHtml(report.overall_status)}">${escapeHtml(report.overall_status)}</dd><dt>Environment</dt><dd>${escapeHtml(report.environment)}</dd><dt>Generated</dt><dd>${escapeHtml(report.generated_at)}</dd><dt>Source commit</dt><dd><code>${escapeHtml(report.source_commit)}</code></dd><dt>Source digest</dt><dd><code>${escapeHtml(report.source_sha256)}</code></dd><dt>Migration hash</dt><dd><code>${escapeHtml(report.migration_sha256)}</code></dd></dl>
<table><thead><tr><th>ID</th><th>Category</th><th>Requirement</th><th>Status</th><th>Expected</th><th>Observed</th><th>Enforcement</th></tr></thead><tbody>${rows}</tbody></table></body></html>\n`;
}

function junitXml(report) {
  const failures = report.results.filter((result) => result.required && result.status !== 'PASS').length;
  const cases = report.results.map((result) => {
    const failure = result.required && result.status !== 'PASS'
      ? `<failure message="${escapeXml(result.status)}">${escapeXml(result.observed)}</failure>`
      : '';
    const skipped = !result.required && result.status !== 'PASS'
      ? `<skipped message="${escapeXml(result.status)}"/>`
      : '';
    return `<testcase classname="${escapeXml(result.category)}" name="${escapeXml(`${result.id} ${result.title}`)}" time="${(result.duration_ms / 1000).toFixed(3)}">${failure}${skipped}</testcase>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><testsuite name="oam-identity-proof" tests="${report.results.length}" failures="${failures}">${cases}</testsuite>\n`;
}

export async function writeIdentityProofBundle(outputDirectory, report) {
  await fs.mkdir(outputDirectory, { recursive: true });
  const files = {
    'report.json': `${JSON.stringify(report, null, 2)}\n`,
    'report.html': reportHtml(report),
    'junit.xml': junitXml(report),
  };
  for (const [name, content] of Object.entries(files)) {
    await fs.writeFile(path.join(outputDirectory, name), content, { mode: 0o644 });
  }
  const manifest = Object.entries(files)
    .map(([name, content]) => `${sha256(content)}  ${name}`)
    .sort()
    .join('\n');
  await fs.writeFile(path.join(outputDirectory, 'manifest.sha256'), `${manifest}\n`, { mode: 0o644 });
  return { outputDirectory, manifest_sha256: sha256(`${manifest}\n`) };
}
