import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = (process.env.OAM_QA_BASE_URL || 'https://memory.sellsystems.agency').replace(/\/$/, '');
const outputDir = path.resolve(process.argv[2] || 'artifacts/submission/screenshots');
const executablePath = process.env.OAM_CHROME_PATH || '/usr/bin/google-chrome';
const operatorCredentialFile = process.env.OAM_QA_OPERATOR_CREDENTIAL_FILE || '';
const desktop = { width: 1440, height: 1000 };

await fs.mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath,
  args: ['--no-sandbox'],
});

const captures = [];

function unexpectedErrors(errors, route) {
  return errors.filter((error) => !(
    route === '/demo' && error.includes('400 (Bad Request)')
  ));
}

async function capture(filename, route, {
  viewport = desktop,
  prepare = async () => {},
} = {}) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  const response = await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle' });
  if (!response?.ok()) throw new Error(`${route} returned HTTP ${response?.status() || 0}`);
  await prepare(page);
  await page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(outputDir, filename), fullPage: false });
  captures.push({
    filename,
    route,
    viewport,
    status: response.status(),
    errors,
    unexpected_errors: unexpectedErrors(errors, route),
  });
  await page.close();
}

await capture('01-home-capability-memory-1440.png', '/', {
  prepare: (page) => page.waitForFunction(() => (
    document.body.innerText.includes('Prepare a new website delivery handoff')
    && document.querySelectorAll('[data-home-timeline] .timeline-entry').length === 4
  )),
});

await capture('02-judge-demo-capability-loop-1440.png', '/demo', {
  prepare: (page) => page.waitForFunction(() => (
    document.querySelectorAll('.judge-results-table tbody tr').length === 3
    && document.querySelectorAll('.judge-plan-row').length === 3
    && document.querySelector('[data-access-proofs]')?.textContent.includes('PASS 22/22')
  )),
});

await capture('03-judge-demo-spark-plan-1440.png', '/demo', {
  prepare: async (page) => {
    await page.waitForFunction(() => document.querySelector('[data-assist-submit]')?.disabled === false);
    await page.locator('[data-assist-form] input[name="request"]').fill('Adapt this grounded starting point for a small delivery team.');
    await page.locator('[data-assist-form]').evaluate((form) => form.requestSubmit());
    await page.waitForFunction(() => (
      ['generated', 'fallback'].includes(document.querySelector('[data-plan-mode-value]')?.dataset.planModeValue)
    ), null, { timeout: 30_000 });
    if (await page.locator('[data-plan-mode-value]').getAttribute('data-plan-mode-value') !== 'generated') {
      await page.waitForTimeout(2_000);
      await page.locator('[data-assist-form]').evaluate((form) => form.requestSubmit());
      await page.waitForFunction(() => (
        document.querySelector('[data-plan-mode-value]')?.dataset.planModeValue === 'generated'
      ), null, { timeout: 30_000 });
    }
  },
});

await capture('04-assets-governance-provenance-1440.png', '/assets?asset=prompt%3Awebsite_handoff_brief_v1', {
  prepare: (page) => page.waitForFunction(() => (
    document.body.innerText.includes('Asset -> observation -> source turn')
    && document.querySelector('.asset-evidence[open]')
  )),
});

await capture('05-method-architecture-1440.png', '/method', {
  prepare: (page) => page.waitForFunction(() => document.body.innerText.includes('website_delivery_handoff')),
});

await capture('06-judge-demo-mobile-390.png', '/demo', {
  viewport: { width: 390, height: 844 },
  prepare: (page) => page.waitForFunction(() => (
    document.querySelectorAll('.judge-results-table tbody tr').length === 3
    && document.querySelectorAll('.judge-proof.is-pass').length === 2
  )),
});

let operatorCapture = { tested: false, reason: 'operator credential file not configured' };
if (operatorCredentialFile) {
  const credential = JSON.parse(await fs.readFile(operatorCredentialFile, 'utf8'));
  if (typeof credential.architect_token !== 'string' || credential.architect_token.length < 32) {
    throw new Error('Operator screenshot credential file is invalid.');
  }
  const page = await browser.newPage({ viewport: desktop, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  const response = await page.goto(`${baseUrl}/architect/`, { waitUntil: 'networkidle' });
  if (!response?.ok()) throw new Error(`/architect/ returned HTTP ${response?.status() || 0}`);
  await page.locator('[data-login-form] input[name="token"]').fill(credential.architect_token);
  await page.locator('[data-login-form]').evaluate((form) => form.requestSubmit());
  await page.waitForSelector('.console-shell');
  await page.waitForFunction(() => document.querySelectorAll('.principal-table tbody tr').length > 0);
  const architectPrincipalId = await page.locator('.principal-table tbody tr', { hasText: 'human:ai_architect' }).getAttribute('data-principal-id');
  await page.locator('[data-view-target="overview"]').first().click();
  await page.waitForSelector('.overview-page');
  await page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.screenshot({
    path: path.join(outputDir, '07-architect-console-four-plane-1440.png'),
    fullPage: false,
  });
  await page.locator('[data-view-target="effective-access"]').first().click();
  await page.locator('[data-effective-access-form] select[name="principal_id"]').selectOption(architectPrincipalId);
  await page.locator('[data-effective-access-form]').evaluate((form) => form.requestSubmit());
  await page.waitForFunction(() => (
    [...document.querySelectorAll('.permission-list.is-denied code')]
      .some((node) => node.textContent === 'memory.canonical.write')
  ));
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({
    path: path.join(outputDir, '08-architect-effective-access-1440.png'),
    fullPage: false,
  });
  captures.push(
    { filename: '07-architect-console-four-plane-1440.png', route: '/architect/', viewport: desktop, status: response.status(), errors, unexpected_errors: errors.filter((error) => !error.includes('401 (Unauthorized)')) },
    { filename: '08-architect-effective-access-1440.png', route: '/architect/', viewport: desktop, status: response.status(), errors, unexpected_errors: errors.filter((error) => !error.includes('401 (Unauthorized)')) },
  );
  operatorCapture = { tested: true, signed_in_as: 'architect', canonical_write_denial_visible: true };
  await page.close();
}

await browser.close();

const failures = captures.flatMap((capture) => capture.unexpected_errors.map((error) => ({
  filename: capture.filename,
  error,
})));
const report = {
  base_url: baseUrl,
  captured_at: new Date().toISOString(),
  browser: `Playwright with system Chrome at ${executablePath}`,
  browser_availability: 'Browser plugin not available; repository Playwright used with system Chrome.',
  captures,
  operator: operatorCapture,
  failures,
  passed: failures.length === 0,
};

await fs.writeFile(
  path.join(outputDir, 'capture-report.json'),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify({ passed: report.passed, captures: captures.length, failures }, null, 2));
if (!report.passed) process.exitCode = 1;
