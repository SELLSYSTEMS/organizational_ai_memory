import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..', '..');
const releaseManifestPath = path.join(
  repositoryRoot,
  'artifacts',
  'submission',
  'media',
  'release-media-manifest.json',
);
const releaseManifest = JSON.parse(fs.readFileSync(releaseManifestPath, 'utf8'));
const publishingGuide = 'docs/submission/PUBLISHING.md';

function gitOutput(args, options = {}) {
  return execFileSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    ...options,
  });
}

function gitBuffer(args, options = {}) {
  return execFileSync('git', args, {
    cwd: repositoryRoot,
    encoding: null,
    maxBuffer: 256 * 1024 * 1024,
    ...options,
  });
}

function trackedFiles() {
  return gitOutput(['ls-files', '-z']).split('\0').filter(Boolean);
}

function isBinary(buffer) {
  return buffer.includes(0);
}

function lineNumber(text, offset) {
  return text.slice(0, offset).split('\n').length;
}

function isExamplePath(relativePath) {
  return relativePath.includes('/examples/')
    || /(^|\/)[^/]*\.example(?:\.|$)/.test(relativePath);
}

function binaryKind(relativePath) {
  if (relativePath.endsWith('.png')) return 'png';
  if (relativePath.endsWith('.mp4')) return 'mp4';
  if (relativePath.endsWith('.webm')) return 'webm';
  return null;
}

function binarySignatureMatches(kind, buffer) {
  if (kind === 'png') {
    return buffer.length >= 8
      && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  }
  if (kind === 'mp4') {
    return buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp';
  }
  if (kind === 'webm') {
    return buffer.length >= 4
      && buffer.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex'));
  }
  return false;
}

const releaseBinaryEntries = [
  releaseManifest.media?.mp4,
  releaseManifest.media?.webm,
  ...(releaseManifest.media?.employee_screenshots || []),
  ...(releaseManifest.media?.public_screenshots || []),
].filter(Boolean);
const reviewedBinaryPaths = new Set([
  'app/public/assets/og-organizational-ai-memory.png',
  'artifacts/design/ARCHITECT_CONSOLE_CONCEPT_2026-07-11.png',
  'artifacts/design/JUDGE_DEMO_CONCEPT_2026-07-11.png',
  ...releaseBinaryEntries.map((entry) => entry.path),
]);
const approvedTextExtensions = new Set([
  '.conf',
  '.css',
  '.example',
  '.html',
  '.js',
  '.json',
  '.jsonl',
  '.md',
  '.mjs',
  '.service',
  '.sh',
  '.sha256',
  '.sql',
  '.svg',
  '.target',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);
const approvedTextBasenames = new Set(['.gitignore', 'CODEOWNERS', 'LICENSE']);

function isApprovedTextPath(relativePath) {
  return approvedTextBasenames.has(path.posix.basename(relativePath))
    || approvedTextExtensions.has(path.posix.extname(relativePath).toLowerCase());
}

function decodeUtf8(buffer, relativePath) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new Error(`Invalid UTF-8 text file: ${relativePath}`);
  }
}

const unsafeSegments = new Set(['.local-secrets', '.state', 'node_modules']);
const unsafeBasenames = new Set([
  'auth.json',
  'credentials.json',
  '.pgpass',
  '.npmrc',
  '.netrc',
]);
const unsafeArtifactExtension = /\.(?:token|sqlite3?|db|zip|tar|tgz|gz|7z|rar|p12|pfx|pem|key|har)$/i;
const credentialExportName = /(?:cookie|session|storage-state|credential|auth|token)[^/]*\.json$/i;
const allowedHistoricalBinaryPath = /^(?:app\/public\/assets\/[^/]+\.png|artifacts\/design\/[^/]+\.png|artifacts\/submission\/(?:screenshots\/[^/]+\.png|media\/(?:[^/]+\.(?:mp4|webm)|screenshots\/employee-workflow\/[^/]+\.png)))$/;

function unsafePathRule(relativePath, { historical = false } = {}) {
  const segments = relativePath.split('/');
  const basename = segments.at(-1) || '';
  if (segments.some((segment) => unsafeSegments.has(segment))) return 'unsafe path segment';
  if (unsafeBasenames.has(basename)) return 'credential filename';
  if (/^\.env(?:\.|$)/.test(basename) && basename !== '.env.example') return 'environment file';
  if (!isExamplePath(relativePath) && credentialExportName.test(basename)) {
    return 'credential or session export filename';
  }
  if (unsafeArtifactExtension.test(basename)) return 'unsafe archive or database artifact';
  if (historical
      && !isApprovedTextPath(relativePath)
      && !allowedHistoricalBinaryPath.test(relativePath)) {
    return 'unapproved historical file type';
  }
  return null;
}

const secretPatterns = [
  ['private key block', /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i],
  ['credential-bearing URL', /(?:https?|postgres(?:ql)?|redis|mongodb(?:\+srv)?):\/\/[^\s/:@]+:[^\s/@]+@/i],
  ['Google API credential', /(?:AQ\.[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{30,})/],
  ['Google API header value', /(?:\\?["'])?X-Goog-Api-Key(?:\\?["'])?\s*[:=]\s*(?:\\?["'])?[A-Za-z0-9._-]{20,}/i],
  ['GitHub credential', /(?:github_pat_[A-Za-z0-9_]{22,}|gh[pousr]_[A-Za-z0-9]{20,})/],
  ['OpenAI credential', /sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{40,}/],
  ['bearer credential', /(?:\\?["'])?Authorization(?:\\?["'])?\s*[:=]\s*(?:\\?["'])?Bearer\s+[A-Za-z0-9._~-]{16,}/i],
  ['workspace access fragment', /(?:#|%23)access_token=[A-Za-z0-9._~-]{12,}/i],
  ['employee session credential', /(?:\\?["'])?oam_employee_session(?:\\?["'])?\s*[:=]\s*(?:\\?["'])?[A-Za-z0-9._~-]{12,}/i],
  ['serialized employee session cookie', /(?:\\?["'])name(?:\\?["'])\s*:\s*(?:\\?["'])oam_employee_session(?:\\?["'])[\s\S]{0,160}?(?:\\?["'])value(?:\\?["'])\s*:\s*(?:\\?["'])[A-Za-z0-9._~-]{12,}/i],
  ['browser storage session credential', /(?:localStorage\.)?setItem\(\s*(?:\\?["'])oam_employee_session(?:\\?["'])\s*,\s*(?:\\?["'])[A-Za-z0-9._~-]{12,}/i],
  ['session header value', /(?:Cookie|Set-Cookie)\s*:\s*[^\s;=]+=[^;\s]{12,}/i],
];
const sensitiveAssignmentPattern = new RegExp(
  `\\b(?:${[
    'ARCHITECT_TOKEN',
    'REVIEWER_TOKEN',
    'BROKER_TOKEN',
    'WORKSPACE_TOKEN',
    'PGPASSWORD',
    'DATABASE_URL',
    '[A-Z0-9_]+_TOKEN',
    '[A-Z0-9_]*API_KEY',
    '[A-Z0-9_]*PASSWORD',
    '[A-Z0-9_]*SECRET',
  ].join('|')})(?:[ \\t]*=[ \\t]*|(?:\\\\?["'])[ \\t]*:[ \\t]*)(?:(?:\\\\?["'])([^"'\\r\\n]*)(?:\\\\?["'])|([^#;\\s]*))`,
  'g',
);
const privateAddressPattern = /(^|[^0-9])(?:10\.(?:[0-9]{1,3}\.){2}[0-9]{1,3}|192\.168\.(?:[0-9]{1,3}\.)[0-9]{1,3}|172\.(?:1[6-9]|2[0-9]|3[01])\.(?:[0-9]{1,3}\.)[0-9]{1,3})([^0-9]|$)/;
const topologyPattern = new RegExp(`${'Wire'}${'Guard'}|${'plin'}${'k'}[0-9a-z]*|${'root'}@`, 'i');
const privatePathPattern = new RegExp(
  `(?:\\/root\\/\\.ssh|\\/etc\\/${'wire'}${'guard'}|\\/home\\/tg_ops)`,
  'i',
);

const violations = [];
const violationKeys = new Set();
function record(file, line, rule, origin = 'current') {
  const key = `${origin}\0${file}\0${line || ''}\0${rule}`;
  if (violationKeys.has(key)) return;
  violationKeys.add(key);
  violations.push({ file, line, rule, origin });
}

function scanText(text, relativePath, origin = 'current', lineOffset = 0) {
  for (const [rule, pattern] of secretPatterns) {
    const match = pattern.exec(text);
    if (match) record(relativePath, lineOffset + lineNumber(text, match.index), rule, origin);
  }
  sensitiveAssignmentPattern.lastIndex = 0;
  for (const assignment of text.matchAll(sensitiveAssignmentPattern)) {
    const value = assignment[1] ?? assignment[2] ?? '';
    const placeholder = !value
      || /^[\u0024<{]/.test(value)
      || /^(?:change-me|replace-with-|example-|dummy-|test-only-|ci-only-)/i.test(value);
    if (!placeholder && value.length >= 8) {
      record(
        relativePath,
        lineOffset + lineNumber(text, assignment.index),
        'concrete sensitive environment assignment',
        origin,
      );
    }
  }
  const address = privateAddressPattern.exec(text);
  if (address) {
    record(relativePath, lineOffset + lineNumber(text, address.index), 'private network address', origin);
  }
  if (relativePath !== publishingGuide) {
    const topology = topologyPattern.exec(text);
    if (topology) {
      record(relativePath, lineOffset + lineNumber(text, topology.index), 'private access topology', origin);
    }
  }
  const privatePath = privatePathPattern.exec(text);
  if (privatePath) {
    record(relativePath, lineOffset + lineNumber(text, privatePath.index), 'private operator path', origin);
  }
}

const files = trackedFiles();
let textFiles = 0;
let binaryFiles = 0;

for (const relativePath of files) {
  const pathRule = unsafePathRule(relativePath);
  if (pathRule) {
    record(relativePath, null, pathRule);
    continue;
  }

  const absolutePath = path.join(repositoryRoot, relativePath);
  const stat = fs.lstatSync(absolutePath);
  if (stat.isSymbolicLink()) {
    record(relativePath, null, 'tracked symlink');
    continue;
  }
  if (!stat.isFile()) continue;

  const buffer = fs.readFileSync(absolutePath);
  const expectedKind = reviewedBinaryPaths.has(relativePath) ? binaryKind(relativePath) : null;
  if (expectedKind) {
    binaryFiles += 1;
    if (!isBinary(buffer)) record(relativePath, null, `reviewed ${expectedKind} path is not binary`);
    else if (!binarySignatureMatches(expectedKind, buffer)) {
      record(relativePath, null, `invalid ${expectedKind} signature`);
    }
    continue;
  }
  if (!isApprovedTextPath(relativePath)) {
    record(relativePath, null, 'unapproved file type');
    continue;
  }
  if (isBinary(buffer)) {
    record(relativePath, null, 'NUL-bearing text file');
    continue;
  }

  textFiles += 1;
  try {
    scanText(decodeUtf8(buffer, relativePath), relativePath);
  } catch {
    record(relativePath, null, 'invalid UTF-8 text file');
  }
}

const historicalPaths = new Set(
  gitOutput(['log', '--all', '--name-only', '--format='])
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean),
);
for (const relativePath of historicalPaths) {
  const pathRule = unsafePathRule(relativePath, { historical: true });
  if (pathRule) record(relativePath, null, pathRule, 'history');
}

const reachableObjects = gitOutput(['rev-list', '--objects', '--all'])
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => {
    const separator = line.indexOf(' ');
    return {
      oid: separator === -1 ? line : line.slice(0, separator),
      relativePath: separator === -1 ? '' : line.slice(separator + 1),
    };
  });
const objectPaths = new Map(reachableObjects.map((entry) => [entry.oid, entry.relativePath]));
const objectInput = `${[...objectPaths.keys()].join('\n')}\n`;
const blobObjects = gitOutput(
  ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'],
  { input: objectInput },
)
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => {
    const [oid, type, size] = line.split(' ');
    return { oid, type, size: Number(size) };
  })
  .filter((entry) => entry.type === 'blob');

const blobInput = `${blobObjects.map((entry) => entry.oid).join('\n')}\n`;
const blobBatch = gitBuffer(['cat-file', '--batch'], { input: blobInput });
let blobOffset = 0;
for (const expected of blobObjects) {
  const headerEnd = blobBatch.indexOf(0x0a, blobOffset);
  if (headerEnd === -1) throw new Error(`Missing Git blob header for ${expected.oid}.`);
  const [oid, type, rawSize] = blobBatch.subarray(blobOffset, headerEnd).toString('utf8').split(' ');
  const size = Number(rawSize);
  if (oid !== expected.oid || type !== 'blob' || size !== expected.size || !Number.isSafeInteger(size)) {
    throw new Error(`Invalid Git blob header for ${expected.oid}.`);
  }
  const contentStart = headerEnd + 1;
  const contentEnd = contentStart + size;
  if (contentEnd >= blobBatch.length || blobBatch[contentEnd] !== 0x0a) {
    throw new Error(`Truncated Git blob content for ${expected.oid}.`);
  }
  const buffer = blobBatch.subarray(contentStart, contentEnd);
  blobOffset = contentEnd + 1;

  const relativePath = objectPaths.get(oid) || `@blob/${oid}`;
  const origin = `history-blob:${oid.slice(0, 12)}`;
  const kind = allowedHistoricalBinaryPath.test(relativePath) ? binaryKind(relativePath) : null;
  if (kind) {
    if (!isBinary(buffer)) {
      record(relativePath, null, `reviewed historical ${kind} path is not binary`, origin);
    } else if (!binarySignatureMatches(kind, buffer)) {
      record(relativePath, null, `invalid historical ${kind} signature`, origin);
    }
  } else if (isBinary(buffer)) {
    record(relativePath, null, 'unapproved historical binary blob', origin);
  } else {
    try {
      scanText(decodeUtf8(buffer, relativePath), relativePath, origin);
    } catch {
      record(relativePath, null, 'invalid historical UTF-8 text blob', origin);
    }
  }
}
if (blobOffset !== blobBatch.length) {
  throw new Error('Unexpected trailing data in Git blob batch.');
}

const historyPatch = gitOutput([
  'log',
  '--all',
  '--format=@@COMMIT:%H',
  '--patch',
  '--no-ext-diff',
  '--no-textconv',
]);
let historyCommit = 'unknown';
let historyPath = '';
for (const line of historyPatch.split(/\r?\n/)) {
  if (line.startsWith('@@COMMIT:')) {
    historyCommit = line.slice('@@COMMIT:'.length, '@@COMMIT:'.length + 12);
    continue;
  }
  const diffHeader = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
  if (diffHeader) {
    historyPath = diffHeader[2];
    continue;
  }
  if (!historyPath
      || (!line.startsWith('+') && !line.startsWith('-'))
      || line.startsWith('+++')
      || line.startsWith('---')) continue;
  scanText(line.slice(1), historyPath, `history:${historyCommit}`);
}

const result = {
  tracked_files: files.length,
  text_files: textFiles,
  reviewed_binary_files: binaryFiles,
  historical_paths: historicalPaths.size,
  historical_blobs: blobObjects.length,
  violations,
  passed: violations.length === 0,
};
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;
