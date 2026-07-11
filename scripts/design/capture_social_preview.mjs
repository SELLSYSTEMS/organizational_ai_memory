import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = (process.env.OAM_QA_BASE_URL || 'https://memory.sellsystems.agency').replace(/\/$/, '');
const outputPath = path.resolve(
  process.argv[2] || 'app/public/assets/og-organizational-ai-memory.png',
);
const executablePath = process.env.OAM_CHROME_PATH || '/usr/bin/google-chrome';

const browser = await chromium.launch({
  headless: true,
  executablePath,
  args: ['--no-sandbox'],
});
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('pageerror', (error) => errors.push(error.message));

const response = await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
if (!response?.ok()) throw new Error(`Home returned HTTP ${response?.status() || 0}`);
await page.waitForFunction(() => document.body.innerText.includes('Prepare a new website delivery handoff'));
await page.screenshot({ path: outputPath, fullPage: false });
await browser.close();

if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);
console.log(JSON.stringify({
  passed: true,
  base_url: baseUrl,
  output: outputPath,
  viewport: { width: 1200, height: 630 },
}, null, 2));
