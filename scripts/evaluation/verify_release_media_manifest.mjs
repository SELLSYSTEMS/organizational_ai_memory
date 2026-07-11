import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..', '..');
const defaultManifest = 'artifacts/submission/media/release-media-manifest.json';
const physicalProofPath = 'artifacts/evaluation/personal-agent-runtime-proof-sanitized.json';
const requestedManifest = process.argv[2] || defaultManifest;
const commitPattern = /^[0-9a-f]{40}$/;
const hashPattern = /^[0-9a-f]{64}$/;

function fail(message) {
  throw new Error(message);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(requireRegularPath(relativePath), 'utf8'));
}

function sameJson(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label} does not match its source report.`);
  }
}

function repositoryPath(relativePath) {
  if (typeof relativePath !== 'string'
      || !relativePath
      || path.isAbsolute(relativePath)
      || relativePath.includes('\\')) {
    fail(`Invalid repository-relative path: ${relativePath || '<empty>'}`);
  }
  const normalized = path.posix.normalize(relativePath);
  if (normalized !== relativePath || normalized.startsWith('../')) {
    fail(`Path escapes or is not normalized: ${relativePath}`);
  }
  const absolutePath = path.resolve(repositoryRoot, relativePath);
  const relation = path.relative(repositoryRoot, absolutePath);
  if (!relation || relation.startsWith('..') || path.isAbsolute(relation)) {
    fail(`Path is outside the repository: ${relativePath}`);
  }
  return absolutePath;
}

function requireRegularPath(relativePath) {
  repositoryPath(relativePath);
  let current = repositoryRoot;
  for (const segment of relativePath.split('/')) {
    current = path.join(current, segment);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) fail(`Symlinked manifest path: ${relativePath}`);
  }
  if (!fs.statSync(current).isFile()) fail(`Manifest path is not a file: ${relativePath}`);
  return current;
}

function fileHash(filename) {
  return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

function requireArray(value, count, label) {
  if (!Array.isArray(value) || value.length !== count) {
    fail(`${label} must contain exactly ${count} items.`);
  }
  return value;
}

function requireAllTrue(value, label) {
  const entries = Object.entries(value || {});
  if (!entries.length || entries.some(([, passed]) => passed !== true)) {
    fail(`${label} does not contain only passing checks.`);
  }
}

function pngDimensions(filename) {
  const header = fs.readFileSync(filename).subarray(0, 8);
  if (header.length !== 8
      || !header.equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    fail(`Invalid PNG file: ${path.relative(repositoryRoot, filename)}`);
  }
  const probe = probeMedia(filename);
  const streams = requireArray(probe.streams, 1, 'PNG streams');
  const stream = streams[0];
  if (stream.codec_name !== 'png'
      || stream.codec_type !== 'video'
      || !Number.isSafeInteger(stream.width)
      || !Number.isSafeInteger(stream.height)
      || stream.width <= 0
      || stream.height <= 0) {
    fail(`PNG stream contract is invalid: ${path.relative(repositoryRoot, filename)}`);
  }
  decodeMedia(filename);
  return { width: stream.width, height: stream.height };
}

function probeMedia(filename) {
  const output = execFileSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration,format_name:stream=codec_name,codec_type,width,height,pix_fmt',
    '-of', 'json',
    filename,
  ], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(output);
}

function decodeMedia(filename) {
  execFileSync('ffmpeg', [
    '-nostdin',
    '-v', 'error',
    '-xerror',
    '-i', filename,
    '-map', '0:v:0',
    '-f', 'null',
    '-',
  ], {
    cwd: repositoryRoot,
    stdio: ['ignore', 'ignore', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  });
}

function requireVideoContract(entry, expected) {
  if (entry.path !== expected.path
      || !Number.isFinite(entry.duration_seconds)
      || Math.abs(entry.duration_seconds - expected.duration) > 0.001) {
    fail(`${expected.label} path or duration is invalid.`);
  }
  const streams = requireArray(entry.streams, 1, `${expected.label} streams`);
  const stream = streams[0];
  if (stream.codec_name !== expected.codec
      || stream.codec_type !== 'video'
      || stream.width !== 1440
      || stream.height !== 1000
      || stream.pix_fmt !== 'yuv420p') {
    fail(`${expected.label} stream contract is invalid.`);
  }
  const filename = requireRegularPath(entry.path);
  const probe = probeMedia(filename);
  const actualStreams = requireArray(probe.streams, 1, `${expected.label} probed streams`);
  const actualStream = actualStreams[0];
  const actualDuration = Number(probe.format?.duration);
  if (!Number.isFinite(actualDuration)
      || Math.abs(actualDuration - expected.duration) > 0.001
      || actualStream.codec_name !== expected.codec
      || actualStream.codec_type !== 'video'
      || actualStream.width !== 1440
      || actualStream.height !== 1000
      || actualStream.pix_fmt !== 'yuv420p'
      || !String(probe.format?.format_name || '').split(',').includes(expected.container)) {
    fail(`${expected.label} ffprobe contract is invalid.`);
  }
  if (stream.codec_name !== actualStream.codec_name
      || stream.codec_type !== actualStream.codec_type
      || stream.width !== actualStream.width
      || stream.height !== actualStream.height
      || stream.pix_fmt !== actualStream.pix_fmt) {
    fail(`${expected.label} declared stream does not match the file.`);
  }
  const buffer = fs.readFileSync(filename);
  if (expected.container === 'mp4') {
    if (buffer.length < 12
        || buffer.subarray(4, 8).toString('ascii') !== 'ftyp'
        || !buffer.includes(Buffer.from('avc1'))) {
      fail('MP4 container or H.264 marker is invalid.');
    }
  } else if (buffer.length < 4
      || !buffer.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex'))
      || !buffer.includes(Buffer.from('V_VP8'))) {
      fail('WebM container or VP8 marker is invalid.');
  }
  decodeMedia(filename);
}

function requireSourceReports(manifest) {
  const identity = readJson('artifacts/evaluation/identity-plane-proof/report.json');
  const browser = readJson('artifacts/qa/browser/report.json');
  const publicCapture = readJson('artifacts/submission/screenshots/capture-report.json');
  const employee = readJson('artifacts/submission/media/employee-workflow-capture-report.json');
  const physical = readJson(physicalProofPath);

  if (identity.overall_status !== 'PASS'
      || identity.counts?.pass !== 22
      || identity.counts?.fail !== 0
      || identity.counts?.not_run !== 0
      || requireArray(identity.results, 22, 'identity proof results')
        .some((result) => result.status !== 'PASS')) {
    fail('Source identity proof is not a 22-control pass.');
  }
  if (browser.passed !== true
      || requireArray(browser.checks, 35, 'browser QA checks')
        .some((check) => check.status !== 200
          || (check.unexpectedConsoleErrors || []).length
          || (check.pageErrors || []).length
          || (check.failedRequests || []).length)
      || requireArray(browser.failures, 0, 'browser QA failures').length) {
    fail('Source browser QA is not a clean 35-check pass.');
  }
  if (publicCapture.passed !== true
      || requireArray(publicCapture.captures, 8, 'public captures')
        .some((capture) => capture.status !== 200
          || (capture.unexpected_errors || []).length)
      || requireArray(publicCapture.failures, 0, 'public capture failures').length) {
    fail('Source public capture is not a clean eight-capture pass.');
  }
  if (employee.passed !== true
      || requireArray(employee.steps, 19, 'employee browser steps').length !== 19
      || requireArray(employee.browser_errors, 0, 'employee browser errors').length
      || employee.failure !== null) {
    fail('Source employee workflow is not a clean 19-step pass.');
  }
  requireAllTrue(employee.checks, 'employee workflow checks');
  if (Object.keys(employee.checks).length !== 11) {
    fail('Employee workflow must contain exactly 11 passing checks.');
  }
  if (physical.passed !== true
      || physical.credential_disclosure !== false
      || requireArray(physical.boundary_checks, 7, 'physical boundary checks')
        .some((check) => check.passed !== true)
      || physical.personal_context?.passed !== true
      || physical.personal_context?.citation_count !== 1
      || physical.capture_run_id !== employee.run_id
      || physical.employee_display_name !== employee.synthetic_employee?.display_name
      || physical.agent_display_name !== employee.synthetic_employee?.personal_agent_name) {
    fail('Source physical-agent proof is incomplete or belongs to another capture.');
  }

  if (manifest.release?.deployed_code_commit !== identity.source_commit
      || manifest.release?.deployed_source_sha256 !== identity.source_sha256) {
    fail('Release source binding does not match the identity proof.');
  }
  sameJson(manifest.verification?.identity_proof, {
    generated_at: identity.generated_at,
    overall_status: identity.overall_status,
    counts: identity.counts,
  }, 'manifest identity summary');
  sameJson(manifest.verification?.browser_qa, {
    generated_at: browser.generatedAt,
    passed: browser.passed,
    pass_count: browser.checks.length,
    failure_count: browser.failures.length,
  }, 'manifest browser summary');
  sameJson(manifest.verification?.public_capture, {
    captured_at: publicCapture.captured_at,
    passed: publicCapture.passed,
    capture_count: publicCapture.captures.length,
    failure_count: publicCapture.failures.length,
  }, 'manifest public-capture summary');
  sameJson(manifest.verification?.employee_workflow, {
    captured_at: employee.captured_at,
    run_id: employee.run_id,
    passed: employee.passed,
    browser_step_count: employee.steps.length,
    physical_proof_count: Number(physical.passed),
    browser_error_count: employee.browser_errors.length,
    checks: employee.checks,
  }, 'manifest employee-workflow summary');

  const physicalSummary = manifest.verification?.physical_agent;
  const physicalProofFilename = requireRegularPath(physicalProofPath);
  sameJson(physicalSummary?.artifact, {
    path: physicalProofPath,
    bytes: fs.statSync(physicalProofFilename).size,
    sha256: fileHash(physicalProofFilename),
  }, 'manifest physical-agent artifact');
  if (physicalSummary?.checked_at !== physical.checked_at
      || physicalSummary?.passed !== physical.passed
      || physicalSummary?.boundary_check_count !== physical.boundary_checks.length
      || physicalSummary?.citation_count !== physical.personal_context.citation_count
      || physicalSummary?.credential_disclosure !== physical.credential_disclosure) {
    fail('Manifest physical-agent summary does not match its source proof.');
  }

  return { identity, browser, publicCapture, employee, physical };
}

try {
  const manifestPath = requireRegularPath(requestedManifest);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.schema_version !== 1) fail('Unsupported release manifest schema.');
  if (!commitPattern.test(manifest.release?.deployed_code_commit || '')
      || !hashPattern.test(manifest.release?.deployed_source_sha256 || '')) {
    fail('Release source binding is missing or malformed.');
  }
  const reports = requireSourceReports(manifest);

  const safety = manifest.release_safety;
  if (safety?.synthetic_scenario !== reports.employee.scenario
      || safety?.operator_authentication_recorded !== false
      || safety?.raw_credentials_written_to_artifacts !== false
      || safety?.workspace_fragment_scrubbed_before_render !== true
      || safety?.visual_review_completed !== true) {
    fail('Release-safety contract is incomplete.');
  }

  const employeeScreenshots = requireArray(
    manifest.media?.employee_screenshots,
    20,
    'employee workflow screenshots',
  );
  const publicScreenshots = requireArray(
    manifest.media?.public_screenshots,
    8,
    'public screenshots',
  );
  const expectedEmployeePaths = [
    ...reports.employee.steps.map((step) => `artifacts/submission/media/${step.filename}`),
    'artifacts/submission/media/screenshots/employee-workflow/20-physical-agent-runtime-proof.png',
  ].sort();
  const expectedPublicPaths = reports.publicCapture.captures
    .map((capture) => `artifacts/submission/screenshots/${capture.filename}`)
    .sort();
  sameJson(employeeScreenshots.map((entry) => entry.path).sort(), expectedEmployeePaths,
    'employee screenshot paths');
  sameJson(publicScreenshots.map((entry) => entry.path).sort(), expectedPublicPaths,
    'public screenshot paths');

  for (const [index, step] of reports.employee.steps.entries()) {
    const entry = employeeScreenshots[index];
    sameJson({
      path: entry.path,
      sequence: entry.sequence,
      route: entry.route,
      viewport: entry.viewport,
      expected_state: entry.expected_state,
      observed_state: entry.observed_state,
    }, {
      path: `artifacts/submission/media/${step.filename}`,
      sequence: step.sequence,
      route: step.route,
      viewport: step.viewport,
      expected_state: step.caption,
      observed_state: 'Captured in the passing protected browser workflow.',
    }, `employee screenshot ${step.sequence} metadata`);
  }
  const physicalScreenshot = employeeScreenshots.at(-1);
  sameJson({
    path: physicalScreenshot.path,
    sequence: physicalScreenshot.sequence,
    route: physicalScreenshot.route,
    viewport: physicalScreenshot.viewport,
    expected_state: physicalScreenshot.expected_state,
    observed_state: physicalScreenshot.observed_state,
  }, {
    path: 'artifacts/submission/media/screenshots/employee-workflow/20-physical-agent-runtime-proof.png',
    sequence: 20,
    route: null,
    viewport: { width: 1440, height: 1000 },
    expected_state: 'Dedicated process denies protected reads and direct PostgreSQL while allowing private-workspace write and cited broker retrieval.',
    observed_state: 'Rendered from the passing sanitized physical-agent proof.',
  }, 'physical-agent screenshot metadata');

  for (const [index, capture] of reports.publicCapture.captures.entries()) {
    const entry = publicScreenshots[index];
    sameJson({
      path: entry.path,
      route: entry.route,
      viewport: entry.viewport,
      expected_state: entry.expected_state,
      observed_state: entry.observed_state,
    }, {
      path: `artifacts/submission/screenshots/${capture.filename}`,
      route: capture.route,
      viewport: capture.viewport,
      expected_state: 'HTTP 200 with no unexpected browser or page errors.',
      observed_state: {
        http_status: capture.status,
        unexpected_errors: capture.unexpected_errors,
      },
    }, `public screenshot ${index + 1} metadata`);
  }

  const entries = [
    manifest.verification?.physical_agent?.artifact,
    manifest.media?.mp4,
    manifest.media?.webm,
    ...employeeScreenshots,
    ...publicScreenshots,
  ];
  if (entries.length !== 31 || entries.some((entry) => !entry)) {
    fail('Expected exactly 31 complete release artifacts.');
  }

  const seen = new Set();
  for (const entry of entries) {
    repositoryPath(entry.path);
    if (seen.has(entry.path)) fail(`Duplicate manifest path: ${entry.path}`);
    seen.add(entry.path);
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0) {
      fail(`Invalid byte count for ${entry.path}.`);
    }
    if (!hashPattern.test(entry.sha256 || '')) fail(`Invalid SHA-256 for ${entry.path}.`);
    const absolutePath = requireRegularPath(entry.path);
    const stat = fs.statSync(absolutePath);
    if (stat.size !== entry.bytes) fail(`Byte count mismatch for ${entry.path}.`);
    if (fileHash(absolutePath) !== entry.sha256) fail(`SHA-256 mismatch for ${entry.path}.`);
  }

  for (const entry of [...employeeScreenshots, ...publicScreenshots]) {
    const dimensions = pngDimensions(requireRegularPath(entry.path));
    if (dimensions.width !== entry.viewport?.width
        || dimensions.height !== entry.viewport?.height) {
      fail(`PNG dimensions do not match the captured viewport for ${entry.path}.`);
    }
  }
  requireVideoContract(manifest.media.mp4, {
    label: 'release MP4',
    path: 'artifacts/submission/media/organizational-ai-memory-employee-workflow.mp4',
    duration: 50.08,
    codec: 'h264',
    container: 'mp4',
  });
  requireVideoContract(manifest.media.webm, {
    label: 'raw WebM',
    path: 'artifacts/submission/media/organizational-ai-memory-employee-workflow.webm',
    duration: 42.12,
    codec: 'vp8',
    container: 'webm',
  });

  console.log(JSON.stringify({
    manifest: requestedManifest,
    deployed_code_commit: manifest.release.deployed_code_commit,
    deployed_source_sha256: manifest.release.deployed_source_sha256,
    source_reports: {
      identity_controls: reports.identity.results.length,
      browser_checks: reports.browser.checks.length,
      public_captures: reports.publicCapture.captures.length,
      employee_steps: reports.employee.steps.length,
      physical_boundaries: reports.physical.boundary_checks.length,
    },
    verified_artifacts: entries.length,
    passed: true,
  }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
