import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..', '..');
const mediaRoot = path.join(repositoryRoot, 'artifacts', 'submission', 'media');
const employeeScreenshotRoot = path.join(mediaRoot, 'screenshots', 'employee-workflow');
const publicScreenshotRoot = path.join(repositoryRoot, 'artifacts', 'submission', 'screenshots');
const physicalProofPath = path.join(
  repositoryRoot,
  'artifacts',
  'evaluation',
  'personal-agent-runtime-proof-sanitized.json',
);
const REVIEW_CONFIRMATION = 'REVIEWED_PUBLIC_SAFE_RELEASE_MEDIA';

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8'));
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function relative(filePath) {
  return path.relative(repositoryRoot, filePath).split(path.sep).join('/');
}

function fileEvidence(filePath) {
  const stat = fs.statSync(filePath);
  return {
    path: relative(filePath),
    bytes: stat.size,
    sha256: sha256(filePath),
  };
}

function pngEvidence(directory) {
  return fs.readdirSync(directory)
    .filter((name) => name.endsWith('.png'))
    .sort()
    .map((name) => fileEvidence(path.join(directory, name)));
}

function probeVideo(filePath) {
  const output = execFileSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration:stream=codec_name,width,height,pix_fmt,codec_type',
    '-of', 'json',
    filePath,
  ], { encoding: 'utf8' });
  const probe = JSON.parse(output);
  return {
    ...fileEvidence(filePath),
    duration_seconds: Number(Number(probe.format.duration).toFixed(3)),
    streams: probe.streams,
  };
}

const identityProof = readJson('artifacts/evaluation/identity-plane-proof/report.json');
const workflowReport = readJson('artifacts/submission/media/employee-workflow-capture-report.json');
const physicalProof = JSON.parse(fs.readFileSync(physicalProofPath, 'utf8'));
const publicCaptureReport = readJson('artifacts/submission/screenshots/capture-report.json');
const browserQa = readJson('artifacts/qa/browser/report.json');

if (identityProof.overall_status !== 'PASS' || identityProof.counts.pass !== 22) {
  throw new Error('The build-bound identity proof is not a 22-control pass.');
}
if (!workflowReport.passed || workflowReport.steps.length !== 19 || workflowReport.browser_errors.length !== 0) {
  throw new Error('The protected browser workflow is not a clean 19-step pass.');
}
if (!physicalProof.passed || physicalProof.credential_disclosure !== false) {
  throw new Error('The sanitized physical-agent proof is not releasable.');
}
if (physicalProof.capture_run_id !== workflowReport.run_id
    || physicalProof.employee_display_name !== workflowReport.synthetic_employee.display_name
    || physicalProof.agent_display_name !== workflowReport.synthetic_employee.personal_agent_name) {
  throw new Error('The physical-agent proof does not belong to the captured employee workflow.');
}
if (physicalProof.boundary_checks.length !== 7
    || physicalProof.boundary_checks.some((check) => check.passed !== true)
    || physicalProof.personal_context?.passed !== true
    || physicalProof.personal_context?.citation_count !== 1) {
  throw new Error('The physical-agent boundary or citation proof is incomplete.');
}
if (!publicCaptureReport.passed || publicCaptureReport.captures.length !== 8) {
  throw new Error('The public screenshot set is not an eight-capture pass.');
}
if (!browserQa.passed || browserQa.checks.length !== 35) {
  throw new Error('The live browser QA report is not a 35-check pass.');
}
if (process.env.OAM_RELEASE_MEDIA_REVIEW_CONFIRM !== REVIEW_CONFIRMATION) {
  throw new Error(`Set OAM_RELEASE_MEDIA_REVIEW_CONFIRM=${REVIEW_CONFIRMATION} after manual visual review.`);
}

const employeeScreenshots = pngEvidence(employeeScreenshotRoot).map((file) => {
  const filename = path.basename(file.path);
  const step = workflowReport.steps.find((item) => path.basename(item.filename) === filename);
  if (step) {
    return {
      ...file,
      sequence: step.sequence,
      route: step.route,
      viewport: step.viewport,
      expected_state: step.caption,
      observed_state: 'Captured in the passing protected browser workflow.',
    };
  }
  if (filename === '20-physical-agent-runtime-proof.png') {
    return {
      ...file,
      sequence: 20,
      route: null,
      viewport: { width: 1440, height: 1000 },
      expected_state: 'Dedicated process denies protected reads and direct PostgreSQL while allowing private-workspace write and cited broker retrieval.',
      observed_state: 'Rendered from the passing sanitized physical-agent proof.',
    };
  }
  throw new Error(`Employee screenshot ${filename} has no capture evidence.`);
});
const publicScreenshots = pngEvidence(publicScreenshotRoot).map((file) => {
  const filename = path.basename(file.path);
  const capture = publicCaptureReport.captures.find((item) => item.filename === filename);
  if (!capture) throw new Error(`Public screenshot ${filename} has no capture evidence.`);
  return {
    ...file,
    route: capture.route,
    viewport: capture.viewport,
    expected_state: 'HTTP 200 with no unexpected browser or page errors.',
    observed_state: {
      http_status: capture.status,
      unexpected_errors: capture.unexpected_errors,
    },
  };
});
if (employeeScreenshots.length !== 20 || publicScreenshots.length !== 8) {
  throw new Error(`Expected 20 employee and 8 public screenshots; found ${employeeScreenshots.length} and ${publicScreenshots.length}.`);
}

const manifest = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  release: {
    deployed_code_commit: identityProof.source_commit,
    deployed_source_sha256: identityProof.source_sha256,
  },
  verification: {
    identity_proof: {
      generated_at: identityProof.generated_at,
      overall_status: identityProof.overall_status,
      counts: identityProof.counts,
    },
    browser_qa: {
      generated_at: browserQa.generatedAt,
      passed: browserQa.passed,
      pass_count: browserQa.checks.length,
      failure_count: browserQa.failures.length,
    },
    public_capture: {
      captured_at: publicCaptureReport.captured_at,
      passed: publicCaptureReport.passed,
      capture_count: publicCaptureReport.captures.length,
      failure_count: publicCaptureReport.failures.length,
    },
    employee_workflow: {
      captured_at: workflowReport.captured_at,
      run_id: workflowReport.run_id,
      passed: workflowReport.passed,
      browser_step_count: workflowReport.steps.length,
      physical_proof_count: Number(physicalProof.passed),
      browser_error_count: workflowReport.browser_errors.length,
      checks: workflowReport.checks,
    },
    physical_agent: {
      artifact: fileEvidence(physicalProofPath),
      checked_at: physicalProof.checked_at,
      passed: physicalProof.passed,
      boundary_check_count: physicalProof.boundary_checks.length,
      citation_count: physicalProof.personal_context.citation_count,
      credential_disclosure: physicalProof.credential_disclosure,
    },
  },
  media: {
    mp4: probeVideo(path.join(mediaRoot, 'organizational-ai-memory-employee-workflow.mp4')),
    webm: probeVideo(path.join(mediaRoot, 'organizational-ai-memory-employee-workflow.webm')),
    employee_screenshots: employeeScreenshots,
    public_screenshots: publicScreenshots,
  },
  release_safety: {
    synthetic_scenario: workflowReport.scenario,
    operator_authentication_recorded: workflowReport.capture_contract.operator_authentication_recorded,
    raw_credentials_written_to_artifacts: workflowReport.capture_contract.raw_credentials_written_to_artifacts,
    workspace_fragment_scrubbed_before_render: workflowReport.capture_contract.workspace_activation_fragment_scrubbed_before_render,
    visual_review_completed: process.env.OAM_RELEASE_MEDIA_REVIEW_CONFIRM === REVIEW_CONFIRMATION,
  },
};

const outputPath = path.join(mediaRoot, 'release-media-manifest.json');
fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
console.log(relative(outputPath));
