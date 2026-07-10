import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = (process.env.OAM_QA_BASE_URL || 'https://memory.sellsystems.agency').replace(/\/$/, '');
const outputDir = path.resolve(process.argv[2] || 'artifacts/submission/screenshots');
const executablePath = process.env.OAM_CHROME_PATH || '/usr/bin/google-chrome';
const viewport = { width: 1440, height: 900 };

await fs.mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath,
  args: ['--no-sandbox'],
});

const captures = [];

async function capture(filename, route, prepare = async () => {}) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  const response = await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle' });
  if (!response?.ok()) throw new Error(`${route} returned HTTP ${response?.status() || 0}`);
  await prepare(page);
  const filePath = path.join(outputDir, filename);
  await page.screenshot({ path: filePath, fullPage: false });
  captures.push({ filename, route, status: response.status(), errors });
  await page.close();
}

async function alignSection(page, selector, topOffset = 88) {
  const target = page.locator(selector);
  await target.waitFor({ state: 'visible' });
  await target.evaluate((element, offset) => {
    const top = window.scrollY + element.getBoundingClientRect().top - offset;
    window.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
  }, topOffset);
  await page.waitForTimeout(100);
}

await capture('01-home-capability-memory-1440.png', '/', async (page) => {
  await page.waitForFunction(() => document.body.innerText.includes('Prepare a new website delivery handoff'));
});

await capture(
  '02-demo-website-delivery-recommendation-1440.png',
  '/demo?task=website_delivery_handoff',
  async (page) => {
    await page.waitForFunction(() => document.body.innerText.includes('Why it worked:'));
    await alignSection(page, '.recommendation-workspace', 16);
  },
);

await capture(
  '03-assets-governance-provenance-1440.png',
  '/assets?asset=prompt%3Awebsite_handoff_brief_v1',
  async (page) => {
    await page.waitForFunction(() => document.body.innerText.includes('Asset -> observation -> source turn'));
    await alignSection(page, '.assets-workspace', 0);
  },
);

await capture(
  '04-demo-temporal-truth-1440.png',
  '/demo?task=website_delivery_handoff',
  async (page) => {
    await page.locator('[data-query-form]').evaluate((form) => form.requestSubmit());
    await page.waitForFunction(() => document.querySelectorAll('.memory-row').length === 4);
    await alignSection(page, '.demo-evidence-query', 72);
  },
);

await capture('05-method-authority-1440.png', '/method', async (page) => {
  await page.waitForFunction(() => document.body.innerText.includes('website_delivery_handoff'));
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
});

await browser.close();

const failures = captures.flatMap((capture) => capture.errors.map((error) => ({
  filename: capture.filename,
  error,
})));
const report = {
  base_url: baseUrl,
  captured_at: new Date().toISOString(),
  viewport,
  browser: `Playwright with system Chrome at ${executablePath}`,
  captures,
  failures,
  passed: failures.length === 0,
};

await fs.writeFile(
  path.join(outputDir, 'capture-report.json'),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify({ passed: report.passed, captures: captures.length, failures }, null, 2));
if (!report.passed) process.exitCode = 1;
