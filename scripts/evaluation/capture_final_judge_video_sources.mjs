import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const CONFIRMATION = 'CAPTURE_PUBLIC_FINAL_JUDGE_VIDEO_SOURCES';
if (process.env.OAM_FINAL_VIDEO_CAPTURE_CONFIRM !== CONFIRMATION) {
  throw new Error(`Set OAM_FINAL_VIDEO_CAPTURE_CONFIRM=${CONFIRMATION}.`);
}
if (typeof process.getuid === 'function' && process.getuid() === 0) {
  throw new Error('Run public browser capture as an unprivileged OS account so the Chrome sandbox remains enabled.');
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..', '..');
const generatorPath = fileURLToPath(import.meta.url);
const generatorSha256 = crypto.createHash('sha256')
  .update(await fs.readFile(generatorPath))
  .digest('hex');
const baseUrl = (process.env.OAM_QA_BASE_URL || 'https://memory.sellsystems.agency')
  .replace(/\/$/, '');
const executablePath = process.env.OAM_CHROME_PATH || '/usr/bin/google-chrome';
const outputDirectory = path.resolve(
  process.argv[2]
    || path.join(
      repositoryRoot,
      'artifacts',
      'submission',
      'media',
      'final-judge-video',
      'sources',
    ),
);
const viewport = { width: 1920, height: 1080 };
const temporaryVideoDirectory = path.join(outputDirectory, `.playwright-video-${process.pid}`);
const outputVideo = path.join(outputDirectory, 'public-capability-interaction.webm');
const captureReportPath = path.join(outputDirectory, 'public-interaction-capture-report.json');
const screenshotNames = [
  '01-home-1920x1080.png',
  '02-search-results-1920x1080.png',
  '03-asset-inspector-provenance-1920x1080.png',
  '04-asset-source-path-1920x1080.png',
  '05-assist-result-1920x1080.png',
  '06-analytics-access-proof-1920x1080.png',
];
const assistUrl = `${baseUrl}/api/public/capability-assist`;
const expectedPublicBoundaryUrl = `${baseUrl}/api/public/evidence?type=fact&thread=private`;
const expectedAssetKeys = [
  'prompt:website_handoff_brief_v1',
  'workflow:portfolio_site_delivery_v1',
  'decision:source_first_before_generation_v1',
];
const requiredSourceTurnIds = ['st-002', 'st-009', 'st-001'];
const allowedSourceTurnIds = [...requiredSourceTurnIds, 'st-007'];

await fs.mkdir(outputDirectory, { recursive: true });
await fs.mkdir(temporaryVideoDirectory, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath,
});
const context = await browser.newContext({
  viewport,
  deviceScaleFactor: 1,
  recordVideo: { dir: temporaryVideoDirectory, size: viewport },
});
const page = await context.newPage();
page.setDefaultTimeout(30_000);

const startedAt = Date.now();
const scenes = [];
const requests = [];
const consoleMessages = [];
const pageErrors = [];
const nonOkResponses = [];
const assistApiResponses = [];
let assistResponse = null;

function mark(scene, details = {}) {
  scenes.push({
    scene,
    at_seconds: Number(((Date.now() - startedAt) / 1000).toFixed(3)),
    ...details,
  });
}

function normalizeAssist(payload) {
  const root = payload?.data || payload || {};
  const interaction = root.interaction || root.assist || {};
  const plan = interaction.plan || interaction.output || {};
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  const recommendations = Array.isArray(root.recommendations) ? root.recommendations : [];
  if (!['generated', 'fallback'].includes(interaction.status)) {
    throw new Error('Capability-assist response omitted an explicit generated or fallback status.');
  }
  return {
    status: interaction.status,
    model: typeof interaction.model === 'string' ? interaction.model : '',
    selected_asset_keys: Array.isArray(interaction.selected_asset_keys)
      ? interaction.selected_asset_keys
      : [],
    plan_step_count: steps.length,
    steps: steps.map((step) => ({
      asset_keys: Array.isArray(step.asset_keys) ? step.asset_keys : [],
      source_turn_ids: Array.isArray(step.source_turn_ids) ? step.source_turn_ids : [],
    })),
    selected_asset_provenance: Object.fromEntries(recommendations.map((asset) => [
      asset.asset_key,
      Array.isArray(asset?.evidence?.source_turns)
        ? asset.evidence.source_turns.map((turn) => turn?.source_turn_id).filter(Boolean)
        : [],
    ])),
    cited_asset_keys: [...new Set(steps.flatMap((step) => (
      Array.isArray(step.asset_keys) ? step.asset_keys : []
    )))],
    cited_source_turn_ids: [...new Set(steps.flatMap((step) => (
      Array.isArray(step.source_turn_ids) ? step.source_turn_ids : []
    )))],
  };
}

page.on('console', (message) => {
  if (['warning', 'error'].includes(message.type())) {
    consoleMessages.push({
      type: message.type(),
      text: message.text(),
      location_url: message.location().url || '',
    });
  }
});
page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('requestfailed', (request) => {
  requests.push({
    url: request.url(),
    method: request.method(),
    failure: request.failure()?.errorText || 'request failed',
  });
});
page.on('response', (response) => {
  const record = {
    url: response.url(),
    method: response.request().method(),
    status: response.status(),
  };
  if (response.status() >= 400) nonOkResponses.push(record);
  if (response.url() === assistUrl && record.method === 'POST') assistApiResponses.push(record);
});

async function goto(route) {
  const response = await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle' });
  if (!response?.ok()) throw new Error(`${route} returned HTTP ${response?.status() || 0}.`);
  return response.status();
}

async function screenshot(filename) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.waitForTimeout(250);
  await page.screenshot({
    path: path.join(outputDirectory, filename),
    fullPage: false,
    animations: 'disabled',
  });
}

let video;
let captureFailure;
try {
  mark('capture_start', { disclosure: 'Synthetic public-safe demo data' });
  await goto('/');
  await page.waitForFunction(() => (
    document.body.innerText.includes('Prepare a new website delivery handoff')
    && document.querySelectorAll('[data-home-timeline] .timeline-entry').length === 4
  ));
  mark('home_ready', { route: '/' });
  await screenshot('01-home-1920x1080.png');
  await page.waitForTimeout(2_000);

  await goto('/capabilities');
  await page.waitForFunction(() => (
    document.querySelectorAll('.judge-results-table tbody tr').length === 3
    && document.querySelectorAll('.judge-plan-row').length === 3
    && document.querySelector('[data-access-proofs]')?.textContent.includes('PASS 22/22')
  ));
  const searchInput = page.locator('[data-capability-search-form] input[name="query"]');
  await searchInput.fill('');
  mark('search_typing', { route: '/capabilities' });
  await searchInput.pressSequentially('Prepare a website delivery handoff', { delay: 28 });
  await page.locator('[data-capability-search-form]').evaluate((form) => form.requestSubmit());
  await page.waitForFunction(() => (
    document.querySelector('[data-judge-search-status]')?.dataset.matchStatus === 'matched'
    && document.querySelectorAll('.judge-results-table tbody tr').length === 3
  ));
  const selectedAssetKeys = await page.locator(
    '.judge-results-table tbody a[href^="/assets?asset="]',
  ).evaluateAll((links) => [...new Set(links.map((link) => (
    new URL(link.href).searchParams.get('asset')
  )).filter(Boolean))]);
  mark('search_results', {
    route: '/capabilities',
    result_count: 3,
    selected_asset_keys: selectedAssetKeys,
  });
  await screenshot('02-search-results-1920x1080.png');
  await page.waitForTimeout(3_000);

  await goto('/assets?asset=prompt%3Awebsite_handoff_brief_v1');
  await page.waitForFunction(() => (
    document.body.innerText.includes('Asset -> observation -> source turn')
    && document.querySelector('.asset-evidence[open]')
  ));
  await page.locator('.asset-inspector').scrollIntoViewIfNeeded();
  mark('asset_inspector', {
    route: '/assets?asset=prompt%3Awebsite_handoff_brief_v1',
    asset_key: 'prompt:website_handoff_brief_v1',
  });
  await screenshot('03-asset-inspector-provenance-1920x1080.png');
  await page.locator('.asset-evidence[open]').scrollIntoViewIfNeeded();
  mark('asset_provenance', {
    route: '/assets?asset=prompt%3Awebsite_handoff_brief_v1',
    path: 'asset -> observation -> source turn',
  });
  await screenshot('04-asset-source-path-1920x1080.png');
  await page.waitForTimeout(3_000);

  await goto('/capabilities');
  await page.waitForFunction(() => (
    document.querySelectorAll('.judge-results-table tbody tr').length === 3
    && document.querySelector('[data-assist-submit]')?.disabled === false
  ));
  await page.locator('[data-assist-form] input[name="request"]')
    .fill('Adapt this grounded starting point for a small delivery team.');
  mark('assist_requested', { route: '/capabilities', attempts: 1 });
  const [assistHttpResponse] = await Promise.all([
    page.waitForResponse((response) => (
      response.url() === assistUrl && response.request().method() === 'POST'
    )),
    page.locator('[data-assist-form]').evaluate((form) => form.requestSubmit()),
  ]);
  assistResponse = normalizeAssist(await assistHttpResponse.json());
  await page.waitForFunction(() => (
    ['generated', 'fallback'].includes(
      document.querySelector('[data-plan-mode-value]')?.dataset.planModeValue,
    )
  ), null, { timeout: 45_000 });
  const renderedAssistMode = await page.locator('[data-plan-mode-value]')
    .getAttribute('data-plan-mode-value');
  if (assistResponse.status !== renderedAssistMode) {
    throw new Error('Rendered assist mode does not match the public API response.');
  }
  const unsupported = assistResponse.cited_asset_keys.filter(
    (key) => !selectedAssetKeys.includes(key),
  );
  if (unsupported.length) {
    throw new Error(`Assist cited assets outside the deterministic selection: ${unsupported.join(', ')}`);
  }
  await page.locator('[data-assist-result]').scrollIntoViewIfNeeded();
  mark('assist_result', { route: '/capabilities', ...assistResponse });
  await screenshot('05-assist-result-1920x1080.png');
  await page.waitForTimeout(3_000);

  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  mark('analytics_and_access_proof', {
    route: '/capabilities',
    analytics_scope: 'current synthetic nine-asset demo pack',
  });
  await screenshot('06-analytics-access-proof-1920x1080.png');
  await page.waitForTimeout(2_000);

  video = page.video();
} catch (error) {
  captureFailure = error;
} finally {
  await context.close();
}

try {
  if (captureFailure) throw captureFailure;
  if (!video) throw new Error('Playwright did not create a public interaction video.');
  await video.saveAs(outputVideo);
} finally {
  await browser.close();
  await fs.rm(temporaryVideoDirectory, { recursive: true, force: true });
}

const expectedBoundaryDenialsValid = nonOkResponses.length === 2
  && nonOkResponses.every((response) => (
    response.url === expectedPublicBoundaryUrl
    && response.method === 'GET'
    && response.status === 400
  ));
const unexpectedConsoleMessages = consoleMessages.filter(({ type, text, location_url: locationUrl }) => !(
  expectedBoundaryDenialsValid
  && type === 'error'
  && text === 'Failed to load resource: the server responded with a status of 400 (Bad Request)'
  && locationUrl === expectedPublicBoundaryUrl
));
const selectedAssetKeysValid = expectedAssetKeys.every(
  (key) => assistResponse?.selected_asset_keys.includes(key),
) && assistResponse?.selected_asset_keys.length === expectedAssetKeys.length;
const citationKeysValid = expectedAssetKeys.every(
  (key) => assistResponse?.cited_asset_keys.includes(key),
) && assistResponse?.cited_asset_keys.length === expectedAssetKeys.length;
const citationSourceTurnsValid = requiredSourceTurnIds.every(
  (sourceTurnId) => assistResponse?.cited_source_turn_ids.includes(sourceTurnId),
) && assistResponse?.cited_source_turn_ids.every(
  (sourceTurnId) => allowedSourceTurnIds.includes(sourceTurnId),
) && assistResponse?.cited_source_turn_ids.length >= requiredSourceTurnIds.length
  && assistResponse?.cited_source_turn_ids.length <= allowedSourceTurnIds.length;
const perStepCitationContainmentValid = assistResponse?.steps.length === assistResponse?.plan_step_count
  && assistResponse.steps.every((step) => {
    if (!step.asset_keys.length || !step.source_turn_ids.length
        || step.asset_keys.some((key) => !assistResponse.selected_asset_keys.includes(key))) {
      return false;
    }
    const allowedForStep = new Set(step.asset_keys.flatMap(
      (key) => assistResponse.selected_asset_provenance[key] || [],
    ));
    return step.source_turn_ids.every((sourceTurnId) => allowedForStep.has(sourceTurnId));
  });
if (assistResponse) assistResponse.per_step_citation_containment = perStepCitationContainmentValid;
const assistApiResponsesValid = assistApiResponses.length === 1
  && assistApiResponses[0].url === assistUrl
  && assistApiResponses[0].method === 'POST'
  && (
    (assistResponse?.status === 'generated' && assistApiResponses[0].status === 200)
    || (assistResponse?.status === 'fallback' && [200, 400].includes(assistApiResponses[0].status))
  );
const expectedBoundaryConsoleMessagesValid = consoleMessages.filter(
  ({ location_url: locationUrl }) => locationUrl === expectedPublicBoundaryUrl,
).length === 2;
async function describeArtifact(filePath) {
  const bytes = await fs.readFile(filePath);
  return {
    path: path.basename(filePath),
    bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}
const screenshotArtifacts = await Promise.all(screenshotNames.map(
  (name) => describeArtifact(path.join(outputDirectory, name)),
));
const videoArtifact = await describeArtifact(outputVideo);
const report = {
  schema_version: 2,
  generator: {
    path: path.relative(repositoryRoot, generatorPath).split(path.sep).join('/'),
    sha256: generatorSha256,
  },
  base_url: baseUrl,
  captured_at: new Date().toISOString(),
  browser: `Playwright with system Chrome at ${executablePath}`,
  browser_availability: 'Browser plugin not available; repository Playwright used with system Chrome.',
  browser_security: {
    uid: typeof process.getuid === 'function' ? process.getuid() : null,
    root: false,
    chrome_sandbox: 'enabled',
  },
  viewport,
  query: 'Prepare a website delivery handoff',
  assist_attempts: 1,
  assist: assistResponse,
  scenes,
  screenshots: screenshotArtifacts,
  video: videoArtifact,
  console_messages: consoleMessages,
  unexpected_console_messages: unexpectedConsoleMessages,
  non_ok_responses: nonOkResponses,
  expected_public_boundary_denials: {
    url: expectedPublicBoundaryUrl,
    expected_count: 2,
    observed_count: nonOkResponses.filter(({ url }) => url === expectedPublicBoundaryUrl).length,
  },
  assist_api_responses: assistApiResponses,
  page_errors: pageErrors,
  failed_requests: requests,
  passed: Boolean(assistResponse)
    && assistResponse.plan_step_count >= 3
    && assistResponse.plan_step_count <= 6
    && ['generated', 'fallback'].includes(assistResponse.status)
    && assistResponse.model === 'gpt-5.3-codex-spark'
    && selectedAssetKeysValid
    && citationKeysValid
    && citationSourceTurnsValid
    && perStepCitationContainmentValid
    && assistApiResponsesValid
    && expectedBoundaryDenialsValid
    && expectedBoundaryConsoleMessagesValid
    && unexpectedConsoleMessages.length === 0
    && pageErrors.length === 0
    && requests.length === 0,
};

await fs.writeFile(captureReportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  passed: report.passed,
  assist: report.assist,
  scenes: report.scenes.length,
  screenshots: report.screenshots.length,
  video: path.relative(repositoryRoot, outputVideo),
}, null, 2));
if (!report.passed) process.exitCode = 1;
