import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = (process.env.OAM_QA_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const outputDir = path.resolve(process.argv[2] || 'artifacts/qa/browser');
const executablePath = process.env.OAM_CHROME_PATH || '/usr/bin/google-chrome';
const routes = ['/', '/assets', '/demo', '/method', '/evidence'];
const viewports = [
  { key: 'desktop-1440', width: 1440, height: 1000, screenshot: true },
  { key: 'desktop-1280', width: 1280, height: 900, screenshot: false },
  { key: 'tablet-768', width: 768, height: 1024, screenshot: true },
  { key: 'mobile-390', width: 390, height: 844, screenshot: true },
  { key: 'mobile-560', width: 560, height: 900, screenshot: false },
  { key: 'tablet-680', width: 680, height: 960, screenshot: false },
  { key: 'desktop-1080', width: 1080, height: 900, screenshot: false },
];

await fs.mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath,
  args: ['--no-sandbox'],
});

const checks = [];
const failures = [];

for (const viewport of viewports) {
  for (const route of routes) {
    const page = await browser.newPage({ viewport });
    const consoleErrors = [];
    const pageErrors = [];
    const failedRequests = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()}`));

    const response = await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle' });
    const state = await page.evaluate(() => {
      const h1 = [...document.querySelectorAll('h1')].map((node) => node.textContent.trim());
      const allText = document.body.innerText;
      const tinyTargets = [...document.querySelectorAll('button, a[href], summary, [role="button"]')]
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            text: (element.getAttribute('aria-label') || element.textContent || '').trim().slice(0, 80),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            visible: rect.width > 0 && rect.height > 0,
          };
        })
        .filter((target) => target.visible && (target.width < 44 || target.height < 44));
      return {
        title: document.title,
        h1,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        readyText: allText.includes('Memory retrieval is unavailable') ? 'error' : 'ok',
        canonicalWebsiteTask: allText.includes('Prepare a new website delivery handoff')
          || allText.includes('website_delivery_handoff'),
        missingReviewBadges: document.querySelectorAll('.asset-review-not_provided').length,
        tinyTargets,
      };
    });

    if (viewport.screenshot) {
      const routeKey = route === '/' ? 'home' : route.slice(1);
      await page.screenshot({
        path: path.join(outputDir, `${routeKey}-${viewport.key}.png`),
        fullPage: true,
      });
    }

    const check = {
      route,
      viewport: viewport.key,
      status: response?.status() || 0,
      ...state,
      consoleErrors,
      pageErrors,
      failedRequests,
    };
    checks.push(check);

    if (check.status !== 200) failures.push(`${route} ${viewport.key}: HTTP ${check.status}`);
    if (['/', '/demo', '/method'].includes(route) && !check.canonicalWebsiteTask) {
      failures.push(`${route} ${viewport.key}: canonical website-delivery path is not visible`);
    }
    if (['/', '/demo'].includes(route) && check.missingReviewBadges) {
      failures.push(`${route} ${viewport.key}: recommendation lifecycle metadata is missing`);
    }
    if (route === '/evidence' && await page.locator('[data-evidence-type="assets"]').count()) {
      failures.push(`${route} ${viewport.key}: capability assets leaked into continuity evidence tabs`);
    }
    if (check.h1.length !== 1) failures.push(`${route} ${viewport.key}: expected one H1, got ${check.h1.length}`);
    if (check.scrollWidth > check.clientWidth) failures.push(`${route} ${viewport.key}: horizontal overflow ${check.scrollWidth}/${check.clientWidth}`);
    if (check.tinyTargets.length) failures.push(`${route} ${viewport.key}: interactive targets smaller than 44 x 44`);
    if (check.readyText !== 'ok') failures.push(`${route} ${viewport.key}: visible retrieval error`);
    if (consoleErrors.length || pageErrors.length || failedRequests.length) {
      failures.push(`${route} ${viewport.key}: browser errors detected`);
    }
  }
}

const interactionPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
await interactionPage.goto(`${baseUrl}/demo`, { waitUntil: 'networkidle' });
await interactionPage.waitForFunction(() => (
  document.querySelector('[data-recommendation-result]')?.textContent.includes('Prepare a new website delivery handoff')
));
const defaultTaskKey = await interactionPage.locator('[data-recommendation-form] select').inputValue();
await interactionPage.locator('[data-menu-button]').click();
const mobileMenuExpanded = await interactionPage.locator('[data-menu-button]').getAttribute('aria-expanded');
await interactionPage.locator('[data-menu-button]').click();
await interactionPage.locator('[data-assist-form] textarea').fill('Adapt this stored starting point for a small agency team.');
await interactionPage.locator('[data-assist-form]').evaluate((form) => form.requestSubmit());
await interactionPage.waitForFunction(() => document.querySelector('[data-assist-result] .assist-result'));
const capabilityInteraction = await interactionPage.evaluate(() => {
  const result = document.querySelector('[data-assist-result] .assist-result');
  return {
    recommendationRows: document.querySelectorAll('[data-recommendation-result] .recommended-asset-row').length,
    reviewBadges: document.querySelectorAll('[data-recommendation-result] .asset-review').length,
    whyItWorkedLines: document.querySelectorAll('[data-recommendation-result] .recommended-asset-why').length,
    evidenceLinks: document.querySelectorAll('[data-recommendation-result] .recommended-asset-evidence').length,
    missingReviewBadges: document.querySelectorAll('[data-recommendation-result] .asset-review-not_provided').length,
    interactionStatus: result?.classList.contains('assist-fallback') ? 'fallback' : result ? 'generated' : 'missing',
    status: document.querySelector('[data-assist-status]')?.textContent.trim(),
  };
});
await interactionPage.locator('[data-example-query]').first().click();
await interactionPage.locator('[data-query-form]').evaluate((form) => form.requestSubmit());
await interactionPage.waitForFunction(() => document.querySelectorAll('.memory-row').length > 0);
const queryInteraction = await interactionPage.evaluate(() => ({
  rows: document.querySelectorAll('.memory-row').length,
  currentRows: document.querySelectorAll('.memory-row[data-state="current"]').length,
  supersededRows: document.querySelectorAll('.memory-row[data-state="superseded"]').length,
  text: document.querySelector('[data-query-result]')?.textContent || '',
  status: document.querySelector('[data-query-status]')?.textContent.trim(),
}));
if (mobileMenuExpanded !== 'true') failures.push('mobile navigation did not expand');
if (defaultTaskKey !== 'website_delivery_handoff') failures.push('canonical website-delivery task is not the demo default');
if (!capabilityInteraction.recommendationRows) failures.push('task recommendation rows did not remain visible');
if (capabilityInteraction.reviewBadges !== capabilityInteraction.recommendationRows) {
  failures.push('task recommendation rows do not expose review status');
}
if (capabilityInteraction.missingReviewBadges) failures.push('task recommendation review status is missing');
if (capabilityInteraction.whyItWorkedLines !== capabilityInteraction.recommendationRows) {
  failures.push('task recommendation rows do not expose why-it-worked context');
}
if (capabilityInteraction.evidenceLinks !== capabilityInteraction.recommendationRows) {
  failures.push('task recommendation rows do not expose the evidence affordance');
}
if (!['generated', 'fallback'].includes(capabilityInteraction.interactionStatus)) {
  failures.push('Spark interaction did not render a generated or fallback state');
}
if (!queryInteraction.rows) failures.push('demo query did not render memory rows');
if (queryInteraction.currentRows !== 2 || queryInteraction.supersededRows !== 2) {
  failures.push('canonical continuity query did not retain two current and two superseded facts');
}
for (const expectedValue of ['4500 USD per month', '3000 USD per month', 'August 29, 2026', 'August 15, 2026']) {
  if (!queryInteraction.text.includes(expectedValue)) failures.push(`canonical continuity query omitted ${expectedValue}`);
}
await interactionPage.close();

const provenancePage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await provenancePage.goto(`${baseUrl}/demo?task=website_delivery_handoff`, { waitUntil: 'networkidle' });
await provenancePage.waitForFunction(() => document.querySelectorAll('.recommended-asset-row').length === 3);
await provenancePage.locator('.recommended-asset-row').first().click();
await provenancePage.waitForURL('**/assets?asset=*');
await provenancePage.waitForFunction(() => document.querySelector('.asset-inspector-header h2')?.textContent.trim());
const provenanceInteraction = await provenancePage.evaluate(() => ({
  selectedAsset: new URLSearchParams(window.location.search).get('asset'),
  title: document.querySelector('.asset-inspector-header h2')?.textContent.trim() || '',
  evidenceHeading: [...document.querySelectorAll('.asset-inspector-section h3')]
    .some((heading) => heading.textContent.includes('Asset -> observation -> source turn')),
  openEvidence: document.querySelectorAll('.asset-evidence[open]').length,
}));
if (provenanceInteraction.selectedAsset !== 'prompt:website_handoff_brief_v1') {
  failures.push('recommendation evidence link did not open the canonical prompt asset');
}
if (!provenanceInteraction.title || !provenanceInteraction.evidenceHeading || !provenanceInteraction.openEvidence) {
  failures.push('canonical prompt asset did not expose its open provenance path');
}
await provenancePage.close();

await browser.close();

const report = {
  baseUrl,
  generatedAt: new Date().toISOString(),
  browser: `Playwright with system Chrome at ${executablePath}`,
  checks,
  interaction: {
    mobileMenuExpanded,
    defaultTaskKey,
    capabilityInteraction,
    queryInteraction,
    provenanceInteraction,
  },
  failures,
  passed: failures.length === 0,
};

await fs.writeFile(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ passed: report.passed, checks: checks.length, failures }, null, 2));
if (!report.passed) process.exitCode = 1;
