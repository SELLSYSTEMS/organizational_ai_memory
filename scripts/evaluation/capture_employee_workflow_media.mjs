import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';

const execFileAsync = promisify(execFile);
const CONFIRMATION = 'CAPTURE_EMPLOYEE_PERSONAL_AGENT_WORKFLOW';
const DEFAULT_OUTPUT_ROOT = 'artifacts/submission/media';
const DEFAULT_BASE_URL = 'https://memory.sellsystems.agency';
const DESKTOP = { width: 1440, height: 1000 };
const MOBILE = { width: 390, height: 844 };
const API_TIMEOUT_MS = Number(process.env.OAM_MEDIA_API_TIMEOUT_MS || 90_000);
const HOLD_MS = Number(process.env.OAM_MEDIA_STEP_HOLD_MS || 900);
const secrets = new Set();

const HELP = `
Capture the canonical employee + Personal Memory Agent workflow.

This is a state-changing live capture. It creates and physically provisions one
synthetic employee/agent pair, then preserves the pair for the recorded demo.

Required environment:
  OAM_MEDIA_CAPTURE_CONFIRM=${CONFIRMATION}
  OAM_MEDIA_RUN_ID=<unique lowercase run id, for example 0711-final-a>
  OAM_QA_OPERATOR_CREDENTIAL_FILE=<0600 JSON file with architect_token>

Optional environment:
  OAM_QA_BASE_URL=${DEFAULT_BASE_URL}
  OAM_CHROME_PATH=/usr/bin/google-chrome
  OAM_MEDIA_OUTPUT_DIR=${DEFAULT_OUTPUT_ROOT}
  OAM_MEDIA_STEP_HOLD_MS=${HOLD_MS}
  OAM_MEDIA_API_TIMEOUT_MS=${API_TIMEOUT_MS}
  OAM_MEDIA_ALLOW_OVERWRITE=1
  OAM_MEDIA_IGNORE_HTTPS_ERRORS=1
  OAM_FFMPEG_PATH=/usr/bin/ffmpeg

Usage:
  node scripts/evaluation/capture_employee_workflow_media.mjs [output-directory]
`;

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(HELP.trim());
  process.exit(0);
}

function redact(value) {
  let result = String(value || '');
  for (const secret of secrets) {
    if (secret) result = result.replaceAll(secret, '[REDACTED]');
  }
  return result
    .replace(/access_token=[A-Za-z0-9_%.-]+/gi, 'access_token=[REDACTED]')
    .replace(/("(?:architect_token|workspace_token|token)"\s*:\s*")[^"]+/gi, '$1[REDACTED]');
}

function dataOf(payload) {
  return payload?.data ?? payload ?? {};
}

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function endpointPath(value) {
  return new URL(value).pathname;
}

function apiResponse(page, method, pathname) {
  return page.waitForResponse((response) => (
    response.request().method() === method
    && endpointPath(response.url()) === pathname
  ), { timeout: API_TIMEOUT_MS });
}

async function responseData(response, label) {
  if (!response.ok()) {
    throw new Error(`${label} returned HTTP ${response.status()}.`);
  }
  const payload = await response.json().catch(() => null);
  requireValue(payload && typeof payload === 'object', `${label} did not return JSON.`);
  return dataOf(payload);
}

async function fileExists(filename) {
  try {
    await fs.access(filename, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function hold(page, multiplier = 1) {
  if (HOLD_MS > 0) await page.waitForTimeout(Math.round(HOLD_MS * multiplier));
}

async function waitForDialogClose(page) {
  await page.waitForFunction(() => {
    const dialog = document.querySelector('[data-dialog]');
    const error = document.querySelector('[data-dialog-error]:not([hidden])');
    return !dialog?.open || Boolean(error);
  }, null, { timeout: API_TIMEOUT_MS });
  const error = page.locator('[data-dialog-error]:not([hidden])');
  if (await error.count()) throw new Error(await error.first().innerText());
  requireValue(!(await page.locator('[data-dialog]').evaluate((dialog) => dialog.open)), 'Dialog did not close.');
}

async function clickDialogSubmit(page, responsePromise, label) {
  await page.locator('[data-dialog] [value="confirm"]').click();
  const response = await responsePromise;
  const data = await responseData(response, label);
  await waitForDialogClose(page);
  return data;
}

async function assertNoSecretRendered(page) {
  const values = [...secrets].filter(Boolean);
  if (!values.length) return;
  const exposed = await page.evaluate((sensitiveValues) => {
    const visibleInputs = [...document.querySelectorAll('input:not([type="password"]), textarea')]
      .map((control) => control.value || '')
      .join('\n');
    const visibleText = document.body?.innerText || '';
    return sensitiveValues.some((value) => visibleText.includes(value) || visibleInputs.includes(value));
  }, values);
  requireValue(!exposed, 'A credential was present in rendered text or a visible form control.');
}

async function searchAgentVisibleMemory(page, query, expected) {
  await page.locator('.workspace-sidebar [data-view-target="search"]').click();
  await page.locator('[data-agent-query-form] textarea[name="query"]').fill(query);
  const responsePromise = apiResponse(page, 'POST', '/workspace/api/v1/agent-context');
  await page.locator('[data-agent-query-form] button[type="submit"]').click();
  await responseData(await responsePromise, 'Agent-visible memory search');
  if (expected === 'no_match') {
    await page.getByText('No grounded memory matched this question.', { exact: true }).waitFor({ timeout: API_TIMEOUT_MS });
  } else {
    await page.locator('.answer-surface').waitFor({ timeout: API_TIMEOUT_MS });
    await page.locator('.citation-list li', { hasText: expected }).first().waitFor({ timeout: API_TIMEOUT_MS });
    await page.locator('.audit-receipt').waitFor({ timeout: API_TIMEOUT_MS });
  }
}

async function run() {
  requireValue(
    process.env.OAM_MEDIA_CAPTURE_CONFIRM === CONFIRMATION,
    `Refusing live mutations. Set OAM_MEDIA_CAPTURE_CONFIRM=${CONFIRMATION}.`,
  );

  const runId = String(process.env.OAM_MEDIA_RUN_ID || '').trim();
  requireValue(/^[a-z0-9][a-z0-9-]{2,31}$/.test(runId), 'OAM_MEDIA_RUN_ID must be a unique 3-32 character lowercase run id.');

  const credentialFile = String(process.env.OAM_QA_OPERATOR_CREDENTIAL_FILE || '').trim();
  requireValue(credentialFile, 'OAM_QA_OPERATOR_CREDENTIAL_FILE is required.');
  const credentialStat = await fs.stat(credentialFile);
  requireValue(credentialStat.isFile(), 'Operator credential path is not a file.');
  requireValue((credentialStat.mode & 0o077) === 0, 'Operator credential file must not be readable by group or other users.');

  const credential = JSON.parse(await fs.readFile(credentialFile, 'utf8'));
  let architectToken = String(credential.architect_token || '');
  credential.architect_token = '';
  requireValue(/^[A-Za-z0-9_-]{32,128}$/.test(architectToken), 'Operator credential file does not contain a valid architect_token.');
  secrets.add(architectToken);

  const base = new URL(process.env.OAM_QA_BASE_URL || DEFAULT_BASE_URL);
  base.pathname = base.pathname.replace(/\/+$/, '') || '/';
  base.search = '';
  base.hash = '';
  requireValue(base.pathname === '/', 'OAM_QA_BASE_URL must be an origin without a path.');
  const localHost = ['127.0.0.1', 'localhost', '::1'].includes(base.hostname);
  requireValue(base.protocol === 'https:' || localHost, 'Media capture requires HTTPS except on localhost.');
  const baseUrl = base.origin;

  const outputRoot = path.resolve(process.argv[2] || process.env.OAM_MEDIA_OUTPUT_DIR || DEFAULT_OUTPUT_ROOT);
  const screenshotDir = path.join(outputRoot, 'screenshots', 'employee-workflow');
  const reportPath = path.join(outputRoot, 'employee-workflow-capture-report.json');
  const webmPath = path.join(outputRoot, 'organizational-ai-memory-employee-workflow.webm');
  const mp4Path = path.join(outputRoot, 'organizational-ai-memory-employee-workflow.mp4');
  const allowOverwrite = process.env.OAM_MEDIA_ALLOW_OVERWRITE === '1';
  const protectedOutputs = [reportPath, webmPath, mp4Path];
  if (!allowOverwrite) {
    for (const filename of protectedOutputs) {
      requireValue(!(await fileExists(filename)), `Output already exists: ${filename}. Set OAM_MEDIA_ALLOW_OVERWRITE=1 to replace the canonical capture.`);
    }
    if (await fileExists(screenshotDir)) {
      requireValue((await fs.readdir(screenshotDir)).length === 0, `Screenshot output is not empty: ${screenshotDir}. Set OAM_MEDIA_ALLOW_OVERWRITE=1 to replace the canonical capture.`);
    }
  }
  await fs.mkdir(screenshotDir, { recursive: true });

  const employee = {
    displayName: 'Mai Nguyen',
    workEmail: `mai.nguyen+${runId}@demo.sellsystems.agency`,
    jobTitle: 'Delivery Lead',
    agentName: "Mai Nguyen's Personal Memory Agent",
  };
  const memory = {
    title: 'Reliable website handoff',
    content: 'Before final delivery, assign a named owner, validate the release checklist, and preserve provenance for every approval.',
    context: 'Multi-team website handoff with design, implementation, and release reviewers.',
    why: 'Named ownership and evidence-backed gates made the final state reviewable and prevented ambiguous handoffs.',
    evidence: '{"type":"release_checklist","result":"all required checks passed"}\nApproved handoff record OAM-MAI-01',
    tags: 'website, handoff, provenance, release',
    query: 'website handoff provenance',
  };

  const steps = [];
  const browserErrors = [];
  const checks = {
    readiness: false,
    architect_session_preloaded: false,
    workspace_fragment_scrubbed: false,
    masked_workspace_link: false,
    provisioning_succeeded: false,
    one_human_one_agent_active: false,
    private_memory_excluded: false,
    shared_memory_cited: false,
    edit_reset_access: false,
    current_revision_cited: false,
    mobile_no_horizontal_overflow: false,
  };

  const tempVideoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oam-employee-media-'));
  const executablePath = process.env.OAM_CHROME_PATH || '/usr/bin/google-chrome';
  const ignoreHTTPSErrors = process.env.OAM_MEDIA_IGNORE_HTTPS_ERRORS === '1';
  let browser;
  let bootstrapContext;
  let recordingContext;
  let page;
  let video;
  let flowError = null;
  let videoSaved = false;
  let mp4Saved = false;

  async function capture(filename, caption, { scrollTo = '' } = {}) {
    if (scrollTo) await page.locator(scrollTo).scrollIntoViewIfNeeded();
    await assertNoSecretRendered(page);
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    await hold(page, 0.35);
    const target = path.join(screenshotDir, filename);
    await page.screenshot({ path: target, fullPage: false });
    steps.push({
      sequence: steps.length + 1,
      filename: path.relative(outputRoot, target),
      route: endpointPath(page.url()),
      viewport: page.viewportSize(),
      caption,
    });
    await hold(page);
  }

  try {
    browser = await chromium.launch({
      headless: true,
      executablePath,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });

    bootstrapContext = await browser.newContext({
      viewport: DESKTOP,
      deviceScaleFactor: 1,
      ignoreHTTPSErrors,
      serviceWorkers: 'block',
    });
    const readiness = await bootstrapContext.request.get(`${baseUrl}/api/readyz`, { timeout: API_TIMEOUT_MS });
    requireValue(readiness.ok(), `/api/readyz returned HTTP ${readiness.status()}.`);
    const workspaceSurface = await bootstrapContext.request.get(`${baseUrl}/workspace/`, { timeout: API_TIMEOUT_MS });
    requireValue(workspaceSurface.ok(), `/workspace/ returned HTTP ${workspaceSurface.status()}.`);
    checks.readiness = true;

    const bootstrapPage = await bootstrapContext.newPage();
    const architectResponse = await bootstrapPage.goto(`${baseUrl}/architect/`, { waitUntil: 'domcontentloaded', timeout: API_TIMEOUT_MS });
    requireValue(architectResponse?.ok(), `/architect/ returned HTTP ${architectResponse?.status() || 0}.`);
    await bootstrapPage.locator('[data-login-form] input[name="token"]').fill(architectToken);
    const loginResponsePromise = apiResponse(bootstrapPage, 'POST', '/architect/api/v1/session');
    await bootstrapPage.locator('[data-login-form]').evaluate((form) => form.requestSubmit());
    await responseData(await loginResponsePromise, 'Architect session exchange');
    architectToken = '';
    await bootstrapPage.locator('.console-shell').waitFor({ timeout: API_TIMEOUT_MS });
    const storageState = await bootstrapContext.storageState();
    checks.architect_session_preloaded = true;
    await bootstrapContext.close();
    bootstrapContext = null;

    recordingContext = await browser.newContext({
      viewport: DESKTOP,
      deviceScaleFactor: 1,
      ignoreHTTPSErrors,
      serviceWorkers: 'block',
      reducedMotion: 'reduce',
      storageState,
      recordVideo: { dir: tempVideoDir, size: DESKTOP },
    });
    page = await recordingContext.newPage();
    video = page.video();
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(`console: ${redact(message.text())}`);
    });
    page.on('pageerror', (error) => browserErrors.push(`page: ${redact(error.message)}`));
    page.on('response', (response) => {
      if (response.status() >= 400) {
        browserErrors.push(`HTTP ${response.status()}: ${endpointPath(response.url())}`);
      }
    });

    const recordedArchitect = await page.goto(`${baseUrl}/architect/`, { waitUntil: 'domcontentloaded', timeout: API_TIMEOUT_MS });
    requireValue(recordedArchitect?.ok(), `Recorded /architect/ returned HTTP ${recordedArchitect?.status() || 0}.`);
    await page.locator('.console-shell').waitFor({ timeout: API_TIMEOUT_MS });
    await page.locator('.console-sidebar [data-view-target="principals"]').click();
    await page.getByRole('heading', { name: 'People & personal agents', exact: true }).waitFor();

    await page.locator('[data-open-dialog="onboard-employee"]').first().click();
    const onboardDialog = page.locator('[data-dialog]');
    await onboardDialog.locator('input[name="display_name"]').fill(employee.displayName);
    await onboardDialog.locator('input[name="work_email"]').fill(employee.workEmail);
    await onboardDialog.locator('input[name="job_title"]').fill(employee.jobTitle);
    await onboardDialog.locator('input[name="agent_display_name"]').fill(employee.agentName);
    await capture('01-onboard-employee.png', 'A single operator action defines the employee and their one separately governed Personal Memory Agent.');

    const onboardResponsePromise = apiResponse(page, 'POST', '/architect/api/v1/employees');
    await onboardDialog.locator('[value="confirm"]').click();
    const onboardData = await responseData(await onboardResponsePromise, 'Employee onboarding');
    const employeeRecord = onboardData.employee || onboardData.human || {};
    const agentRecord = onboardData.personal_agent || onboardData.agent || {};
    const workspaceToken = String(onboardData.workspace_access?.token || onboardData.workspace_token || '');
    requireValue(employeeRecord.id && agentRecord.id, 'Employee onboarding omitted the employee or Personal Memory Agent identifier.');
    requireValue(/^[A-Za-z0-9_-]{32,128}$/.test(workspaceToken), 'Employee onboarding omitted a valid workspace credential.');
    secrets.add(workspaceToken);
    await page.locator('[data-dialog] input[name="workspace_link"]').waitFor({ timeout: API_TIMEOUT_MS });
    const linkInput = page.locator('[data-dialog] input[name="workspace_link"]');
    requireValue(await linkInput.getAttribute('type') === 'password', 'Private workspace link is not masked by a password field.');
    const workspaceUrl = await linkInput.inputValue();
    secrets.add(workspaceUrl);
    const parsedWorkspaceUrl = new URL(workspaceUrl);
    requireValue(parsedWorkspaceUrl.origin === baseUrl && parsedWorkspaceUrl.pathname === '/workspace/', 'Workspace link does not target the configured employee surface.');
    requireValue(new URLSearchParams(parsedWorkspaceUrl.hash.slice(1)).get('access_token') === workspaceToken, 'Workspace link credential did not match the onboarding response.');
    checks.masked_workspace_link = true;
    await capture('02-created-pair-masked-link.png', 'The employee, personal agent, and revocable private workspace are created atomically; the only returned link remains masked.');
    await page.locator('[data-dialog] footer [data-close-dialog]').click();
    await page.waitForFunction(() => !document.querySelector('[data-dialog]')?.open, null, {
      timeout: API_TIMEOUT_MS,
    });

    await page.locator('.console-sidebar [data-view-target="provisioning"]').click();
    await page.getByRole('heading', { name: 'Provisioning', exact: true }).waitFor();
    await page.locator('[data-open-dialog="provision"]').click();
    await page.locator('[data-dialog] select[name="principal_id"]').selectOption(agentRecord.id);
    const queueResponsePromise = apiResponse(page, 'POST', '/architect/api/v1/provisioning/plans');
    const queueData = await clickDialogSubmit(page, queueResponsePromise, 'Provisioning plan creation');
    const job = queueData.job || queueData;
    requireValue(job.id, 'Provisioning plan creation omitted the job identifier.');
    const jobRow = page.locator(`[data-job-id="${job.id}"]`).first();
    await jobRow.waitFor({ timeout: API_TIMEOUT_MS });
    await jobRow.getByText(/^queued$/i).waitFor({ timeout: API_TIMEOUT_MS });
    await capture('03-immutable-plan-queued.png', 'Physical provisioning begins as an immutable, revisioned plan rather than an unreviewed browser-side action.');

    await jobRow.locator(`[data-confirm-job="${job.id}"]`).click();
    await page.getByRole('heading', { name: 'Confirm provisioning plan', exact: true }).waitFor();
    await capture('04-revision-bound-confirmation.png', 'The operator confirms the exact plan revision and hash before privileged provisioning can execute.');
    const confirmResponsePromise = apiResponse(page, 'POST', `/architect/api/v1/provisioning/plans/${job.id}/confirm`);
    await clickDialogSubmit(page, confirmResponsePromise, 'Provisioning confirmation');
    const succeededRow = page.locator(`[data-job-id="${job.id}"]`).first();
    await succeededRow.getByText(/^succeeded$/i).waitFor({ timeout: API_TIMEOUT_MS });
    await page.locator('.job-steps li.is-complete').last().waitFor({ timeout: API_TIMEOUT_MS });
    checks.provisioning_succeeded = true;
    await capture('05-physical-provisioning-succeeded.png', 'The completed job records runtime binding, activation proofs, and final activation.');

    await page.locator('.console-sidebar [data-view-target="principals"]').click();
    const agentRow = page.locator(`[data-principal-id="${agentRecord.id}"]`).first();
    await agentRow.scrollIntoViewIfNeeded();
    await agentRow.click();
    await page.locator('.principal-inspector [data-principal-tab="os"]').click();
    const inspector = page.locator('.principal-inspector');
    await inspector.getByText('Personal pairing', { exact: true }).waitFor();
    await inspector.getByText(/One human.*one personal agent/i).waitFor();
    await inspector.locator('.detail-list').waitFor();
    const pairSection = inspector.locator('.inspector-section', { hasText: 'Personal pairing' });
    checks.one_human_one_agent_active = await pairSection.getByText(/^active$/i).count() === 1;
    requireValue(checks.one_human_one_agent_active, 'Personal pairing did not become active.');
    await capture('06-active-pair-and-runtime-identity.png', 'The active personal agent has its own Linux runtime bindings while retaining a one-human, one-agent application pairing.');

    const employeeResponse = await page.goto(workspaceUrl, { waitUntil: 'domcontentloaded', timeout: API_TIMEOUT_MS });
    requireValue(employeeResponse?.ok(), `Recorded /workspace/ returned HTTP ${employeeResponse?.status() || 0}.`);
    await page.waitForFunction(() => window.location.hash === '', null, { timeout: API_TIMEOUT_MS });
    requireValue(!page.url().includes('access_token='), 'Workspace fragment was not scrubbed before the employee surface rendered.');
    checks.workspace_fragment_scrubbed = true;
    await page.locator('.workspace-shell').waitFor({ timeout: API_TIMEOUT_MS });
    await page.getByRole('heading', { name: 'Preview agent-visible memory', exact: true }).waitFor();
    await capture('07-private-workspace-activated.png', 'The employee enters a private workspace through a scrubbed activation fragment and an HttpOnly session.');

    await page.locator('.workspace-sidebar [data-view-target="profile"]').click();
    const profileForm = page.locator('[data-profile-form]');
    const priorProfileRevision = Number(await profileForm.locator('input[name="expected_revision"]').inputValue());
    await profileForm.locator('input[name="job_title"]').fill(employee.jobTitle);
    await profileForm.locator('textarea[name="role_summary"]').fill('Coordinates release quality, clear ownership, and cross-team delivery decisions.');
    await profileForm.locator('textarea[name="expertise"]').fill('Release governance\nEvidence-backed delivery\nRisk reviews');
    await profileForm.locator('textarea[name="working_style"]').fill('Prefers explicit owners, bounded checklists, and written decision evidence.');
    await profileForm.locator('textarea[name="current_goals"]').fill('Standardize accountable releases\nReduce repeated delivery mistakes');
    await profileForm.locator('textarea[name="boundaries"]').fill('Do not promote unreviewed content or expose private employee context.');
    await page.locator('.profile-form').scrollIntoViewIfNeeded();
    await capture('08-self-authored-work-profile.png', 'The employee writes the role context, expertise, working style, goals, and constraints that remain under their control.');
    const profileResponsePromise = apiResponse(page, 'PUT', '/workspace/api/v1/profile');
    await profileForm.getByRole('button', { name: 'Save profile', exact: true }).click();
    await responseData(await profileResponsePromise, 'Profile save');
    await page.waitForFunction((revision) => Number(document.querySelector('[data-profile-form] input[name="expected_revision"]')?.value) > revision, priorProfileRevision, { timeout: API_TIMEOUT_MS });
    await page.locator('.profile-consent').scrollIntoViewIfNeeded();
    await page.locator('[data-share-profile]').waitFor();
    await capture('09-private-versioned-work-profile.png', 'Employee-authored work context is saved as an immutable owner-only profile revision.');

    await page.locator('[data-share-profile]').click();
    await page.getByRole('heading', { name: 'Allow profile access', exact: true }).waitFor();
    await capture('10-explicit-profile-consent.png', 'Profile access is a separate, hash-preserving action bound to the current revision.');
    const profileSharePromise = apiResponse(page, 'POST', '/workspace/api/v1/profile/share');
    await clickDialogSubmit(page, profileSharePromise, 'Profile access grant');
    await page.locator('[data-unshare-profile]').waitFor({ timeout: API_TIMEOUT_MS });

    await page.locator('.workspace-sidebar [data-new-memory]').click();
    const memoryDialog = page.locator('[data-dialog]');
    await memoryDialog.locator('select[name="type"]').selectOption('experience');
    await memoryDialog.locator('select[name="sensitivity"]').selectOption('private');
    await memoryDialog.locator('input[name="title"]').fill(memory.title);
    await memoryDialog.locator('textarea[name="content"]').fill(memory.content);
    await memoryDialog.locator('textarea[name="context"]').fill(memory.context);
    await memoryDialog.locator('textarea[name="why_it_worked"]').fill(memory.why);
    await memoryDialog.locator('textarea[name="evidence"]').fill(memory.evidence);
    await memoryDialog.locator('input[name="tags"]').fill(memory.tags);
    await capture('11-capture-private-experience.png', 'The employee records typed content, context, why it worked, evidence, tags, and sensitivity in one bounded form.');
    await memoryDialog.locator('.dialog-shell').evaluate((shell) => { shell.scrollTop = shell.scrollHeight; });
    await hold(page, 0.75);
    const createMemoryPromise = apiResponse(page, 'POST', '/workspace/api/v1/memories');
    const memoryData = await clickDialogSubmit(page, createMemoryPromise, 'Private memory creation');
    const memoryRecord = memoryData.memory || memoryData;
    requireValue(memoryRecord.id, 'Private memory creation omitted the memory identifier.');

    await searchAgentVisibleMemory(page, memory.query, 'no_match');
    checks.private_memory_excluded = true;
    await capture('12-private-memory-excluded.png', 'Before consent, the exact memory query returns no grounded match even though the employee can see the record.');

    await page.locator('.workspace-sidebar [data-view-target="memory"]').click();
    const memoryRow = page.locator(`[data-memory-id="${memoryRecord.id}"]`);
    await memoryRow.click();
    await page.locator(`[data-share-memory="${memoryRecord.id}"]`).click();
    await page.getByRole('heading', { name: 'Allow Personal Memory Agent access', exact: true }).waitFor();
    await capture('13-revision-bound-memory-consent.png', 'The employee grants only the linked agent access to the next current revision with the same content hash.');
    const shareMemoryPromise = apiResponse(page, 'POST', `/workspace/api/v1/memories/${memoryRecord.id}/share`);
    await clickDialogSubmit(page, shareMemoryPromise, 'Memory access grant');

    await searchAgentVisibleMemory(page, memory.query, memory.title);
    const firstCitationVersion = (await page.locator('.citation-list li', { hasText: memory.title }).first().locator('dl dd').first().innerText()).trim();
    requireValue(firstCitationVersion === '2', `Expected shared memory revision 2, received ${firstCitationVersion || 'no revision'}.`);
    checks.shared_memory_cited = true;
    await capture('14-grounded-reuse-with-citation.png', 'After consent, the same deterministic query returns authorized context with revision, hash, citation, and audit receipt.');

    await page.locator('.workspace-sidebar [data-view-target="memory"]').click();
    await page.locator(`[data-memory-id="${memoryRecord.id}"]`).click();
    await page.locator(`[data-edit-memory="${memoryRecord.id}"]`).click();
    const editDialog = page.locator('[data-dialog]');
    await editDialog.locator('textarea[name="content"]').fill(`${memory.content}\nRecord the final validation owner in the handoff receipt.`);
    const updateMemoryPromise = apiResponse(page, 'PUT', `/workspace/api/v1/memories/${memoryRecord.id}`);
    await clickDialogSubmit(page, updateMemoryPromise, 'Memory version update');
    await page.locator(`[data-memory-id="${memoryRecord.id}"]`, { hasText: /private/i }).waitFor({ timeout: API_TIMEOUT_MS });
    await page.locator(`[data-memory-id="${memoryRecord.id}"]`).click();
    const inspectorText = await page.locator('.memory-inspector').innerText();
    requireValue(/Version\s+3/.test(inspectorText), 'Memory edit did not create private revision 3.');
    checks.edit_reset_access = true;
    await capture('15-edit-resets-agent-access.png', 'Editing shared content creates a new private current revision and resets the prior access decision.');

    await searchAgentVisibleMemory(page, memory.query, 'no_match');
    await capture('16-edited-version-excluded.png', 'The edited current version remains excluded until the employee explicitly consents again.');

    await page.locator('.workspace-sidebar [data-view-target="memory"]').click();
    await page.locator(`[data-memory-id="${memoryRecord.id}"]`).click();
    await page.locator(`[data-share-memory="${memoryRecord.id}"]`).click();
    const reshareMemoryPromise = apiResponse(page, 'POST', `/workspace/api/v1/memories/${memoryRecord.id}/share`);
    await clickDialogSubmit(page, reshareMemoryPromise, 'Current memory revision access grant');
    await searchAgentVisibleMemory(page, memory.query, memory.title);
    const currentCitationVersion = (await page.locator('.citation-list li', { hasText: memory.title }).first().locator('dl dd').first().innerText()).trim();
    requireValue(currentCitationVersion === '4', `Expected re-consented memory revision 4, received ${currentCitationVersion || 'no revision'}.`);
    checks.current_revision_cited = true;
    await capture('17-current-version-reconsented.png', 'Re-consent exposes only current revision 4, with its own typed citation and retrieval audit receipt.');

    await page.locator('.workspace-sidebar [data-view-target="agent"]').click();
    await page.getByRole('heading', { name: 'Personal Memory Agent', exact: true }).waitFor();
    const ledgerText = await page.locator('.agent-boundary-ledger').innerText();
    requireValue(ledgerText.includes('direct PostgreSQL authority is not granted'), 'Agent boundary ledger omitted the physical database boundary.');
    await capture('18-personal-agent-boundaries.png', 'The final ledger separates agent-visible sources, owner-only sources, one-to-one identity, and brokered database authority.');

    await page.setViewportSize(MOBILE);
    await page.waitForFunction(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    checks.mobile_no_horizontal_overflow = true;
    await capture('19-personal-agent-boundaries-mobile.png', 'The same identity and access ledger remains usable at a 390-pixel mobile viewport.');
  } catch (error) {
    flowError = new Error(redact(error?.message || error));
  } finally {
    if (bootstrapContext) await bootstrapContext.close().catch(() => {});
    if (page && !page.isClosed()) await page.close().catch(() => {});
    if (video) {
      try {
        await video.saveAs(webmPath);
        videoSaved = true;
      } catch (error) {
        flowError ||= new Error(`Could not save the recorded WebM: ${redact(error.message)}`);
      }
    }
    if (recordingContext) await recordingContext.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    await fs.rm(tempVideoDir, { recursive: true, force: true }).catch(() => {});
  }

  const ffmpegPath = process.env.OAM_FFMPEG_PATH || '/usr/bin/ffmpeg';
  if (!flowError && videoSaved && await fileExists(ffmpegPath)) {
    try {
      await execFileAsync(ffmpegPath, [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-i', webmPath,
        '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
        '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4Path,
      ]);
      mp4Saved = true;
    } catch (error) {
      flowError = new Error(`WebM was saved, but MP4 transcoding failed: ${redact(error.stderr || error.message)}`);
    }
  }

  const safeBrowserErrors = [...new Set(browserErrors.map(redact))];
  const expectedStepCount = 19;
  if (!flowError && steps.length !== expectedStepCount) {
    flowError = new Error(`Capture completed only ${steps.length}/${expectedStepCount} required steps.`);
  }
  if (!flowError && safeBrowserErrors.length) {
    flowError = new Error(`Capture recorded ${safeBrowserErrors.length} unexpected browser error(s).`);
  }

  const report = {
    schema_version: 1,
    captured_at: new Date().toISOString(),
    base_url: baseUrl,
    run_id: runId,
    scenario: 'One synthetic employee and one separately governed Personal Memory Agent',
    synthetic_employee: {
      display_name: employee.displayName,
      job_title: employee.jobTitle,
      personal_agent_name: employee.agentName,
    },
    browser: `Playwright with system Chrome at ${executablePath}`,
    capture_contract: {
      operator_authentication_recorded: false,
      workspace_link_rendering: 'masked password field only',
      workspace_activation_fragment_scrubbed_before_render: checks.workspace_fragment_scrubbed,
      raw_credentials_written_to_artifacts: false,
      created_pair_preserved_for_walkthrough: true,
    },
    checks,
    steps,
    artifacts: {
      webm: videoSaved ? path.relative(outputRoot, webmPath) : null,
      mp4: mp4Saved ? path.relative(outputRoot, mp4Path) : null,
      screenshot_directory: path.relative(outputRoot, screenshotDir),
    },
    browser_errors: safeBrowserErrors,
    failure: flowError ? redact(flowError.message) : null,
    passed: !flowError,
  };
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o644 });

  console.log(JSON.stringify({
    passed: report.passed,
    screenshots: steps.length,
    webm: report.artifacts.webm,
    mp4: report.artifacts.mp4,
    report: path.relative(process.cwd(), reportPath),
    failure: report.failure,
  }, null, 2));
  if (flowError) throw flowError;
}

run().catch((error) => {
  console.error(`Employee workflow media capture failed: ${redact(error?.message || error)}`);
  process.exitCode = 1;
});
