import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const inputPath = path.resolve(process.argv[2]
  || 'artifacts/evaluation/personal-agent-runtime-proof-sanitized.json');
const outputPath = path.resolve(process.argv[3]
  || 'artifacts/submission/media/screenshots/employee-workflow/20-physical-agent-runtime-proof.png');

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function compact(value, size = 34) {
  const text = String(value || '');
  return text.length <= size ? text : `${text.slice(0, 16)}...${text.slice(-15)}`;
}

const proof = JSON.parse(await fs.readFile(inputPath, 'utf8'));
if (proof?.schema_version !== 1
    || proof?.proof_class !== 'physical_personal_memory_agent'
    || proof?.passed !== true
    || proof?.credential_disclosure !== false
    || !Array.isArray(proof?.boundary_checks)
    || proof.boundary_checks.length !== 7
    || proof.boundary_checks.some((check) => check?.passed !== true)
    || proof?.personal_context?.passed !== true
    || proof.personal_context.citation_count !== 1
    || !Array.isArray(proof.personal_context.citation_digests)
    || proof.personal_context.citation_digests.length !== 1) {
  throw new Error('personal_agent_runtime_proof_invalid');
}

const citation = proof.personal_context.citation_digests[0];
const checkLabels = {
  repository_read: 'Source repository',
  installed_application_read: 'Installed app source',
  application_environment_read: 'Application secrets',
  model_authentication_read: 'Model authentication',
  own_workspace_write: 'Own private workspace',
  outbound_ip_socket: 'IP network socket',
  direct_postgres_connect: 'Direct PostgreSQL',
};
const checkRows = proof.boundary_checks.map((check) => `
  <li>
    <span class="check-mark">OK</span>
    <span><strong>${escapeHtml(checkLabels[check.label] || check.label)}</strong><small>Expected ${escapeHtml(check.expected)}</small></span>
    <b class="is-${escapeHtml(check.actual)}">${escapeHtml(check.actual.toUpperCase())}</b>
  </li>
`).join('');

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <style>
    * { box-sizing: border-box; }
    html, body { width: 1440px; height: 1000px; margin: 0; overflow: hidden; }
    body { font-family: Arial, Helvetica, sans-serif; color: #16201f; background: #f7f9f8; }
    header { height: 190px; padding: 42px 64px 34px; background: #123d3d; color: #fff; display: flex; align-items: flex-end; justify-content: space-between; }
    header p { margin: 10px 0 0; color: #cbe1dc; font-size: 18px; }
    h1 { margin: 0; font-size: 42px; letter-spacing: 0; }
    .status { border: 1px solid #7fd6a5; color: #d8ffe6; padding: 12px 17px; border-radius: 4px; font-size: 16px; font-weight: 700; }
    .identity { min-height: 142px; padding: 28px 64px; background: #fff; border-bottom: 1px solid #cbd5d2; display: grid; grid-template-columns: 1fr 1fr 240px; gap: 36px; align-items: center; }
    .label { display: block; color: #64716e; font-size: 13px; text-transform: uppercase; font-weight: 700; margin-bottom: 8px; }
    .identity strong { font-size: 22px; }
    .identity time { font-size: 17px; font-weight: 700; }
    main { display: grid; grid-template-columns: 1fr 0.9fr; min-height: 668px; }
    .boundaries { padding: 34px 46px 34px 64px; background: #f7f9f8; border-right: 1px solid #cbd5d2; }
    .retrieval { padding: 34px 64px 34px 46px; background: #fff; }
    h2 { margin: 0 0 8px; font-size: 24px; }
    .section-copy { margin: 0 0 24px; color: #65726f; font-size: 15px; line-height: 1.45; }
    ul { list-style: none; margin: 0; padding: 0; border-top: 1px solid #cbd5d2; }
    li { min-height: 66px; display: grid; grid-template-columns: 40px 1fr 110px; gap: 14px; align-items: center; border-bottom: 1px solid #dbe2df; }
    li strong { display: block; font-size: 16px; }
    li small { display: block; margin-top: 5px; color: #6b7774; }
    li b { justify-self: end; font-size: 13px; color: #0a6945; }
    li b.is-denied { color: #9b4e14; }
    .check-mark { width: 30px; height: 30px; display: grid; place-items: center; border: 1px solid #1b8a62; border-radius: 50%; color: #0a6945; font-size: 11px; font-weight: 800; }
    .retrieval-band { margin-top: 24px; border-top: 3px solid #0b8b91; border-bottom: 1px solid #b9c9c6; padding: 22px 0; }
    .metric-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-bottom: 24px; }
    .metric { border-left: 3px solid #0b8b91; padding-left: 14px; }
    .metric b { display: block; font-size: 28px; margin-bottom: 5px; }
    .metric span { color: #66736f; font-size: 13px; }
    dl { margin: 0; }
    dl div { padding: 13px 0; border-bottom: 1px solid #dbe2df; }
    dt { color: #687572; font-size: 13px; margin-bottom: 6px; }
    dd { margin: 0; font-family: monospace; font-size: 14px; overflow-wrap: anywhere; }
    .contract { margin-top: 24px; padding: 17px 18px; background: #eaf5f3; border-left: 4px solid #0b8b91; line-height: 1.45; }
    footer { position: absolute; left: 64px; bottom: 24px; color: #66736f; font-size: 13px; }
  </style>
</head>
<body>
  <header>
    <div><h1>Physical Personal Memory Agent proof</h1><p>Executed by the dedicated systemd process through the governed broker.</p></div>
    <span class="status">PASSED</span>
  </header>
  <section class="identity">
    <div><span class="label">Employee</span><strong>${escapeHtml(proof.employee_display_name)}</strong></div>
    <div><span class="label">Distinct agent principal</span><strong>${escapeHtml(proof.agent_display_name)}</strong></div>
    <div><span class="label">Checked at</span><time>${escapeHtml(proof.checked_at.replace('T', ' ').replace('Z', ' UTC'))}</time></div>
  </section>
  <main>
    <section class="boundaries">
      <h2>Runtime isolation</h2>
      <p class="section-copy">These checks ran inside the actual systemd sandbox, not in the employee web preview.</p>
      <ul>${checkRows}</ul>
    </section>
    <section class="retrieval">
      <h2>Brokered personal-context retrieval</h2>
      <p class="section-copy">The agent has no direct database login. The broker returned only the explicitly shared current revision.</p>
      <div class="retrieval-band">
        <div class="metric-row">
          <div class="metric"><b>${escapeHtml(proof.personal_context.matched_count)}</b><span>matched source</span></div>
          <div class="metric"><b>${escapeHtml(proof.personal_context.citation_count)}</b><span>validated citation</span></div>
          <div class="metric"><b>v${escapeHtml(citation.revision)}</b><span>current revision</span></div>
        </div>
        <dl>
          <div><dt>Source type</dt><dd>${escapeHtml(citation.source_type)}</dd></div>
          <div><dt>Source ID</dt><dd>${escapeHtml(citation.source_id)}</dd></div>
          <div><dt>Content SHA-256</dt><dd>${escapeHtml(citation.content_sha256)}</dd></div>
          <div><dt>Audit receipt</dt><dd>${escapeHtml(proof.personal_context.audit_event_key)}</dd></div>
        </dl>
      </div>
      <p class="contract"><strong>Credential disclosure: none.</strong><br />Employee preview and physical execution remain separate evidence classes.</p>
    </section>
  </main>
  <footer>Capture ${escapeHtml(proof.capture_run_id)} | Sanitized runtime evidence | Organizational AI Memory</footer>
</body>
</html>`;

await fs.mkdir(path.dirname(outputPath), { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.OAM_CHROME_PATH || '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.screenshot({ path: outputPath, fullPage: false });
} finally {
  await browser.close();
}

console.log(JSON.stringify({ input: inputPath, output: outputPath }));
