import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = (process.env.OAM_QA_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const outputDir = path.resolve(process.argv[2] || 'artifacts/qa/browser');
const executablePath = process.env.OAM_CHROME_PATH || '/usr/bin/google-chrome';
const operatorCredentialFile = process.env.OAM_QA_OPERATOR_CREDENTIAL_FILE || '';
const requireOperator = process.env.OAM_QA_REQUIRE_OPERATOR === '1';
const browserAvailability = 'Browser plugin not available; repository Playwright used with system Chrome.';
const routes = ['/', '/assets', '/capabilities', '/method', '/evidence'];
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
      const targetSelector = document.querySelector('.judge-demo')
        ? 'button, summary, [role="button"], a.judge-menu, a.judge-help, a.judge-rail-link, .judge-section-title > a'
        : 'button, a[href], summary, [role="button"]';
      const tinyTargets = [...document.querySelectorAll(targetSelector)]
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
        canonicalWebsiteTask: allText.includes('Prepare a website delivery handoff')
          || allText.includes('website_delivery_handoff')
          || document.querySelector('[data-capability-search-form] input[name="query"]')?.value === 'Prepare a website delivery handoff',
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
    if (['/', '/capabilities', '/method'].includes(route) && !check.canonicalWebsiteTask) {
      failures.push(`${route} ${viewport.key}: canonical website-delivery path is not visible`);
    }
    if (['/', '/capabilities'].includes(route) && check.missingReviewBadges) {
      failures.push(`${route} ${viewport.key}: recommendation lifecycle metadata is missing`);
    }
    if (route === '/evidence' && await page.locator('[data-evidence-type="assets"]').count()) {
      failures.push(`${route} ${viewport.key}: capability assets leaked into continuity evidence tabs`);
    }
    if (check.h1.length !== 1) failures.push(`${route} ${viewport.key}: expected one H1, got ${check.h1.length}`);
    if (check.scrollWidth > check.clientWidth) failures.push(`${route} ${viewport.key}: horizontal overflow ${check.scrollWidth}/${check.clientWidth}`);
    if (check.tinyTargets.length) failures.push(`${route} ${viewport.key}: interactive targets smaller than 44 x 44`);
    if (check.readyText !== 'ok') failures.push(`${route} ${viewport.key}: visible retrieval error`);
    const unexpectedConsoleErrors = consoleErrors.filter((message) => !(
      route === '/capabilities' && message.includes('400 (Bad Request)')
    ));
    check.unexpectedConsoleErrors = unexpectedConsoleErrors;
    if (unexpectedConsoleErrors.length || pageErrors.length || failedRequests.length) {
      failures.push(`${route} ${viewport.key}: browser errors detected`);
    }
  }
}

const interactionContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
  permissions: ['clipboard-read', 'clipboard-write'],
});
const interactionPage = await interactionContext.newPage();
const interactionPageErrors = [];
interactionPage.on('pageerror', (error) => interactionPageErrors.push(error.message));
await interactionPage.goto(`${baseUrl}/capabilities`, { waitUntil: 'networkidle' });
await interactionPage.waitForFunction(() => (
  document.querySelectorAll('.judge-results-table tbody tr').length === 3
  && document.querySelectorAll('.judge-plan-row').length === 3
  && document.querySelectorAll('.judge-metric').length === 4
  && document.querySelectorAll('.judge-proof.is-pass').length === 2
));
const initialJudgeState = await interactionPage.evaluate(() => ({
  resultRows: document.querySelectorAll('.judge-results-table tbody tr').length,
  planRows: document.querySelectorAll('.judge-plan-row').length,
  analyticsMetrics: document.querySelectorAll('.judge-metric').length,
  passingProofs: document.querySelectorAll('.judge-proof.is-pass').length,
  proofText: document.querySelector('[data-access-proofs]')?.textContent || '',
  lifecycleText: document.querySelector('.lifecycle-policy')?.textContent || '',
  hasReviewFilter: Boolean(document.querySelector('[data-judge-review-filter]')),
  citationLinks: document.querySelectorAll('.judge-plan-row .judge-citation-list a').length,
  overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
}));

await interactionPage.locator('[data-judge-type-filter]').selectOption('prompt');
await interactionPage.waitForFunction(() => document.querySelectorAll('.judge-results-table tbody tr').length === 1);
const filteredRows = await interactionPage.locator('.judge-results-table tbody tr').count();
await interactionPage.locator('[data-judge-clear-filters]').click();
await interactionPage.waitForFunction(() => document.querySelectorAll('.judge-results-table tbody tr').length === 3);

await interactionPage.locator('[data-capability-search-form] input[name="query"]').fill('quantum payroll orchard');
await interactionPage.locator('[data-capability-search-form]').evaluate((form) => form.requestSubmit());
await interactionPage.waitForFunction(() => (
  document.querySelector('[data-judge-search-results] .judge-zero-state')
  && document.querySelectorAll('.judge-results-table tbody tr').length === 0
));
const negativeSearch = await interactionPage.evaluate(() => ({
  rows: document.querySelectorAll('.judge-results-table tbody tr').length,
  text: document.querySelector('[data-judge-search-results]')?.textContent || '',
  status: document.querySelector('[data-judge-search-status]')?.textContent || '',
}));

await interactionPage.locator('[data-capability-search-form] input[name="query"]').fill('Prepare a website delivery handoff');
await interactionPage.locator('[data-capability-search-form]').evaluate((form) => form.requestSubmit());
await interactionPage.waitForFunction(() => (
  document.querySelectorAll('.judge-results-table tbody tr').length === 3
  && document.querySelector('[data-assist-submit]')?.disabled === false
));
await interactionPage.locator('[data-assist-form] input[name="request"]').fill('Adapt this stored starting point for a small agency team.');
await interactionPage.locator('[data-assist-form]').evaluate((form) => form.requestSubmit());
await interactionPage.waitForFunction(() => (
  ['generated', 'fallback'].includes(document.querySelector('[data-plan-mode-value]')?.dataset.planModeValue)
), null, { timeout: 30_000 });
const capabilityInteraction = await interactionPage.evaluate(() => ({
  mode: document.querySelector('[data-plan-mode-value]')?.dataset.planModeValue || 'missing',
  planRows: document.querySelectorAll('[data-assist-result] .judge-plan-row').length,
  citationLinks: document.querySelectorAll('[data-assist-result] .judge-citation-list a').length,
  notes: [...document.querySelectorAll('[data-assist-result] .judge-plan-note')].map((note) => {
    const label = note.querySelector(':scope > strong')?.getBoundingClientRect();
    const items = note.querySelector('.judge-plan-note-items')?.getBoundingClientRect();
    return {
      itemCount: note.querySelectorAll('.judge-plan-note-items > span').length,
      directSpans: note.querySelectorAll(':scope > span').length,
      aligned: Boolean(label && items && items.left >= label.right),
    };
  }),
  status: document.querySelector('[data-assist-status]')?.textContent.trim() || '',
}));
await interactionPage.locator('[data-copy-plan]').click();
await interactionPage.waitForFunction(() => document.querySelector('[data-copy-plan]')?.textContent === 'Copied');
const copiedPlan = await interactionPage.evaluate(async () => navigator.clipboard.readText());
const planHasLimitations = await interactionPage.locator('.judge-plan-note', { hasText: 'Limitations' }).count() > 0;
const copyState = {
  text: copiedPlan,
  retainedAuthority: copiedPlan.includes('Authority:'),
  retainedAssets: copiedPlan.includes('Assets:'),
  retainedSourceTurns: copiedPlan.includes('Source turns:'),
  retainedHumanReview: copiedPlan.includes('Human review:'),
  retainedCitations: copiedPlan.includes('Citations:'),
  retainedLimitations: !planHasLimitations || copiedPlan.includes('Limitations:'),
};
await interactionPage.locator('[data-rerun-access-proof]').click();
await interactionPage.waitForFunction(() => document.querySelectorAll('.judge-proof.is-pass').length === 2);
if (initialJudgeState.resultRows !== 3 || initialJudgeState.planRows !== 3) failures.push('judge demo did not render three grounded assets and three authoritative plan steps');
if (initialJudgeState.analyticsMetrics !== 4) failures.push('judge demo did not render four reuse analytics metrics');
if (initialJudgeState.passingProofs !== 2 || !initialJudgeState.proofText.includes('PASS 22/22')) failures.push('judge demo did not render the 22/22 identity proof and live boundary pass');
if (!initialJudgeState.citationLinks) failures.push('authoritative judge plan did not expose source citations');
if (!initialJudgeState.lifecycleText.includes('Only approved content') || initialJudgeState.hasReviewFilter) failures.push('judge demo did not enforce approved-only reuse wording');
if (initialJudgeState.overflow) failures.push('judge demo overflows horizontally at 390px');
if (filteredRows !== 1) failures.push('capability type filter did not narrow the judge result to one prompt');
if (negativeSearch.rows !== 0 || !negativeSearch.text.includes('No governed capabilities')) failures.push('negative capability query did not remain an explicit no-match');
if (!negativeSearch.status.includes('0 results')) failures.push('negative capability query did not report zero results');
if (!negativeSearch.status.includes('No deterministic match') || negativeSearch.status.includes('Deterministic match ✓')) failures.push('negative capability query displayed a false deterministic-match success');
if (capabilityInteraction.mode !== 'generated') failures.push(`Spark interaction was ${capabilityInteraction.mode}, expected generated`);
if (!capabilityInteraction.planRows || !capabilityInteraction.citationLinks) failures.push('Spark adaptation omitted plan steps or validated citations');
if (capabilityInteraction.notes.some((note) => !note.itemCount || note.directSpans || !note.aligned)) failures.push('Spark plan notes were not grouped in the content column');
if (Object.entries(copyState).some(([key, value]) => key !== 'text' && !value)) failures.push('copied plan omitted governed provenance or limitations');
if (interactionPageErrors.length) failures.push(`judge interaction emitted page errors: ${interactionPageErrors.join('; ')}`);
await interactionContext.close();

const projectorPage = await browser.newPage({ viewport: { width: 1366, height: 768 } });
await projectorPage.goto(`${baseUrl}/capabilities`, { waitUntil: 'networkidle' });
await projectorPage.waitForFunction(() => document.querySelectorAll('.judge-plan-row').length === 3);
const projectorState = await projectorPage.evaluate(() => {
  const firstPlan = document.querySelector('.judge-plan-row')?.getBoundingClientRect();
  const proofDetail = document.querySelector('.judge-proof dd');
  return {
    firstPlanVisible: Boolean(firstPlan && firstPlan.top < window.innerHeight && firstPlan.bottom > 0),
    firstPlanTop: firstPlan?.top || null,
    proofFontSize: proofDetail ? Number.parseFloat(getComputedStyle(proofDetail).fontSize) : 0,
  };
});
if (!projectorState.firstPlanVisible) failures.push(`judge plan starts below the 1366x768 projector viewport (${projectorState.firstPlanTop})`);
if (projectorState.proofFontSize < 10) failures.push(`judge proof detail text is ${projectorState.proofFontSize}px at projector size`);
await projectorPage.close();

const continuityPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await continuityPage.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
await continuityPage.waitForFunction(() => document.querySelectorAll('[data-home-timeline] .timeline-entry').length === 4);
const queryInteraction = await continuityPage.evaluate(() => ({
  rows: document.querySelectorAll('[data-home-timeline] .timeline-entry').length,
  currentRows: document.querySelectorAll('[data-home-timeline] .timeline-entry:not(.superseded)').length,
  supersededRows: document.querySelectorAll('[data-home-timeline] .timeline-entry.superseded').length,
  text: document.querySelector('[data-home-timeline]')?.textContent || '',
}));
if (queryInteraction.currentRows !== 2 || queryInteraction.supersededRows !== 2) failures.push('continuity query did not retain two current and two superseded facts');
for (const expectedValue of ['4500 USD per month', '3000 USD per month', 'August 29, 2026', 'August 15, 2026']) {
  if (!queryInteraction.text.includes(expectedValue)) failures.push(`continuity query omitted ${expectedValue}`);
}
await continuityPage.close();

const provenancePage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await provenancePage.goto(`${baseUrl}/capabilities?task=website_delivery_handoff`, { waitUntil: 'networkidle' });
await provenancePage.waitForFunction(() => document.querySelectorAll('.judge-results-table tbody tr').length === 3);
await provenancePage.locator('.judge-results-table tbody tr td:nth-child(2) a').first().click();
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

let operatorInteraction = { tested: false, reason: 'operator credential file not configured' };
if (operatorCredentialFile) {
  const credential = JSON.parse(await fs.readFile(operatorCredentialFile, 'utf8'));
  if (typeof credential.architect_token !== 'string' || credential.architect_token.length < 32) {
    failures.push('operator QA credential file is invalid');
  } else {
    const operatorPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const operatorConsoleErrors = [];
    const operatorPageErrors = [];
    operatorPage.on('console', (message) => {
      if (message.type() === 'error') operatorConsoleErrors.push(message.text());
    });
    operatorPage.on('pageerror', (error) => operatorPageErrors.push(error.message));
    const loginResponse = await operatorPage.goto(`${baseUrl}/architect/`, { waitUntil: 'networkidle' });
    await operatorPage.waitForSelector('[data-login-form]');
    await operatorPage.locator('[data-login-form] input[name="token"]').fill(credential.architect_token);
    await operatorPage.locator('[data-login-form]').evaluate((form) => form.requestSubmit());
    await operatorPage.waitForSelector('.console-shell');
    await operatorPage.waitForFunction(() => document.querySelectorAll('.principal-table tbody tr').length > 0);
    const operationalDefault = await operatorPage.evaluate(() => ({
      filter: document.querySelector('[data-principal-filter][aria-selected="true"]')?.dataset.principalFilter || '',
      firstPrincipal: document.querySelector('.principal-table tbody tr')?.textContent || '',
      selectedPrincipal: document.querySelector('.principal-table tbody tr[aria-selected="true"]')?.textContent || '',
    }));
    const architectPrincipalId = await operatorPage.locator('.principal-table tbody tr', { hasText: 'human:ai_architect' }).getAttribute('data-principal-id');
    await operatorPage.locator('[data-view-target="effective-access"]').first().click();
    await operatorPage.locator('[data-effective-access-form] select[name="principal_id"]').selectOption(architectPrincipalId);
    await operatorPage.locator('[data-effective-access-form]').evaluate((form) => form.requestSubmit());
    await operatorPage.waitForSelector('.access-result');
    const effectiveAccess = await operatorPage.evaluate(() => ({
      permissions: [...document.querySelectorAll('.permission-list:not(.is-denied) code')].map((node) => node.textContent),
      denials: [...document.querySelectorAll('.permission-list.is-denied code')].map((node) => node.textContent),
    }));
    await operatorPage.locator('[data-view-target="overview"]').first().click();
    await operatorPage.waitForSelector('.overview-page');
    await operatorPage.screenshot({ path: path.join(outputDir, 'architect-authenticated-desktop-1440.png'), fullPage: true });
    const desktopState = await operatorPage.evaluate(() => ({
      title: document.title,
      h1: document.querySelector('h1')?.textContent.trim() || '',
      planeRows: document.querySelectorAll('.plane-table tbody tr').length,
      navigationItems: document.querySelectorAll('.console-sidebar [data-view-target]').length,
      scrollY: window.scrollY,
      h1Top: document.querySelector('h1')?.getBoundingClientRect().top || 0,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }));
    await operatorPage.setViewportSize({ width: 390, height: 844 });
    await operatorPage.locator('[data-toggle-nav]').click();
    await operatorPage.waitForFunction(() => document.querySelector('.console-sidebar')?.dataset.open === 'true');
    const mobileOpenState = await operatorPage.evaluate(() => ({
      navOpen: document.querySelector('.console-sidebar')?.dataset.open === 'true',
      backdropOpen: document.querySelector('[data-close-nav]')?.dataset.open === 'true',
      focusInsideNav: Boolean(document.querySelector('.console-sidebar')?.contains(document.activeElement)),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }));
    await operatorPage.screenshot({ path: path.join(outputDir, 'architect-authenticated-mobile-390.png'), fullPage: true });
    await operatorPage.keyboard.press('Escape');
    const mobileState = await operatorPage.evaluate(() => ({
      navOpen: document.querySelector('.console-sidebar')?.dataset.open === 'true',
      backdropOpen: document.querySelector('[data-close-nav]')?.dataset.open === 'true',
      focusReturned: document.activeElement === document.querySelector('[data-toggle-nav]'),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }));
    await operatorPage.locator('[data-logout]').click();
    await operatorPage.waitForSelector('[data-login-form]');
    operatorInteraction = {
      tested: true,
      loginStatus: loginResponse?.status() || 0,
      effectiveAccess,
      operationalDefault,
      desktopState,
      mobileOpenState,
      mobileState,
      signedOut: true,
      consoleErrors: operatorConsoleErrors,
      unexpectedConsoleErrors: operatorConsoleErrors.filter((message) => !message.includes('401 (Unauthorized)')),
      pageErrors: operatorPageErrors,
    };
    if (operatorInteraction.loginStatus !== 200) failures.push(`architect console returned HTTP ${operatorInteraction.loginStatus}`);
    if (!effectiveAccess.permissions.includes('candidate.create')) failures.push('architect effective access omitted candidate.create');
    if (!effectiveAccess.denials.includes('memory.canonical.write')) failures.push('architect effective access omitted canonical-write denial');
    const operationalText = `${operationalDefault.firstPrincipal} ${operationalDefault.selectedPrincipal}`;
    if (operationalDefault.filter !== 'operational'
        || /identity proof|integration agent|integration member|provisioning contract/i.test(operationalText)
        || !/personal memory agent/i.test(operationalDefault.firstPrincipal)
        || !/ai architect/i.test(operationalDefault.selectedPrincipal)) {
      failures.push('architect console did not default to the canonical operational principal set');
    }
    if (desktopState.h1 !== 'Overview' || !desktopState.planeRows || desktopState.navigationItems !== 9) failures.push('architect overview did not render the complete live identity state');
    if (desktopState.scrollY !== 0 || desktopState.h1Top < 58) failures.push('architect navigation focused content beneath the sticky topbar');
    if (desktopState.overflow || mobileOpenState.overflow || mobileState.overflow || !mobileOpenState.navOpen || !mobileOpenState.backdropOpen || !mobileOpenState.focusInsideNav || mobileState.navOpen || mobileState.backdropOpen || !mobileState.focusReturned) failures.push('architect console responsive navigation, dismissal, focus return, or overflow check failed');
    if (operatorInteraction.unexpectedConsoleErrors.length || operatorPageErrors.length) failures.push('architect console emitted browser errors');
    await operatorPage.close();
  }
} else if (requireOperator) {
  failures.push('operator QA was required but no credential file was configured');
}

await browser.close();

const report = {
  baseUrl,
  generatedAt: new Date().toISOString(),
  browser: `Playwright with system Chrome at ${executablePath}`,
  browserAvailability,
  checks,
  interaction: {
    initialJudgeState,
    filteredRows,
    negativeSearch,
    capabilityInteraction,
    copyState,
    projectorState,
    queryInteraction,
    provenanceInteraction,
    operatorInteraction,
  },
  failures,
  passed: failures.length === 0,
};

await fs.writeFile(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ passed: report.passed, checks: checks.length, failures }, null, 2));
if (!report.passed) process.exitCode = 1;
