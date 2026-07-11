const DEFAULT_QUERY = 'What is the current budget and deadline, and what changed?';
const EXAMPLE_QUERIES = [
  DEFAULT_QUERY,
  'Which tools and communication preferences are current?',
  'What delivery model, timezone, and location were recorded?',
];
const CANONICAL_TASK_KEY = 'website_delivery_handoff';

const TYPE_LABELS = {
  thread: 'Thread',
  turns: 'Turns',
  observations: 'Observations',
  facts: 'Facts',
  summary: 'Summary',
  reflection: 'Reflection',
};

const PAGE_LABELS = {
  assets: 'Assets',
  demo: 'Demo',
  method: 'Method',
  evidence: 'Evidence',
};

const ASSET_TYPE_LABELS = {
  prompt: 'Prompt',
  workflow: 'Workflow',
  agent: 'Agent',
  decision_pattern: 'Decision pattern',
  best_practice: 'Best practice',
};

const REVIEW_STATUS_LABELS = {
  approved: 'Approved',
  reviewed: 'Reviewed',
  draft: 'Draft',
};

const main = document.querySelector('#main-content');

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function compactId(value = '') {
  const text = String(value);
  if (text.length <= 22) return text;
  return `${text.slice(0, 11)}...${text.slice(-7)}`;
}

function formatDate(value, options = {}) {
  if (!value) return options.empty || 'Open';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en', {
    dateStyle: options.dateOnly ? 'medium' : 'medium',
    ...(options.dateOnly ? {} : { timeStyle: 'short' }),
    timeZone: 'UTC',
  }).format(date) + (options.dateOnly ? '' : ' UTC');
}

function formatConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 'Not scored';
  return `${Math.round(number * 100)}% confidence`;
}

function humanize(value = '') {
  return String(value).replaceAll('_', ' ');
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function extractItems(payload, keys = []) {
  if (Array.isArray(payload)) return payload;
  const root = payload?.data || payload || {};
  if (Array.isArray(root)) return root;
  if (Array.isArray(root.items)) return root.items;
  for (const key of keys) {
    if (Array.isArray(root[key])) return root[key];
  }
  return [];
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      accept: 'application/json',
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.error || `Request failed (${response.status})`);
  }
  return payload;
}

function normalizeFact(fact = {}) {
  const provenance = fact.provenance || fact.source_path || {};
  return {
    ...fact,
    id: fact.id || fact.fact_id || fact.source_record_id || fact.fact_key || '',
    key: fact.fact_key || fact.record_key || fact.id || '',
    predicate: fact.predicate || fact.payload?.predicate || 'fact',
    value: fact.value ?? fact.object_value ?? fact.payload?.object_value ?? fact.text_body ?? '',
    current: fact.current ?? fact.is_current ?? fact.status === 'current',
    status: fact.status || ((fact.current ?? fact.is_current) ? 'current' : 'superseded'),
    validFrom: fact.valid_from || fact.validFrom || fact.created_at || null,
    validTo: fact.valid_to || fact.validTo || null,
    confidence: fact.confidence ?? fact.payload?.confidence ?? null,
    provenance,
    observations: provenance.observations || fact.observations || [],
    sourceTurns: provenance.source_turns || fact.source_turns || [],
  };
}

function normalizeQueryPayload(payload = {}) {
  const root = payload.result || payload.data || payload;
  const result = root.retrieved_context
    ? {
        ...root.retrieved_context,
        answer: root.answer,
        status: root.status,
        retrieval: root.retrieval,
        scope: root.scope,
      }
    : root;
  const facts = (result.facts || result.current_facts || result.matches || []).map(normalizeFact);
  const observations = result.observations || result.supporting_observations || [];
  const summaries = result.summaries || (result.summary ? [result.summary] : []);
  const reflections = result.reflections || [];
  const mode = result.retrieval?.mode || result.retrieval?.strategy || result.retrieval_mode || 'postgres_exact_lexical';
  const semantic = result.retrieval?.semantic || result.semantic_retrieval || result.semantic || { status: 'unavailable' };
  return {
    ...result,
    facts,
    observations,
    summaries,
    reflections,
    answer: result.answer || result.retrieved_context || result.context || '',
    mode,
    semantic,
  };
}

function normalizeAsset(asset = {}) {
  const governance = asset.governance || {};
  const lineage = asset.lineage || {};
  const evidence = asset.evidence || {};
  return {
    ...asset,
    assetKey: asset.asset_key || asset.assetKey || asset.key || '',
    assetType: asset.asset_type || asset.assetType || asset.type || '',
    capabilityArea: asset.capability_area || asset.capabilityArea || '',
    problemSolved: asset.problem_solved || asset.problemSolved || '',
    whyItWorked: asset.why_it_worked || asset.whyItWorked || '',
    governance: {
      visibility: governance.visibility || asset.visibility || '',
      reviewStatus: governance.review_status || governance.reviewStatus || asset.review_status || '',
      version: governance.version || asset.version || '',
      ownerRole: governance.owner_role || governance.ownerRole || asset.owner_role || '',
      consumerRoles: asArray(governance.consumer_roles || governance.consumerRoles || asset.consumer_roles),
      lastValidatedAt: governance.last_validated_at || governance.lastValidatedAt || asset.last_validated_at || null,
      riskNote: governance.risk_note || governance.riskNote || asset.risk_note || '',
    },
    lineage: {
      supersedes: asArray(lineage.supersedes || asset.supersedes),
      supersededBy: asArray(lineage.superseded_by || lineage.supersededBy || asset.superseded_by),
    },
    usedSuccessfullyIn: asArray(asset.used_successfully_in || asset.usedSuccessfullyIn),
    sourceTurns: asArray(evidence.source_turns || asset.sourceTurns || asset.source_turns || asset.source_turn_ids),
    relatedAssets: asArray(evidence.related_assets || asset.relatedAssets || asset.related_assets || asset.linked_evidence_keys),
    content: {
      familyKey: asset.content?.asset_family_key || '',
      version: asset.content?.version || asset.version || '',
      schemaVersion: asset.content?.schema_version ?? null,
      contentType: asset.content?.content_type || '',
      changeSummary: asset.content?.change_summary || '',
      sha256: asset.content?.sha256 || '',
      body: asset.content?.body && typeof asset.content.body === 'object' ? asset.content.body : {},
    },
  };
}

function normalizeRecommendation(recommendation = {}) {
  const task = recommendation.task || {};
  const recommendedAssets = recommendation.recommended_assets || recommendation.recommendations || recommendation.assets || [];
  return {
    ...recommendation,
    taskKey: recommendation.task_key || task.task_key || task.key || '',
    taskTitle: recommendation.task_title || task.task_title || task.title || '',
    reason: recommendation.reason || task.reason || '',
    assetKeys: asArray(
      recommendation.recommended_asset_keys
      || recommendation.asset_keys
      || recommendedAssets.map((asset) => asset.asset_key || asset.key),
    ).filter(Boolean),
    assets: asArray(recommendedAssets).map(normalizeAsset),
  };
}

function normalizeAnalytics(payload = {}) {
  const root = payload.analytics || payload.data?.analytics || payload.data || payload;
  return {
    totalAssets: root.total_assets ?? root.asset_count ?? null,
    typeCounts: root.asset_counts_by_type || root.counts_by_type || [],
    reviewCounts: root.review_status_counts || root.counts_by_review_status || [],
    capabilityCounts: root.capability_area_counts || root.counts_by_capability_area || [],
    duplicatedPatterns: root.duplicated_patterns || root.duplication_signals || [],
    missingCapabilities: root.missing_capabilities || root.capability_gaps || [],
    computedGaps: root.computed_gaps || [],
    coverage: root.coverage || {},
    reuse: root.reuse || {},
    measurementBasis: root.measurement_basis || {},
  };
}

function pageIntro(title, description, scope = '') {
  return `
    <header class="page-intro">
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(description)}</p>
      ${scope ? `<div class="scope-line">${escapeHtml(scope)}</div>` : ''}
    </header>
  `;
}

function queryForm(id, { showExamples = true } = {}) {
  return `
    <form class="query-form" data-query-form data-result-target="${escapeHtml(id)}">
      <label class="field-label">
        Ask the public memory
        <textarea class="query-input" name="query" rows="1" maxlength="320" required>${escapeHtml(DEFAULT_QUERY)}</textarea>
      </label>
      <button class="button" type="submit">Retrieve memory</button>
    </form>
    ${showExamples ? `
      <ul class="example-queries" aria-label="Example queries">
        ${EXAMPLE_QUERIES.map((query) => `
          <li><button class="example-query" type="button" data-example-query="${escapeHtml(query)}">${escapeHtml(query)}</button></li>
        `).join('')}
      </ul>
    ` : ''}
    <div class="status-line" role="status" aria-live="polite" data-query-status></div>
    <div id="${escapeHtml(id)}" class="query-result-reserved" data-query-result>
      <div class="loading-state">Preparing the grounded public result...</div>
    </div>
  `;
}

function getFactObservations(fact) {
  const direct = fact.observations || [];
  if (direct.length) return direct;
  return fact.provenance?.observations || [];
}

function getObservationTurns(observation, fact) {
  const direct = observation?.source_turns || observation?.turns || [];
  if (direct.length) return direct;
  const fromFact = fact.sourceTurns || fact.provenance?.source_turns || [];
  return fromFact;
}

function renderSourcePath(fact, index) {
  const observation = getFactObservations(fact)[0] || {};
  const sourceTurn = getObservationTurns(observation, fact)[0] || {};
  const observationText = observation.observation_text || observation.text || observation.text_body || 'Structured observation supporting this fact.';
  const sourceText = sourceTurn.text_raw || sourceTurn.excerpt || sourceTurn.text || 'Source turn retained in the canonical thread.';
  const observationId = observation.id || observation.observation_id || observation.observation_key || '';
  const turnId = sourceTurn.id || sourceTurn.turn_id || sourceTurn.source_turn_id || '';

  return `
    <details class="source-details" ${index === 0 ? 'open' : ''}>
      <summary>Inspect fact to observation to source turn</summary>
      <div class="source-path">
        <section class="source-step">
          <h4>Fact</h4>
          <p><span class="predicate">${escapeHtml(fact.predicate)}</span><br />${escapeHtml(fact.value)}</p>
          <span class="object-id" title="${escapeHtml(fact.id)}">${escapeHtml(compactId(fact.key || fact.id))}</span>
        </section>
        <section class="source-step observation">
          <h4>Observation</h4>
          <p>${escapeHtml(observationText)}</p>
          <span class="object-id" title="${escapeHtml(observationId)}">${escapeHtml(compactId(observationId))}</span>
        </section>
        <section class="source-step turn">
          <h4>Source turn</h4>
          <blockquote>${escapeHtml(sourceText)}</blockquote>
          <span class="object-id" title="${escapeHtml(turnId)}">${escapeHtml(compactId(turnId))}</span>
        </section>
      </div>
    </details>
  `;
}

function renderFactRow(fact, index) {
  const current = fact.status === 'current' || fact.current;
  const state = current ? 'current' : 'superseded';
  const source = getObservationTurns(getFactObservations(fact)[0], fact)[0] || {};
  const sourceId = source.source_turn_id || source.turn_id || source.id || 'Source retained';
  const prettyPredicate = fact.predicate.replaceAll('_', ' ');

  return `
    <div class="memory-row" data-state="${state}">
      <div class="memory-cell">
        <span class="memory-label">${escapeHtml(prettyPredicate)}</span>
        <span class="object-id" title="${escapeHtml(fact.id)}">${escapeHtml(compactId(fact.key || fact.id))}</span>
      </div>
      <div class="memory-cell">
        <span class="status-label ${current ? 'is-current' : 'is-superseded'}">${current ? 'Current fact' : 'Superseded'}</span>
        <span class="timestamp">${current ? `Since ${escapeHtml(formatDate(fact.validFrom, { dateOnly: true }))}` : `Until ${escapeHtml(formatDate(fact.validTo, { dateOnly: true }))}`}</span>
      </div>
      <div class="memory-cell">
        <span class="memory-value">${escapeHtml(fact.value)}</span>
        <span class="timestamp">${escapeHtml(formatConfidence(fact.confidence))}</span>
      </div>
      <div class="memory-cell">
        <span class="memory-label">Fact -> observation -> source turn</span>
        <span class="source-ref" title="${escapeHtml(sourceId)}">${escapeHtml(compactId(sourceId))}</span>
      </div>
    </div>
    ${renderSourcePath(fact, index)}
  `;
}

function renderQueryResult(payload, { compact = false } = {}) {
  const result = normalizeQueryPayload(payload);
  if (!result.facts.length && !result.observations.length && !result.answer) {
    return `
      <section class="empty-state">
        <h3>No supporting memory found</h3>
        <p>The public corpus did not contain enough evidence for this query. No result was fabricated.</p>
      </section>
    `;
  }

  const answer = result.answer || result.facts
    .filter((fact) => fact.current || fact.status === 'current')
    .map((fact) => `${fact.predicate.replaceAll('_', ' ')}: ${fact.value}`)
    .join('; ');
  const facts = compact ? result.facts.slice(0, 4) : result.facts;
  const exactCount = result.retrieval?.fact_count ?? result.facts.length;
  const keywordCount = result.retrieval?.keyword_hit_count ?? result.observations.length;

  return `
    <section class="result-shell" aria-label="Retrieved memory">
      <div class="result-heading">
        <h3>Retrieved context</h3>
        <span class="retrieval-mode">${escapeHtml(result.mode)}</span>
      </div>
      ${answer ? `<p class="answer-summary">${escapeHtml(answer)}</p>` : ''}
      <div class="memory-ledger">
        ${facts.map((fact, index) => renderFactRow(fact, index)).join('')}
      </div>
      ${compact ? '<a class="button-secondary full-result-link" href="/demo">Open the full result</a>' : `
        <details class="assembly-details">
          <summary>How this result was assembled</summary>
          <div class="assembly-grid">
            <div class="assembly-item"><strong>Exact facts</strong><span>${escapeHtml(String(exactCount))} time-valid record${exactCount === 1 ? '' : 's'} selected from Postgres.</span></div>
            <div class="assembly-item"><strong>Lexical evidence</strong><span>${escapeHtml(String(keywordCount))} supporting observation${keywordCount === 1 ? '' : 's'} matched to the query.</span></div>
            <div class="assembly-item"><strong>Semantic lane</strong><span>${result.semantic?.status === 'available' ? 'Available as derived acceleration.' : 'Unavailable; not required for this deterministic result.'}</span></div>
          </div>
        </details>
      `}
    </section>
  `;
}

function homePage() {
  return `
    <section class="page-shell home-shell">
      <div class="home-intro">
        <h1>Organizational AI Memory</h1>
        <p>A provenance-first capability layer that turns proven prompts, workflows, agent patterns, decisions, and practices into governed organizational memory. Start a task, get reusable prior work, and inspect the evidence behind it.</p>
        <div class="home-actions">
          <a class="button" href="/demo">Start with prior work</a>
          <a class="button-secondary" href="/assets">Browse capability assets</a>
        </div>
      </div>
    </section>
    <section class="proof-band" aria-labelledby="home-proof-title">
      <div class="proof-band-inner">
        <div class="section-head">
          <div>
            <h2 id="home-proof-title">Start with proven prior work</h2>
            <p>A stored task mapping selects governed capability assets before any generated adaptation.</p>
          </div>
          <span class="record-label">Deterministic record</span>
        </div>
        <div class="home-capability-proof" data-home-capability-proof>
          <div class="loading-state">Loading the public-safe capability record...</div>
        </div>
      </div>
    </section>
    <section class="page-shell section-block" aria-labelledby="objects-title">
      <div class="section-head">
        <div>
          <h2 id="objects-title">Capability assets have different jobs</h2>
          <p>Reusable work stays typed, governed, and linked to the evidence that established it.</p>
        </div>
        <a href="/assets">Inspect the asset ledger</a>
      </div>
      <div class="object-ledger">
        <div class="object-ledger-row"><strong>Prompt</strong><span>A reusable instruction for a bounded piece of work.</span><span>shape the task</span></div>
        <div class="object-ledger-row"><strong>Workflow</strong><span>An ordered operating sequence proven in prior delivery.</span><span>coordinate the work</span></div>
        <div class="object-ledger-row"><strong>Agent</strong><span>A governed automation role with an explicit operating boundary.</span><span>execute repeatedly</span></div>
        <div class="object-ledger-row"><strong>Decision pattern</strong><span>A reusable choice supported by observed outcomes.</span><span>guide judgment</span></div>
        <div class="object-ledger-row"><strong>Best practice</strong><span>A reviewed constraint that protects quality or safety.</span><span>govern reuse</span></div>
      </div>
    </section>
    <section class="page-shell section-block" aria-labelledby="temporal-title">
      <div class="section-head">
        <div>
          <h2 id="temporal-title">Current truth without erased history</h2>
          <p>When a value changes, the prior fact closes its validity window and remains available for audit.</p>
        </div>
        <a href="/method">See the method</a>
      </div>
      <div class="timeline" data-home-timeline>
        <div class="loading-state">Loading the live temporal record...</div>
      </div>
    </section>
    ${safetyBand()}
    ${closingBand('Begin with organizational capability', 'Choose a real task, retrieve the stored starting point, and keep its evidence visible through adaptation.')}
  `;
}

function demoPage() {
  return `
    <div class="judge-demo">
      <header class="judge-topbar">
        <a class="judge-menu" href="/" aria-label="Return to product home" title="Product home">
          <span></span><span></span><span></span>
        </a>
        <a class="judge-brand" href="/">Organizational AI Memory</a>
        <label class="judge-global-search">
          <span aria-hidden="true"></span>
          <input type="search" value="Prepare a website delivery handoff" aria-label="Search memory" data-judge-global-search />
          <kbd>⌘ K</kbd>
        </label>
        <a class="judge-help" href="/method" aria-label="Open method and architecture" title="Method and architecture">?</a>
        <div class="judge-session" aria-label="Current public session">
          <span class="judge-avatar" aria-hidden="true">PJ</span>
          <span><strong>Public judge</strong><small>Public-safe session</small></span>
        </div>
      </header>

      <section class="judge-lifecycle" aria-label="Governed capability lifecycle">
        <div class="lifecycle-step is-complete"><span class="lifecycle-icon">1</span><span><strong>Capture</strong><small>Synthetic evidence retained</small></span></div>
        <span class="lifecycle-connector" aria-hidden="true"></span>
        <div class="lifecycle-step is-complete"><span class="lifecycle-icon">2</span><span><strong>Review</strong><small>Governance recorded</small></span></div>
        <span class="lifecycle-connector is-dotted" aria-hidden="true"></span>
        <div class="lifecycle-step is-current"><span class="lifecycle-icon">✓</span><span><strong>Reuse</strong><small>Public-safe capability</small></span></div>
        <div class="lifecycle-policy"><strong>Content is governed.</strong><span>Only approved content is reusable.</span><a href="/method">Learn more</a></div>
      </section>

      <div class="judge-workspace">
        <main class="judge-main">
          <section class="judge-section judge-search-section" aria-labelledby="judge-search-title">
            <div class="judge-section-title"><h1 id="judge-search-title">1. Grounded capability search</h1><a href="/method" aria-label="About deterministic search">i</a></div>
            <form class="judge-search-form" data-capability-search-form>
              <label class="judge-query-field">
                <span class="judge-search-glyph" aria-hidden="true"></span>
                <input name="query" type="search" value="Prepare a website delivery handoff" maxlength="320" autocomplete="off" required aria-label="Capability search query" />
                <button type="reset" class="judge-clear-query" aria-label="Clear query" title="Clear query">×</button>
              </label>
              <button class="judge-primary-button" type="submit">Search</button>
            </form>
            <div class="judge-filter-row">
              <label>Consumer role<select name="consumer_role" form="judge-filter-proxy" data-judge-role><option value="">Any governed role</option><option value="developer">Developer</option><option value="designer">Designer</option><option value="operator">Operator</option><option value="reviewer">Reviewer</option></select></label>
              <label>Capability type<select data-judge-type-filter><option value="">All types</option><option value="prompt">Prompt</option><option value="workflow">Workflow</option><option value="agent">Agent</option><option value="decision_pattern">Decision pattern</option><option value="best_practice">Best practice</option></select></label>
              <button type="button" class="judge-text-button" data-judge-clear-filters>Clear all</button>
            </div>
            <form id="judge-filter-proxy" hidden></form>
            <div class="judge-search-meta" role="status" aria-live="polite" data-judge-search-status>Loading the deterministic capability index…</div>
            <div class="judge-search-results" data-judge-search-results>
              <div class="judge-loading">Reading approved capability records…</div>
            </div>
          </section>

          <section class="judge-section judge-plan-section" aria-labelledby="judge-plan-title">
            <div class="judge-plan-heading">
              <div class="judge-section-title"><h2 id="judge-plan-title">2. Adapted plan</h2><span data-plan-mode>(grounded starting point)</span></div>
              <label class="judge-toggle"><input type="checkbox" checked data-citation-toggle /><span aria-hidden="true"></span>Source citations</label>
            </div>
            <form class="judge-adapt-form" data-assist-form>
              <label><span class="sr-only">Adaptation request</span><input name="request" value="Adapt this starting point for a small delivery team." maxlength="500" required /></label>
              <button class="judge-secondary-button" type="submit" disabled data-assist-submit>Adapt plan</button>
            </form>
            <div class="judge-plan-status" role="status" aria-live="polite" data-assist-status></div>
            <div class="judge-plan-result" data-assist-result>
              <div class="judge-loading">Preparing the authoritative starting point…</div>
            </div>
          </section>

          <details class="judge-more-evidence">
            <summary>Additional evidence and related capabilities</summary>
            <p>Open any result row to inspect its full governance, lineage, and source-turn evidence.</p>
          </details>
        </main>

        <aside class="judge-proof-rail" aria-label="Live proof rail">
          <section class="judge-rail-section" aria-labelledby="judge-analytics-title">
            <div class="judge-section-title"><h2 id="judge-analytics-title">3. Reuse analytics</h2><a href="/assets" aria-label="Open capability inventory">i</a></div>
            <div data-judge-analytics><div class="judge-loading">Loading live inventory…</div></div>
          </section>
          <section class="judge-rail-section" aria-labelledby="judge-access-title">
            <div class="judge-rail-heading">
              <div class="judge-section-title"><h2 id="judge-access-title">4. Governed access proof</h2><a href="/evidence" aria-label="Open evidence ledger">i</a></div>
              <button type="button" class="judge-icon-button" data-rerun-access-proof aria-label="Rerun access proofs" title="Rerun live proofs">↻</button>
            </div>
            <div class="judge-access-proofs" data-access-proofs><div class="judge-loading">Loading four-plane enforcement evidence…</div></div>
          </section>
        </aside>
      </div>
    </div>
  `;
}

function assetsPage() {
  return `
    <div class="page-shell assets-page">
      ${pageIntro(
        'Reusable capability assets',
        'Browse the prompts, workflows, agent patterns, decisions, and practices retained as governed organizational memory.',
        'Public-safe source pack',
      )}
      <section class="capability-analytics" aria-labelledby="capability-analytics-title">
        <div class="workspace-heading">
          <div><h2 id="capability-analytics-title">Capability inventory</h2><p>Counts are derived from the current public-safe asset records.</p></div>
        </div>
        <div data-capability-analytics><div class="loading-state">Loading capability counts...</div></div>
      </section>
      <form class="asset-filters" data-asset-filters aria-label="Filter capability assets">
        <label class="field-label">Type<select name="type"><option value="">All types</option></select></label>
        <label class="field-label">Capability area<select name="capability_area"><option value="">All capability areas</option></select></label>
        <label class="field-label">Review status<select name="review_status"><option value="">All review statuses</option></select></label>
        <button class="button-secondary" type="reset">Reset filters</button>
      </form>
      <div class="status-line" role="status" aria-live="polite" data-assets-status>Loading governed assets...</div>
      <div class="assets-workspace" data-assets-workspace>
        <section class="asset-ledger" aria-live="polite"><div class="loading-state">Loading the capability ledger...</div></section>
        <aside class="asset-inspector" aria-label="Selected capability asset"><div class="loading-state">Waiting for a selected asset...</div></aside>
      </div>
    </div>
  `;
}

function methodPage() {
  const stages = [
    ['Source evidence', '<ul class="method-object-list"><li>Thread</li><li>Turn</li><li>Observation</li></ul>', 'Work begins with ordered source turns and append-first observations.'],
    ['Memory formation', '<ul class="method-object-list"><li>Fact</li><li>Summary</li><li>Reflection</li></ul>', 'Typed memory objects preserve what is true, what matters, and what the record implies.'],
    ['Canonical store', '<div class="store-symbol">Postgres<br />source of truth</div>', 'Transactions, validity intervals, and source references remain inspectable.'],
    ['Capability asset', '<ul class="method-object-list"><li>Prompt</li><li>Workflow</li><li>Agent</li><li>Decision</li></ul>', 'Proven work becomes a versioned asset with owner, roles, review state, and evidence.'],
    ['Recommendation', '<div class="optional-lane">Website delivery handoff<br /><br />Prompt + workflow + decision<br />deterministic</div>', 'The canonical demo task selects a governed starting point before any generated prose is requested.'],
    ['Bounded adaptation', '<ul class="method-object-list"><li>Stored record</li><li>Optional Spark prose</li><li>Source path</li></ul>', 'Generated adaptation stays non-authoritative and the deterministic record remains visible.'],
  ];

  return `
    <div class="page-shell">
      ${pageIntro(
        'How capability memory is formed and reused',
        'Evidence becomes durable, time-aware memory; proven work becomes governed capability; task mappings retrieve a deterministic starting point before optional adaptation.',
      )}
      <ol class="method-flow" aria-label="Memory formation sequence">
        ${stages.map(([title, visual, description]) => `
          <li class="method-stage">
            <h2>${title}</h2>
            ${visual}
            <p>${description}</p>
          </li>
        `).join('')}
      </ol>
      <section class="method-example" aria-labelledby="method-example-title" data-canonical-demo>
        <div class="method-example-heading">
          <div>
            <h2 id="method-example-title">Canonical reuse example</h2>
            <p>The website delivery task retrieves three stored capability assets before optional adaptation.</p>
          </div>
          <a class="text-link" href="/demo?task=website_delivery_handoff">Run this task</a>
        </div>
        <div class="method-example-path">
          <strong>website_delivery_handoff</strong>
          <span aria-hidden="true">-&gt;</span>
          <div>
            <a href="/assets?asset=prompt%3Awebsite_handoff_brief_v1">prompt:website_handoff_brief_v1</a>
            <span>workflow:portfolio_site_delivery_v1</span>
            <span>decision:source_first_before_generation_v1</span>
          </div>
          <span aria-hidden="true">-&gt;</span>
          <strong>asset -&gt; observation -&gt; source turn</strong>
        </div>
      </section>
      <div class="method-detail-grid">
        <section class="method-detail">
          <h2>Objects and authority</h2>
          <dl class="definition-list">
            <div class="definition-row"><dt>Thread</dt><dd>Groups related source turns into one traceable context.</dd></div>
            <div class="definition-row"><dt>Observation</dt><dd>Records a signal from the work and points back to the turn.</dd></div>
            <div class="definition-row"><dt>Fact</dt><dd>Stores an atomic claim with confidence and a valid-time interval.</dd></div>
            <div class="definition-row"><dt>Capability asset</dt><dd>Retains proven work with lifecycle, role, lineage, and evidence metadata.</dd></div>
            <div class="definition-row"><dt>Recommendation</dt><dd>Maps a known task to stored assets through an authoritative deterministic record.</dd></div>
            <div class="definition-row"><dt>Spark adaptation</dt><dd>Produces optional non-authoritative prose from the selected public-safe record.</dd></div>
          </dl>
        </section>
        <section class="method-detail">
          <h2>Temporal truth in practice</h2>
          <div class="timeline">
            <div class="timeline-time">2026-06-18</div><div class="timeline-rail"></div><div class="timeline-entry"><strong>4500 USD per month</strong><span>Current budget</span></div>
            <div class="timeline-row superseded timeline-time">2026-06-02</div><div class="timeline-row superseded timeline-rail"></div><div class="timeline-row superseded timeline-entry"><strong>3000 USD per month</strong><span>Superseded, still auditable</span></div>
          </div>
        </section>
      </div>
    </div>
    ${safetyBand()}
    ${closingBand('Evidence remains part of reuse', 'Open a capability asset to inspect its governance and follow Asset -> observation -> source turn.', 'Inspect capability assets', '/assets')}
  `;
}

function safetyBand() {
  return `
    <section class="safety-band" aria-labelledby="safety-title">
      <div class="safety-band-inner">
        <h2 class="safety-title" id="safety-title">Safety boundary</h2>
        <div class="safety-scope"><strong>public_demo + public_safe</strong><span>The public API is pinned to one reviewed synthetic corpus.</span></div>
        <div class="safety-scope"><strong>internal_demo + isolated</strong><span>The richer regression corpus has a separate tenant and is not publicly routed.</span></div>
      </div>
    </section>
  `;
}

function closingBand(title, description, label = 'Run the public demo', href = '/demo') {
  return `
    <section class="closing-band">
      <div class="closing-band-inner">
        <div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div>
        <a class="button" href="${escapeHtml(href)}">${escapeHtml(label)}</a>
      </div>
    </section>
  `;
}

function evidencePage() {
  return `
    <div class="page-shell">
      ${pageIntro(
        'Inspect the memory behind the result',
        'Every retrieved claim can be traced to the memory object and source turn that support it.',
        'Public demo only',
      )}
      <div class="evidence-toolbar">
        <strong>Corpus inventory</strong>
        <span class="inventory-line" data-corpus-inventory>Loading runtime counts...</span>
      </div>
      <div class="evidence-tabs" role="tablist" aria-label="Memory object types">
        ${Object.entries(TYPE_LABELS).map(([type, label]) => `
          <button class="evidence-tab" type="button" role="tab" aria-selected="${type === 'facts'}" data-evidence-type="${type}">${label}</button>
        `).join('')}
      </div>
      <div class="evidence-workspace" data-evidence-workspace>
        <section class="evidence-list" aria-live="polite"><div class="loading-state">Loading public memory objects...</div></section>
        <aside class="provenance-panel" aria-label="Selected object provenance"><div class="loading-state">Select an object to inspect its source path.</div></aside>
      </div>
    </div>
  `;
}

function renderTimelineFromFacts(facts) {
  const temporal = facts
    .filter((fact) => ['budget', 'desired_deadline'].includes(fact.predicate))
    .sort((a, b) => Number(Boolean(b.current)) - Number(Boolean(a.current)) || new Date(b.validFrom) - new Date(a.validFrom));
  if (!temporal.length) return '<div class="empty-state">No temporal facts returned.</div>';
  return temporal.map((fact) => {
    const current = fact.current || fact.status === 'current';
    return `
      <div class="timeline-time ${current ? '' : 'timeline-row superseded'}">${escapeHtml(formatDate(fact.validFrom, { dateOnly: true }))}</div>
      <div class="timeline-rail ${current ? '' : 'timeline-row superseded'}"></div>
      <div class="timeline-entry ${current ? '' : 'timeline-row superseded'}"><strong>${escapeHtml(fact.value)}</strong><span>${current ? `Current ${escapeHtml(fact.predicate.replaceAll('_', ' '))}` : 'Superseded, still auditable'}</span></div>
    `;
  }).join('');
}

function extractEvidenceItems(payload, type) {
  const data = payload.data || payload;
  const singular = type.endsWith('s') ? type.slice(0, -1) : type;
  const raw = data.items || data[type] || data[singular] || [];
  return type === 'facts' ? raw.map(normalizeFact) : raw;
}

function selectedItemId(item, type) {
  return item.id || item[`${type.replace(/s$/, '')}_id`] || item[`${type.replace(/s$/, '')}_key`] || item.source_turn_id || item.record_key || '';
}

function renderEvidenceList(items, type, selectedId) {
  if (!items.length) {
    return `<div class="empty-state"><h2>${escapeHtml(TYPE_LABELS[type])}</h2><p>No ${escapeHtml(type)} are present in this public corpus.</p></div>`;
  }

  if (type === 'facts') {
    const rows = items.map((fact) => {
      const id = selectedItemId(fact, type);
      const current = fact.current || fact.status === 'current';
      return `
        <tr tabindex="0" role="button" aria-selected="${id === selectedId}" data-evidence-id="${escapeHtml(id)}">
          <td class="predicate">${escapeHtml(fact.predicate)}</td>
          <td>${escapeHtml(fact.value)}</td>
          <td><span class="${current ? 'is-current' : 'is-superseded'} status-label">${current ? 'Current' : 'Superseded'}</span></td>
          <td class="timestamp">${escapeHtml(formatDate(fact.validFrom, { dateOnly: true }))}</td>
          <td>${escapeHtml(formatConfidence(fact.confidence))}</td>
          <td class="source-ref">${escapeHtml(compactId(getObservationTurns(getFactObservations(fact)[0], fact)[0]?.source_turn_id || 'source'))}</td>
        </tr>
      `;
    }).join('');
    const records = items.map((fact) => {
      const id = selectedItemId(fact, type);
      const current = fact.current || fact.status === 'current';
      return `
        <button class="evidence-record" type="button" aria-selected="${id === selectedId}" data-evidence-id="${escapeHtml(id)}">
          <strong>${escapeHtml(fact.predicate.replaceAll('_', ' '))}: ${escapeHtml(fact.value)}</strong>
          <span>${current ? 'Current' : 'Superseded'} | ${escapeHtml(formatDate(fact.validFrom, { dateOnly: true }))} | ${escapeHtml(formatConfidence(fact.confidence))}</span>
        </button>
      `;
    }).join('');
    return `
      <h2>Facts ledger <span class="timestamp">${items.length} stored facts</span></h2>
      <table class="evidence-table">
        <thead><tr><th>Predicate</th><th>Value</th><th>Status</th><th>Valid from</th><th>Confidence</th><th>Source</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="evidence-records">${records}</div>
    `;
  }

  return `
    <h2>${escapeHtml(TYPE_LABELS[type])} ledger <span class="timestamp">${items.length} stored object${items.length === 1 ? '' : 's'}</span></h2>
    <div class="evidence-records always-visible">
      ${items.map((item) => {
        const id = selectedItemId(item, type);
        const title = item.observation_kind || item.actor_role || item.summary_scope || item.reflection_scope || item.title || item.thread_key || TYPE_LABELS[type];
        const value = item.observation_text || item.text_raw || item.summary_text || item.reflection_text || item.text || item.thread_key || '';
        return `
          <button class="evidence-record" type="button" aria-selected="${id === selectedId}" data-evidence-id="${escapeHtml(id)}">
            <strong>${escapeHtml(title)}</strong><span>${escapeHtml(value)}</span>
          </button>
        `;
      }).join('')}
    </div>
  `;
}

function renderProvenancePanel(item, type) {
  if (!item) return '<div class="empty-state">Select an object to inspect its source path.</div>';
  if (type === 'facts') {
    const fact = normalizeFact(item);
    const observation = getFactObservations(fact)[0] || {};
    const turn = getObservationTurns(observation, fact)[0] || {};
    const current = fact.current || fact.status === 'current';
    return `
      <div class="provenance-panel-header"><h2>Provenance path</h2><span class="scope-line">${current ? 'Current' : 'Superseded'}</span></div>
      <div class="provenance-chain">
        <section class="provenance-node">
          <h3>Fact</h3>
          <dl><dt>Predicate</dt><dd>${escapeHtml(fact.predicate)}</dd><dt>Value</dt><dd>${escapeHtml(fact.value)}</dd><dt>Valid from</dt><dd>${escapeHtml(formatDate(fact.validFrom))}</dd><dt>Valid to</dt><dd>${escapeHtml(formatDate(fact.validTo))}</dd><dt>Confidence</dt><dd>${escapeHtml(formatConfidence(fact.confidence))}</dd><dt>Fact ID</dt><dd class="mono">${escapeHtml(fact.id)}</dd></dl>
        </section>
        <section class="provenance-node observation">
          <h3>Observation</h3>
          <dl><dt>Kind</dt><dd>${escapeHtml(observation.observation_kind || observation.kind || 'structured observation')}</dd><dt>Observed</dt><dd>${escapeHtml(formatDate(observation.observed_at || observation.created_at))}</dd><dt>Object ID</dt><dd class="mono">${escapeHtml(observation.id || observation.observation_id || observation.observation_key || '')}</dd></dl>
        </section>
        <section class="provenance-node turn">
          <h3>Source turn</h3>
          <dl><dt>Actor</dt><dd>${escapeHtml(turn.actor_role || 'source participant')}</dd><dt>Timestamp</dt><dd>${escapeHtml(formatDate(turn.sent_at || turn.created_at))}</dd><dt>Turn ID</dt><dd class="mono">${escapeHtml(turn.source_turn_id || turn.id || '')}</dd></dl>
          <blockquote class="source-excerpt">${escapeHtml(turn.text_raw || turn.excerpt || turn.text || 'Source turn retained in the canonical thread.')}</blockquote>
        </section>
      </div>
    `;
  }

  const id = selectedItemId(item, type);
  const entries = Object.entries(item)
    .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value) && value !== '')
    .slice(0, 10);
  return `
    <div class="provenance-panel-header"><h2>${escapeHtml(TYPE_LABELS[type])} detail</h2></div>
    <div class="provenance-chain">
      <section class="provenance-node"><h3>Stored object</h3><dl>${entries.map(([key, value]) => `<dt>${escapeHtml(key.replaceAll('_', ' '))}</dt><dd>${escapeHtml(value)}</dd>`).join('')}<dt>Object ID</dt><dd class="mono">${escapeHtml(id)}</dd></dl></section>
    </div>
  `;
}

const assetCache = new Map();
let allAssetsPromise = null;
let recommendationIndexPromise = null;
let assetState = { allItems: [], items: [], selectedKey: '' };
let recommendationState = { items: [], current: null };
let recommendationRequestId = 0;

function cacheAssets(items = []) {
  return items.map(normalizeAsset).filter((asset) => {
    if (!asset.assetKey) return false;
    assetCache.set(asset.assetKey, asset);
    return true;
  });
}

async function loadAllAssets() {
  if (!allAssetsPromise) {
    allAssetsPromise = fetchJson('/api/public/assets')
      .then((payload) => cacheAssets(extractItems(payload, ['assets'])))
      .catch((error) => {
        allAssetsPromise = null;
        throw error;
      });
  }
  return allAssetsPromise;
}

async function loadRecommendationIndex() {
  if (!recommendationIndexPromise) {
    recommendationIndexPromise = fetchJson('/api/public/recommendations')
      .then((payload) => extractItems(payload, ['tasks', 'recommendations']).map(normalizeRecommendation))
      .catch((error) => {
        recommendationIndexPromise = null;
        throw error;
      });
  }
  return recommendationIndexPromise;
}

async function loadAssetDetail(assetKey) {
  const cached = assetCache.get(assetKey);
  if (cached?.problemSolved || cached?.whyItWorked || cached?.sourceTurns?.length) return cached;
  const payload = await fetchJson(`/api/public/assets/${encodeURIComponent(assetKey)}`);
  const root = payload?.data || payload || {};
  const asset = normalizeAsset(root.asset || root.item || root);
  if (asset.assetKey) assetCache.set(asset.assetKey, asset);
  return asset;
}

async function hydrateRecommendation(recommendation) {
  const normalized = normalizeRecommendation(recommendation);
  normalized.assets.forEach((asset) => {
    if (asset.assetKey) assetCache.set(asset.assetKey, asset);
  });
  const direct = new Map(normalized.assets.map((asset) => [asset.assetKey, asset]));
  normalized.assets = await Promise.all(normalized.assetKeys.map(async (assetKey) => {
    if (direct.has(assetKey)) return direct.get(assetKey);
    if (assetCache.has(assetKey)) return assetCache.get(assetKey);
    try {
      return await loadAssetDetail(assetKey);
    } catch {
      return normalizeAsset({ asset_key: assetKey, title: humanize(assetKey.split(':').pop()) });
    }
  }));
  return normalized;
}

function assetHref(assetKey) {
  return `/assets?asset=${encodeURIComponent(assetKey)}`;
}

function reviewStatusMarkup(status) {
  const normalized = String(status || 'not_provided').toLowerCase();
  const label = REVIEW_STATUS_LABELS[normalized] || humanize(normalized);
  return `<span class="asset-review asset-review-${escapeHtml(normalized)}">${escapeHtml(label)}</span>`;
}

function renderRecommendationRecord(recommendation, { compact = false } = {}) {
  const assetRows = recommendation.assets.map((asset, index) => {
    const key = asset.assetKey || recommendation.assetKeys[index] || '';
    const type = ASSET_TYPE_LABELS[asset.assetType] || humanize(asset.assetType || key.split(':')[0]);
    return `
      <a class="recommended-asset-row" href="${escapeHtml(assetHref(key))}">
        <span class="asset-type asset-type-${escapeHtml(asset.assetType || 'unknown')}">${escapeHtml(type)}</span>
        <span class="recommended-asset-copy">
          <strong>${escapeHtml(asset.title || humanize(key))}</strong>
          ${compact ? '' : `
            <span>${escapeHtml(asset.summary || key)}</span>
            <span class="recommended-asset-why"><b>Why it worked:</b> ${escapeHtml(asset.whyItWorked || 'Not provided')}</span>
            <span class="recommended-asset-evidence">Inspect governance and source evidence</span>
          `}
        </span>
        <span class="recommended-asset-meta">
          ${reviewStatusMarkup(asset.governance.reviewStatus)}
          <span class="asset-version">${asset.governance.version ? `v${escapeHtml(asset.governance.version)}` : 'Version not provided'}</span>
        </span>
      </a>
    `;
  }).join('');

  return `
    <article class="recommendation-record">
      <div class="recommendation-heading">
        <div><span class="record-label">Deterministic record</span><h3>${escapeHtml(recommendation.taskTitle || humanize(recommendation.taskKey))}</h3></div>
        <span class="object-id">${escapeHtml(recommendation.taskKey)}</span>
      </div>
      <p class="recommendation-reason">${escapeHtml(recommendation.reason)}</p>
      <div class="recommended-assets" aria-label="Recommended capability assets">${assetRows}</div>
      ${compact ? `<a class="text-link" href="/demo?task=${encodeURIComponent(recommendation.taskKey)}">Open this task in the demo</a>` : ''}
    </article>
  `;
}

const judgeState = {
  searchPayload: null,
  assets: [],
  currentPlan: null,
  currentPlanOptions: { mode: 'authoritative', model: '' },
};

function citationCode(asset, index) {
  const prefix = {
    prompt: 'P',
    workflow: 'W',
    agent: 'A',
    decision_pattern: 'D',
    best_practice: 'B',
  }[asset.assetType] || 'C';
  return `${prefix}${index + 1}`;
}

function judgeRecommendationFromSearch(payload = {}) {
  const root = payload?.data || payload || {};
  if (!root.recommendation) return null;
  const recommendation = normalizeRecommendation(root.recommendation);
  return recommendation.taskKey ? recommendation : null;
}

function judgeSearchAssets(payload = {}) {
  const root = payload?.data || payload || {};
  const recommendation = judgeRecommendationFromSearch(root);
  if (recommendation?.assets.length) return recommendation.assets;
  return asArray(root.asset_matches)
    .map((match) => normalizeAsset(match.asset || match))
    .filter((asset) => asset.assetKey);
}

function judgeMatchByAsset(payload = {}) {
  const root = payload?.data || payload || {};
  return new Map(asArray(root.asset_matches).map((match) => [
    match.asset?.asset_key || match.asset_key,
    match,
  ]));
}

function judgeFilteredAssets() {
  const role = document.querySelector('[data-judge-role]')?.value || '';
  const type = document.querySelector('[data-judge-type-filter]')?.value || '';
  return judgeState.assets.filter((asset) => (
    (!role || asset.governance.consumerRoles.includes(role))
    && (!type || asset.assetType === type)
  ));
}

function renderJudgeSearchResults() {
  const target = document.querySelector('[data-judge-search-results]');
  if (!target) return;
  const items = judgeFilteredAssets();
  const matches = judgeMatchByAsset(judgeState.searchPayload);
  if (!items.length) {
    target.innerHTML = `
      <div class="judge-zero-state">
        <strong>No governed capabilities match these filters.</strong>
        <span>Clear the filters or enter a different task. No result was fabricated.</span>
      </div>
    `;
    return;
  }
  target.innerHTML = `
    <div class="judge-result-scroll">
      <table class="judge-results-table">
        <thead><tr><th>Type</th><th>Capability</th><th>Version</th><th>Validated</th><th>Why it worked</th><th>Source evidence</th></tr></thead>
        <tbody>
          ${items.map((asset, index) => {
            const match = matches.get(asset.assetKey) || {};
            const source = asset.sourceTurns[0] || {};
            const sourceId = source.source_turn_id || source.turn_id || source.id || 'Evidence retained';
            const scope = source.context_scope || 'public-safe source turn';
            return `
              <tr>
                <td><span class="judge-type-code judge-type-${escapeHtml(asset.assetType)}">${escapeHtml(citationCode(asset, index).slice(0, 1))}</span><strong>${escapeHtml(ASSET_TYPE_LABELS[asset.assetType] || humanize(asset.assetType))}</strong></td>
                <td><a href="${escapeHtml(assetHref(asset.assetKey))}">${escapeHtml(asset.title)}</a><span>${escapeHtml(humanize(asset.capabilityArea))}</span></td>
                <td><span class="judge-version">v${escapeHtml(asset.governance.version || '—')}</span>${reviewStatusMarkup(asset.governance.reviewStatus)}</td>
                <td><time>${escapeHtml(formatDate(asset.governance.lastValidatedAt, { dateOnly: true, empty: 'Not recorded' }))}</time>${Number.isFinite(Number(match.score)) ? `<span>rank score ${escapeHtml(String(match.score))}</span>` : '<span>stored mapping</span>'}</td>
                <td><q>${escapeHtml(asset.whyItWorked || asset.summary || 'Not provided')}</q></td>
                <td><a href="${escapeHtml(assetHref(asset.assetKey))}">${escapeHtml(sourceId)}</a><span>${escapeHtml(scope)}</span></td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
    <div class="judge-results-footer"><a href="/assets">View all governed assets</a><span>${items.length} result${items.length === 1 ? '' : 's'} shown</span></div>
  `;
}

function renderJudgePlanNote(label, values) {
  const items = asArray(values);
  if (!items.length) return '';
  return `
    <div class="judge-plan-note">
      <strong>${escapeHtml(label)}</strong>
      <div class="judge-plan-note-items">${items.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</div>
    </div>
  `;
}

function renderJudgePlan(plan, {
  mode = 'authoritative',
  model = '',
} = {}) {
  const steps = asArray(plan?.steps);
  const assets = recommendationState.current?.assets || [];
  const assetIndex = new Map(assets.map((asset, index) => [asset.assetKey, { asset, index }]));
  if (!steps.length) {
    return '<div class="judge-zero-state"><strong>No adapted steps are available.</strong><span>The deterministic capability result remains visible above.</span></div>';
  }
  const rows = steps.map((step, index) => {
    const keys = asArray(step.asset_keys);
    const turns = asArray(step.source_turn_ids);
    return `
      <details class="judge-plan-row">
        <summary>
          <span class="judge-step-number">${index + 1}</span>
          <span class="judge-step-copy"><strong>${escapeHtml(step.title || `Use governed capability ${index + 1}`)}</strong><span>${escapeHtml(step.action || '')}</span></span>
          <span class="judge-citation-list">
            ${keys.map((key) => {
              const indexed = assetIndex.get(key);
              return `<a href="${escapeHtml(assetHref(key))}" title="${escapeHtml(key)}">${escapeHtml(indexed ? citationCode(indexed.asset, indexed.index) : compactId(key))}</a>`;
            }).join('')}
            ${turns.map((turn) => `<span title="Source turn ${escapeHtml(turn)}">${escapeHtml(turn)}</span>`).join('')}
          </span>
        </summary>
        <div class="judge-plan-detail">
          <span><strong>Authority</strong>${mode === 'generated' ? 'Non-authoritative adaptation' : mode === 'fallback' ? 'Deterministic fallback' : 'Stored capability record'}</span>
          <span><strong>Human review</strong>${step.requires_human_review === false ? 'Not requested by plan' : 'Required before use'}</span>
        </div>
      </details>
    `;
  }).join('');
  const allKeys = [...new Set(steps.flatMap((step) => asArray(step.asset_keys)))];
  return `
    <div class="judge-plan-ledger" data-plan-mode-value="${escapeHtml(mode)}">
      ${plan.summary ? `<p class="judge-plan-summary">${escapeHtml(plan.summary)}</p>` : ''}
      ${rows}
      ${renderJudgePlanNote('Missing context', plan.missing_context)}
      ${renderJudgePlanNote('Limitations', plan.limitations)}
      <div class="judge-plan-footer">
        <span><strong>Citations:</strong>${allKeys.map((key) => {
          const indexed = assetIndex.get(key);
          return `<a href="${escapeHtml(assetHref(key))}">${escapeHtml(indexed ? `${citationCode(indexed.asset, indexed.index)} ${indexed.asset.title}` : key)}</a>`;
        }).join('')}</span>
        <button type="button" class="judge-copy-button" data-copy-plan>Copy plan</button>
      </div>
    </div>
  `;
}

function deterministicJudgePlan(recommendation) {
  const assets = recommendation?.assets || [];
  return {
    summary: `Start from ${assets.length} approved capability asset${assets.length === 1 ? '' : 's'} selected by the stored task mapping.`,
    steps: assets.map((asset) => ({
      title: `Use ${asset.title}`,
      action: asset.summary || asset.whyItWorked || 'Inspect the stored capability before reuse.',
      asset_keys: [asset.assetKey],
      source_turn_ids: asset.sourceTurns.slice(0, 1).map((source) => source.source_turn_id || source.turn_id || source.id).filter(Boolean),
      requires_human_review: true,
    })),
    missing_context: [],
    limitations: ['This starting point is retrieved from stored memory and does not claim task completion.'],
  };
}

function setJudgePlan(plan, options) {
  const target = document.querySelector('[data-assist-result]');
  if (!target) return;
  judgeState.currentPlan = plan;
  judgeState.currentPlanOptions = {
    mode: options?.mode || 'authoritative',
    model: options?.model || '',
  };
  target.innerHTML = renderJudgePlan(plan, options);
  const label = document.querySelector('[data-plan-mode]');
  if (label) {
    label.textContent = options?.mode === 'generated'
      ? '(AI-assisted)'
      : options?.mode === 'fallback'
        ? '(deterministic fallback)'
        : '(authoritative starting point)';
  }
  bindJudgePlanActions();
}

function judgePlanAuthority(mode) {
  if (mode === 'generated') return 'Non-authoritative AI-assisted adaptation';
  if (mode === 'fallback') return 'Deterministic fallback';
  return 'Authoritative stored capability starting point';
}

function formatJudgePlanForClipboard() {
  const plan = judgeState.currentPlan || {};
  const options = judgeState.currentPlanOptions || {};
  const steps = asArray(plan.steps);
  const assets = recommendationState.current?.assets || [];
  const assetIndex = new Map(assets.map((asset, index) => [asset.assetKey, { asset, index }]));
  const lines = [
    'Organizational AI Memory capability plan',
    `Task: ${recommendationState.current?.taskKey || 'Not recorded'}`,
    `Authority: ${judgePlanAuthority(options.mode)}`,
  ];
  if (options.model) lines.push(`Model: ${options.model}`);
  if (plan.summary) lines.push(`Summary: ${plan.summary}`);
  lines.push('', 'Steps:');
  steps.forEach((step, index) => {
    const keys = asArray(step.asset_keys);
    const turns = asArray(step.source_turn_ids);
    lines.push(`${index + 1}. ${step.title || `Use governed capability ${index + 1}`}`);
    lines.push(`   Action: ${step.action || 'Inspect the stored capability before reuse.'}`);
    lines.push(`   Assets: ${keys.length ? keys.join(', ') : 'Not recorded'}`);
    lines.push(`   Source turns: ${turns.length ? turns.join(', ') : 'Not recorded'}`);
    lines.push(`   Human review: ${step.requires_human_review === false ? 'Not requested by plan' : 'Required before use'}`);
  });
  const appendList = (label, values) => {
    const items = asArray(values);
    if (!items.length) return;
    lines.push('', `${label}:`, ...items.map((item) => `- ${item}`));
  };
  appendList('Missing context', plan.missing_context);
  appendList('Limitations', plan.limitations);
  const citationKeys = [...new Set(steps.flatMap((step) => asArray(step.asset_keys)))];
  if (citationKeys.length) {
    lines.push('', 'Citations:');
    citationKeys.forEach((key) => {
      const indexed = assetIndex.get(key);
      const label = indexed ? `${citationCode(indexed.asset, indexed.index)} ${indexed.asset.title}` : key;
      lines.push(`- ${label} [${key}]`);
    });
  }
  return lines.join('\n');
}

function bindJudgePlanActions() {
  const target = document.querySelector('[data-assist-result]');
  const toggle = document.querySelector('[data-citation-toggle]');
  if (target && toggle) target.dataset.citations = toggle.checked ? 'shown' : 'hidden';
  document.querySelector('[data-copy-plan]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const text = formatJudgePlanForClipboard();
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = 'Copied';
      window.setTimeout(() => {
        if (button.isConnected) button.textContent = 'Copy plan';
      }, 1_500);
    } catch {
      button.textContent = 'Copy unavailable';
    }
  });
}

function updateJudgeCitationVisibility() {
  const target = document.querySelector('[data-assist-result]');
  const toggle = document.querySelector('[data-citation-toggle]');
  if (target && toggle) target.dataset.citations = toggle.checked ? 'shown' : 'hidden';
}

async function runJudgeCapabilitySearch(query) {
  const status = document.querySelector('[data-judge-search-status]');
  const target = document.querySelector('[data-judge-search-results]');
  const assistButton = document.querySelector('[data-assist-submit]');
  if (!status || !target) return;
  status.textContent = 'Searching approved capability content with deterministic lexical retrieval…';
  target.innerHTML = '<div class="judge-loading">Matching task mappings, capability content, and evidence…</div>';
  if (assistButton) assistButton.disabled = true;
  recommendationState.current = null;
  try {
    const payload = await fetchJson('/api/public/capability-search', {
      method: 'POST',
      body: JSON.stringify({ query }),
    });
    judgeState.searchPayload = payload;
    judgeState.assets = judgeSearchAssets(payload);
    const root = payload?.data || payload || {};
    const recommendation = judgeRecommendationFromSearch(root);
    recommendationState.current = recommendation ? await hydrateRecommendation(recommendation) : null;
    if (recommendationState.current) judgeState.assets = recommendationState.current.assets;
    renderJudgeSearchResults();
    const aliasCount = asArray(root.retrieval?.applied_aliases).length;
    const resolution = humanize(root.resolution?.reason || root.status || 'completed');
    const matched = root.status === 'matched' && judgeState.assets.length > 0;
    status.dataset.matchStatus = matched ? 'matched' : 'none';
    status.innerHTML = `<strong>${judgeState.assets.length} result${judgeState.assets.length === 1 ? '' : 's'}</strong><span>${matched ? 'Deterministic match ✓' : 'No deterministic match'}</span><span>${escapeHtml(resolution)}</span>${aliasCount ? `<span>${aliasCount} query alias${aliasCount === 1 ? '' : 'es'} applied</span>` : ''}`;
    if (recommendationState.current) {
      setJudgePlan(deterministicJudgePlan(recommendationState.current), { mode: 'authoritative' });
      if (assistButton) assistButton.disabled = false;
    } else {
      setJudgePlan({ steps: [] }, { mode: 'authoritative' });
    }
  } catch (error) {
    judgeState.searchPayload = null;
    judgeState.assets = [];
    target.innerHTML = `<div class="judge-error"><strong>Capability search unavailable</strong><span>${escapeHtml(error.message)}</span></div>`;
    status.textContent = 'The deterministic search request did not complete.';
    setJudgePlan({ steps: [] }, { mode: 'authoritative' });
  }
}

function renderJudgeAnalytics(payload) {
  const analytics = normalizeAnalytics(payload);
  const total = Math.max(analyticsTotal(analytics), 1);
  const approved = countValue(analytics.reviewCounts.find((item) => countKey(item, ['review_status', 'status']) === 'approved'));
  const reviewed = countValue(analytics.reviewCounts.find((item) => countKey(item, ['review_status', 'status']) === 'reviewed'));
  const reuseCoverage = Number(analytics.reuse.recommendation_coverage_percent);
  const evidenceCoverage = Number(analytics.coverage.evidence_coverage_percent);
  const taskCoverage = Number(analytics.coverage.task_coverage_percent);
  const hasCoverage = [reuseCoverage, evidenceCoverage, taskCoverage].every(Number.isFinite);
  const gapCount = analytics.computedGaps.length || analytics.missingCapabilities.length;
  const values = hasCoverage
    ? [
        ['Reuse coverage', `${reuseCoverage}%`, reuseCoverage / 100, 'teal'],
        ['Evidence coverage', `${evidenceCoverage}%`, evidenceCoverage / 100, 'green'],
        ['Task coverage', `${taskCoverage}%`, taskCoverage / 100, 'amber'],
        ['Capability gaps', gapCount, Math.min(gapCount / total, 1), 'red'],
      ]
    : [
        ['Governed assets', analyticsTotal(analytics), analyticsTotal(analytics) / total, 'teal'],
        ['Approved', approved, approved / total, 'green'],
        ['Reviewed', reviewed, reviewed / total, 'amber'],
        ['Capability gaps', gapCount, Math.min(gapCount / total, 1), 'red'],
      ];
  return `
    <div class="judge-metrics">
      ${values.map(([label, value, ratio, color]) => `
        <div class="judge-metric"><span><strong>${escapeHtml(label)}</strong><b>${escapeHtml(String(value))}</b></span><i><em class="is-${color}" style="width:${Math.max(4, Math.round(ratio * 100))}%"></em></i></div>
      `).join('')}
    </div>
    <p class="judge-analytics-note">${hasCoverage ? 'Computed from current Postgres records; outcome claims are not measured.' : 'Derived from the current public-safe capability inventory.'}</p>
    <a class="judge-rail-link" href="/assets">View inventory details</a>
  `;
}

async function loadJudgeAnalytics() {
  const target = document.querySelector('[data-judge-analytics]');
  if (!target) return;
  try {
    target.innerHTML = renderJudgeAnalytics(await fetchJson('/api/public/capability-analytics'));
  } catch (error) {
    target.innerHTML = `<div class="judge-error"><strong>Analytics unavailable</strong><span>${escapeHtml(error.message)}</span></div>`;
  }
}

async function runPublicAccessProofs() {
  const target = document.querySelector('[data-access-proofs]');
  const button = document.querySelector('[data-rerun-access-proof]');
  if (!target) return;
  if (button) button.disabled = true;
  target.innerHTML = '<div class="judge-loading">Loading the build-bound four-plane proof and rerunning the public boundary…</div>';
  try {
    const [identityProof, allowResponse, denyResponse] = await Promise.all([
      fetchJson('/api/public/access-proof'),
      fetch('/api/public/corpus', { headers: { accept: 'application/json' } }),
      fetch('/api/public/evidence?type=fact&thread=private', { headers: { accept: 'application/json' } }),
    ]);
    const [allowPayload, denyPayload] = await Promise.all([
      allowResponse.json().catch(() => ({})),
      denyResponse.json().catch(() => ({})),
    ]);
    const scope = allowPayload?.scope || allowPayload?.data?.scope || {};
    const allowPassed = allowResponse.ok;
    const denyPassed = denyResponse.status >= 400 && denyResponse.status < 500;
    const denyCode = denyPayload?.error?.code || `http_${denyResponse.status}`;
    const proofChecks = asArray(identityProof?.checks);
    const proofCounts = identityProof?.counts || {};
    const requiredCount = proofChecks.filter((check) => check.required).length;
    const passedCount = Number(proofCounts.pass || 0);
    const identityPassed = identityProof?.overall_status === 'PASS'
      && requiredCount > 0
      && passedCount === requiredCount;
    const planeSummary = [...new Set(proofChecks.map((check) => check.plane).filter(Boolean))]
      .map((plane) => {
        const checks = proofChecks.filter((check) => check.plane === plane);
        return `${humanize(plane)} ${checks.filter((check) => check.status === 'PASS').length}/${checks.length}`;
      })
      .join(' · ');
    const proofs = [
      {
        passed: identityPassed,
        title: identityPassed ? 'Four-plane proof passed' : 'Four-plane proof failed',
        action: 'Verify identity enforcement',
        resource: `${requiredCount} required controls`,
        policy: planeSummary || 'No proof groups returned',
        result: `${identityProof?.overall_status || 'FAIL'} ${passedCount}/${requiredCount}`,
        time: identityProof?.generated_at,
      },
      {
        passed: allowPassed && denyPassed,
        title: allowPassed && denyPassed ? 'Live boundary passed' : 'Live boundary failed',
        action: 'Allow public read; reject scope injection',
        resource: scope.corpus_key || scope.pack_key || 'Pinned public corpus',
        policy: denyCode,
        result: `allow ${allowResponse.status} · deny ${denyResponse.status}`,
        time: new Date().toISOString(),
      },
    ];
    target.innerHTML = proofs.map((proof) => `
      <article class="judge-proof ${proof.passed ? 'is-pass' : 'is-fail'}">
        <div class="judge-proof-title"><span>${proof.passed ? '✓' : '×'}</span><strong>${escapeHtml(proof.title)}</strong></div>
        <dl><div><dt>Session</dt><dd>Public judge</dd></div><div><dt>Action</dt><dd>${escapeHtml(proof.action)}</dd></div><div><dt>Resource</dt><dd>${escapeHtml(proof.resource)}</dd></div><div><dt>Result</dt><dd>${escapeHtml(proof.result)}</dd></div><div><dt>Time</dt><dd>${escapeHtml(formatDate(proof.time))}</dd></div><div><dt>Policy</dt><dd>${escapeHtml(proof.policy)}</dd></div></dl>
      </article>
    `).join('') + '<a class="judge-rail-link" href="/architect/">Open the protected Architect Console</a>';
  } catch (error) {
    target.innerHTML = `<div class="judge-error"><strong>Access proof unavailable</strong><span>${escapeHtml(error.message)}</span></div>`;
  } finally {
    if (button) button.disabled = false;
  }
}

function bindJudgeDemo() {
  const form = document.querySelector('[data-capability-search-form]');
  if (!form) return;
  const global = document.querySelector('[data-judge-global-search]');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const query = form.elements.query.value.trim();
    if (global) global.value = query;
    if (query) runJudgeCapabilitySearch(query);
  });
  form.addEventListener('reset', () => {
    window.setTimeout(() => {
      form.elements.query.value = '';
      form.elements.query.focus();
    });
  });
  global?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    form.elements.query.value = global.value;
    form.requestSubmit();
  });
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      global?.focus();
    }
  });
  document.querySelector('[data-judge-role]')?.addEventListener('change', renderJudgeSearchResults);
  document.querySelector('[data-judge-type-filter]')?.addEventListener('change', renderJudgeSearchResults);
  document.querySelector('[data-judge-clear-filters]')?.addEventListener('click', () => {
    document.querySelector('[data-judge-role]').value = '';
    document.querySelector('[data-judge-type-filter]').value = '';
    form.requestSubmit();
  });
  document.querySelector('[data-citation-toggle]')?.addEventListener('change', updateJudgeCitationVisibility);
  document.querySelector('[data-rerun-access-proof]')?.addEventListener('click', runPublicAccessProofs);
}

async function initializeJudgeDemo() {
  bindJudgeDemo();
  const query = document.querySelector('[data-capability-search-form]')?.elements.query.value.trim();
  await Promise.all([
    query ? runJudgeCapabilitySearch(query) : Promise.resolve(),
    loadJudgeAnalytics(),
    runPublicAccessProofs(),
  ]);
}

function countValue(item = {}) {
  return Number(item.count ?? item.value ?? 0);
}

function countKey(item = {}, fields = []) {
  for (const field of fields) {
    if (item[field]) return item[field];
  }
  return item.key || item.label || '';
}

function analyticsTotal(analytics) {
  if (analytics.totalAssets !== null && analytics.totalAssets !== undefined) return Number(analytics.totalAssets);
  return analytics.typeCounts.reduce((total, item) => total + countValue(item), 0);
}

function renderCompactAnalytics(analytics) {
  const approved = analytics.reviewCounts.find((item) => countKey(item, ['review_status', 'status']) === 'approved');
  return `
    <div class="analytics-strip" aria-label="Capability analytics">
      <div><strong>${escapeHtml(String(analyticsTotal(analytics)))}</strong><span>governed assets</span></div>
      <div><strong>${escapeHtml(String(countValue(approved)))}</strong><span>approved</span></div>
      <div><strong>${escapeHtml(String(analytics.capabilityCounts.length))}</strong><span>capability areas</span></div>
      <div class="analytics-type-line">${analytics.typeCounts.map((item) => {
        const key = countKey(item, ['asset_type', 'type']);
        return `<span><strong>${escapeHtml(String(countValue(item)))}</strong> ${escapeHtml(ASSET_TYPE_LABELS[key] || humanize(key))}</span>`;
      }).join('')}</div>
    </div>
  `;
}

async function loadHomeCapabilityProof() {
  const target = document.querySelector('[data-home-capability-proof]');
  if (!target) return;
  try {
    const [recommendations, , analyticsPayload] = await Promise.all([
      loadRecommendationIndex(),
      loadAllAssets(),
      fetchJson('/api/public/capability-analytics').catch(() => null),
    ]);
    if (!recommendations.length) throw new Error('No public task mappings are available.');
    const preferred = recommendations.find((item) => item.taskKey === CANONICAL_TASK_KEY)
      || recommendations[0];
    const recommendation = await hydrateRecommendation(preferred);
    target.innerHTML = `
      <div class="home-recommendation">${renderRecommendationRecord(recommendation, { compact: true })}</div>
      ${analyticsPayload ? renderCompactAnalytics(normalizeAnalytics(analyticsPayload)) : '<div class="empty-state"><p>Capability counts are temporarily unavailable.</p></div>'}
    `;
  } catch (error) {
    target.innerHTML = `<div class="error-state"><h3>Capability record unavailable</h3><p>${escapeHtml(error.message)}</p></div>`;
  }
}

function renderCapabilityAnalytics(payload) {
  const analytics = normalizeAnalytics(payload);
  const duplicate = analytics.duplicatedPatterns[0];
  return `
    ${renderCompactAnalytics(analytics)}
    <div class="analytics-ledger">
      <section>
        <h3>Review lifecycle</h3>
        ${analytics.reviewCounts.map((item) => {
          const key = countKey(item, ['review_status', 'status']);
          return `<div class="analytics-row"><span>${reviewStatusMarkup(key)}</span><strong>${escapeHtml(String(countValue(item)))}</strong></div>`;
        }).join('') || '<p class="timestamp">No lifecycle counts available.</p>'}
      </section>
      <section>
        <h3>Repeated pattern</h3>
        ${duplicate ? `<strong>${escapeHtml(humanize(duplicate.pattern_key || duplicate.title || ''))}</strong><p>${escapeHtml(duplicate.signal || '')}</p>` : '<p class="timestamp">No repeated pattern signal recorded.</p>'}
      </section>
      <section>
        <h3>Capability gaps</h3>
        <ul>${analytics.missingCapabilities.map((gap) => `<li><strong>${escapeHtml(gap.title || humanize(gap.gap_key))}</strong><span>${escapeHtml(gap.signal || '')}</span></li>`).join('')}</ul>
      </section>
    </div>
  `;
}

function renderAssetLedger(items, selectedKey) {
  if (!items.length) return '<div class="empty-state"><h2>No matching assets</h2><p>The selected filters did not match a capability asset.</p></div>';
  const rows = items.map((asset) => `
    <tr tabindex="0" role="button" aria-selected="${asset.assetKey === selectedKey}" data-asset-key="${escapeHtml(asset.assetKey)}">
      <td><strong>${escapeHtml(asset.title)}</strong><span class="object-id">${escapeHtml(asset.assetKey)}</span></td>
      <td><span class="asset-type asset-type-${escapeHtml(asset.assetType)}">${escapeHtml(ASSET_TYPE_LABELS[asset.assetType] || humanize(asset.assetType))}</span></td>
      <td>${escapeHtml(humanize(asset.capabilityArea))}</td>
      <td>${reviewStatusMarkup(asset.governance.reviewStatus)}</td>
      <td class="mono">${asset.governance.version ? `v${escapeHtml(asset.governance.version)}` : '—'}</td>
    </tr>
  `).join('');
  const records = items.map((asset) => `
    <button class="asset-record" type="button" aria-selected="${asset.assetKey === selectedKey}" data-asset-key="${escapeHtml(asset.assetKey)}">
      <span class="asset-record-top"><span class="asset-type asset-type-${escapeHtml(asset.assetType)}">${escapeHtml(ASSET_TYPE_LABELS[asset.assetType] || humanize(asset.assetType))}</span>${reviewStatusMarkup(asset.governance.reviewStatus)}</span>
      <strong>${escapeHtml(asset.title)}</strong>
      <span>${escapeHtml(humanize(asset.capabilityArea))} · ${asset.governance.version ? `v${escapeHtml(asset.governance.version)}` : 'version not provided'}</span>
    </button>
  `).join('');
  return `
    <div class="asset-ledger-heading"><h2>Asset ledger</h2><span class="timestamp">${items.length} matching asset${items.length === 1 ? '' : 's'}</span></div>
    <table class="asset-table">
      <thead><tr><th>Asset</th><th>Type</th><th>Capability area</th><th>Review</th><th>Version</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="asset-records">${records}</div>
  `;
}

function relatedAssetKey(value) {
  if (typeof value === 'string') return value;
  return value?.asset_key || value?.key || '';
}

function renderAssetLinks(values, emptyText, { externalLabel = 'External reference' } = {}) {
  const items = asArray(values).filter(Boolean);
  if (!items.length) return `<span class="timestamp">${escapeHtml(emptyText)}</span>`;
  return `<ul class="asset-link-list">${items.map((item) => {
    const key = relatedAssetKey(item);
    if (assetCache.has(key)) {
      return `<li><a href="${escapeHtml(assetHref(key))}">${escapeHtml(item.title || key)}</a></li>`;
    }
    return `<li><span class="external-asset-ref"><span>${escapeHtml(item.title || key)}</span><small>${escapeHtml(externalLabel)}</small></span></li>`;
  }).join('')}</ul>`;
}

function renderAssetEvidence(sourceTurns) {
  if (!sourceTurns.length) return '<div class="empty-state"><p>No source turn was provided for this asset.</p></div>';
  return sourceTurns.map((value, index) => {
    const turn = typeof value === 'string' ? { source_turn_id: value } : value;
    const observation = turn.observation || asArray(turn.observations)[0] || {};
    const turnId = turn.source_turn_id || turn.turn_id || turn.id || '';
    const observationId = observation.observation_id || observation.id || turn.observation_id || '';
    const excerpt = turn.text_raw || turn.excerpt || turn.text || '';
    return `
      <details class="asset-evidence" ${index === 0 ? 'open' : ''}>
        <summary>${escapeHtml(turnId || `Source turn ${index + 1}`)}</summary>
        <div class="asset-evidence-path">
          <div><span>Asset</span><strong>Selected capability</strong></div>
          <div><span>Observation</span><strong title="${escapeHtml(observationId)}">${escapeHtml(observationId ? compactId(observationId) : 'Linked observation retained')}</strong></div>
          <div><span>Source turn</span><strong>${escapeHtml(turnId || 'Retained source')}</strong>${excerpt ? `<blockquote>${escapeHtml(excerpt)}</blockquote>` : ''}</div>
        </div>
      </details>
    `;
  }).join('');
}

function renderAssetInspector(asset) {
  if (!asset?.assetKey) return '<div class="empty-state"><p>Select an asset to inspect its governance and source path.</p></div>';
  const governance = asset.governance;
  return `
    <div class="asset-inspector-header">
      <span class="asset-type asset-type-${escapeHtml(asset.assetType)}">${escapeHtml(ASSET_TYPE_LABELS[asset.assetType] || humanize(asset.assetType))}</span>
      <h2>${escapeHtml(asset.title)}</h2>
      <p>${escapeHtml(asset.summary)}</p>
      <span class="object-id">${escapeHtml(asset.assetKey)}</span>
    </div>
    <section class="asset-inspector-section">
      <h3>Operational value</h3>
      <dl class="asset-detail-list">
        <div><dt>Problem solved</dt><dd>${escapeHtml(asset.problemSolved || 'Not provided')}</dd></div>
        <div><dt>Why it worked</dt><dd>${escapeHtml(asset.whyItWorked || 'Not provided')}</dd></div>
      </dl>
    </section>
    <section class="asset-inspector-section">
      <h3>Reusable typed content</h3>
      <dl class="governance-grid">
        <div><dt>Schema</dt><dd>v${escapeHtml(String(asset.content.schemaVersion ?? 'Not provided'))}</dd></div>
        <div><dt>Content type</dt><dd>${escapeHtml(asset.content.contentType || 'Not provided')}</dd></div>
        <div class="governance-wide"><dt>Family</dt><dd><code>${escapeHtml(asset.content.familyKey || 'Not provided')}</code></dd></div>
        <div class="governance-wide"><dt>Change</dt><dd>${escapeHtml(asset.content.changeSummary || 'Not provided')}</dd></div>
        <div class="governance-wide"><dt>SHA-256</dt><dd><code>${escapeHtml(asset.content.sha256 || 'Not provided')}</code></dd></div>
      </dl>
      <pre class="asset-content-body">${escapeHtml(JSON.stringify(asset.content.body, null, 2))}</pre>
    </section>
    <section class="asset-inspector-section">
      <div class="inspector-section-heading"><h3>Governance</h3>${reviewStatusMarkup(governance.reviewStatus)}</div>
      <dl class="governance-grid">
        <div><dt>Visibility</dt><dd>${escapeHtml(humanize(governance.visibility || 'not provided'))}</dd></div>
        <div><dt>Version</dt><dd>${governance.version ? `v${escapeHtml(governance.version)}` : 'Not provided'}</dd></div>
        <div><dt>Owner</dt><dd>${escapeHtml(humanize(governance.ownerRole || 'not provided'))}</dd></div>
        <div><dt>Validated</dt><dd>${escapeHtml(formatDate(governance.lastValidatedAt, { dateOnly: true, empty: 'Not provided' }))}</dd></div>
        <div class="governance-wide"><dt>Consumer roles</dt><dd>${governance.consumerRoles.length ? governance.consumerRoles.map(humanize).map(escapeHtml).join(', ') : 'Not provided'}</dd></div>
        ${governance.riskNote ? `<div class="governance-wide"><dt>Risk note</dt><dd>${escapeHtml(governance.riskNote)}</dd></div>` : ''}
      </dl>
      <p class="governance-note">This public-safe record preserves the simulated source organization’s governance visibility.</p>
    </section>
    <section class="asset-inspector-section">
      <h3>Asset -> observation -> source turn</h3>
      ${renderAssetEvidence(asset.sourceTurns)}
    </section>
    <section class="asset-inspector-section split-inspector-section">
      <div><h3>Lineage</h3><strong>Supersedes</strong>${renderAssetLinks(asset.lineage.supersedes, 'No prior version recorded.', { externalLabel: 'Prior version not included' })}<strong>Superseded by</strong>${renderAssetLinks(asset.lineage.supersededBy, 'No later version recorded.', { externalLabel: 'Referenced version not included' })}</div>
      <div><h3>Used successfully in</h3>${renderAssetLinks(asset.usedSuccessfullyIn, 'No usage reference recorded.')}</div>
    </section>
    <section class="asset-inspector-section">
      <h3>Related assets</h3>
      ${renderAssetLinks(asset.relatedAssets, 'No related assets recorded.')}
    </section>
  `;
}

function bindAssetRows() {
  document.querySelectorAll('[data-asset-key]').forEach((element) => {
    element.addEventListener('click', () => selectAsset(element.dataset.assetKey));
    element.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectAsset(element.dataset.assetKey);
      }
    });
  });
}

function renderCurrentAssetLedger() {
  const list = document.querySelector('.asset-ledger');
  if (!list) return;
  list.innerHTML = renderAssetLedger(assetState.items, assetState.selectedKey);
  bindAssetRows();
}

async function selectAsset(assetKey) {
  if (!assetKey) return;
  assetState.selectedKey = assetKey;
  renderCurrentAssetLedger();
  const panel = document.querySelector('.asset-inspector');
  if (!panel) return;
  panel.innerHTML = '<div class="loading-state">Loading governance and evidence...</div>';
  try {
    const asset = await loadAssetDetail(assetKey);
    if (assetState.selectedKey === assetKey) panel.innerHTML = renderAssetInspector(asset);
  } catch (error) {
    panel.innerHTML = `<div class="error-state"><h2>Asset detail unavailable</h2><p>${escapeHtml(error.message)}</p></div>`;
  }
}

function setFilterOptions(select, values, label) {
  const selected = select.value;
  select.innerHTML = `<option value="">All ${escapeHtml(label)}</option>${values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(humanize(value))}</option>`).join('')}`;
  select.value = selected;
}

function populateAssetFilters() {
  const form = document.querySelector('[data-asset-filters]');
  if (!form) return;
  setFilterOptions(form.elements.type, [...new Set(assetState.allItems.map((asset) => asset.assetType))].filter(Boolean).sort(), 'types');
  setFilterOptions(form.elements.capability_area, [...new Set(assetState.allItems.map((asset) => asset.capabilityArea))].filter(Boolean).sort(), 'capability areas');
  setFilterOptions(form.elements.review_status, [...new Set(assetState.allItems.map((asset) => asset.governance.reviewStatus))].filter(Boolean).sort(), 'review statuses');
}

async function applyAssetFilters() {
  const form = document.querySelector('[data-asset-filters]');
  const status = document.querySelector('[data-assets-status]');
  const list = document.querySelector('.asset-ledger');
  if (!form || !status || !list) return;
  const params = new URLSearchParams();
  for (const field of ['type', 'capability_area', 'review_status']) {
    const value = form.elements[field].value;
    if (value) params.set(field, value);
  }
  status.textContent = 'Filtering the public-safe capability ledger...';
  list.innerHTML = '<div class="loading-state">Applying governed asset filters...</div>';
  try {
    const payload = await fetchJson(`/api/public/assets${params.size ? `?${params}` : ''}`);
    assetState.items = cacheAssets(extractItems(payload, ['assets']));
    const requestedKey = new URLSearchParams(window.location.search).get('asset');
    assetState.selectedKey = assetState.items.some((asset) => asset.assetKey === requestedKey)
      ? requestedKey
      : assetState.items[0]?.assetKey || '';
    renderCurrentAssetLedger();
    status.textContent = `${assetState.items.length} governed asset${assetState.items.length === 1 ? '' : 's'} shown.`;
    const panel = document.querySelector('.asset-inspector');
    if (assetState.selectedKey) selectAsset(assetState.selectedKey);
    else if (panel) panel.innerHTML = '<div class="empty-state"><p>No asset selected.</p></div>';
  } catch (error) {
    list.innerHTML = `<div class="error-state"><h2>Capability ledger unavailable</h2><p>${escapeHtml(error.message)}</p></div>`;
    status.textContent = 'The asset filters could not be applied.';
  }
}

async function initializeAssetsPage() {
  const analyticsTarget = document.querySelector('[data-capability-analytics]');
  try {
    const allAssets = await loadAllAssets();
    assetState.allItems = allAssets;
    populateAssetFilters();
    await applyAssetFilters();
  } catch (error) {
    const list = document.querySelector('.asset-ledger');
    if (list) list.innerHTML = `<div class="error-state"><h2>Capability inventory unavailable</h2><p>${escapeHtml(error.message)}</p></div>`;
  }
  if (analyticsTarget) {
    try {
      analyticsTarget.innerHTML = renderCapabilityAnalytics(await fetchJson('/api/public/capability-analytics'));
    } catch {
      analyticsTarget.innerHTML = '<div class="error-state"><p>Capability counts are temporarily unavailable.</p></div>';
    }
  }
}

function extractRecommendation(payload) {
  const root = payload?.data || payload || {};
  return normalizeRecommendation(root.recommendation || root.item || root);
}

async function runRecommendation(taskKey) {
  const requestId = ++recommendationRequestId;
  const status = document.querySelector('[data-recommendation-status]');
  const target = document.querySelector('[data-recommendation-result]');
  const assistButton = document.querySelector('[data-assist-submit]');
  const assistStatus = document.querySelector('[data-assist-status]');
  const assistTarget = document.querySelector('[data-assist-result]');
  const recommendationButton = document.querySelector('[data-recommendation-form] button[type="submit"]');
  if (!status || !target || !taskKey) return;
  recommendationState.current = null;
  status.textContent = 'Retrieving the stored task mapping...';
  target.innerHTML = '<div class="loading-state">Selecting governed assets from the deterministic record...</div>';
  if (assistButton) assistButton.disabled = true;
  if (assistStatus) assistStatus.textContent = '';
  if (assistTarget) assistTarget.innerHTML = '<div class="empty-state"><p>The deterministic record remains authoritative. Spark adaptation is optional.</p></div>';
  if (recommendationButton) recommendationButton.disabled = true;
  try {
    const payload = await fetchJson('/api/public/recommendations', {
      method: 'POST',
      body: JSON.stringify({ task_key: taskKey }),
    });
    const recommendation = await hydrateRecommendation(extractRecommendation(payload));
    if (requestId !== recommendationRequestId) return;
    recommendationState.current = recommendation;
    target.innerHTML = renderRecommendationRecord(recommendation);
    target.classList.remove('recommendation-result-reserved');
    status.textContent = `${recommendation.assets.length} governed asset${recommendation.assets.length === 1 ? '' : 's'} selected from the stored mapping.`;
    if (assistButton) assistButton.disabled = false;
  } catch (error) {
    if (requestId !== recommendationRequestId) return;
    recommendationState.current = null;
    target.innerHTML = `<div class="error-state"><h3>Recommendation unavailable</h3><p>${escapeHtml(error.message)}</p></div>`;
    status.textContent = 'The deterministic task mapping could not be retrieved.';
  } finally {
    if (requestId === recommendationRequestId && recommendationButton) recommendationButton.disabled = false;
  }
}

async function initializeDemoRecommendations() {
  const form = document.querySelector('[data-recommendation-form]');
  if (!form) return;
  const select = form.elements.task_key;
  const button = form.querySelector('button[type="submit"]');
  try {
    const [recommendations] = await Promise.all([loadRecommendationIndex(), loadAllAssets()]);
    recommendationState.items = recommendations;
    select.innerHTML = recommendations.map((item) => `<option value="${escapeHtml(item.taskKey)}">${escapeHtml(item.taskTitle)}</option>`).join('');
    select.disabled = !recommendations.length;
    button.disabled = !recommendations.length;
    const requestedTaskKey = new URL(window.location.href).searchParams.get('task');
    const preferred = recommendations.find((item) => item.taskKey === requestedTaskKey)
      || recommendations.find((item) => item.taskKey === CANONICAL_TASK_KEY)
      || recommendations[0];
    if (preferred) {
      select.value = preferred.taskKey;
      await runRecommendation(preferred.taskKey);
    }
  } catch (error) {
    select.innerHTML = '<option value="">Task mappings unavailable</option>';
    const target = document.querySelector('[data-recommendation-result]');
    if (target) target.innerHTML = `<div class="error-state"><h3>Recommendation index unavailable</h3><p>${escapeHtml(error.message)}</p></div>`;
  }
}

function renderStructuredAssist(output) {
  if (!output || typeof output !== 'object') return '';
  return `
    ${output.summary ? `<p class="assist-copy">${escapeHtml(output.summary)}</p>` : ''}
    ${asArray(output.starting_plan).length ? `<h4>Starting plan</h4><ol class="assist-plan">${asArray(output.starting_plan).map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol>` : ''}
    ${asArray(output.asset_guidance).length ? `<h4>Asset guidance</h4><div class="assist-guidance">${asArray(output.asset_guidance).map((item) => `<div><strong>${escapeHtml(item.asset_key || '')}</strong><span>${escapeHtml(item.how_to_use || '')}</span>${item.caution ? `<small>${escapeHtml(item.caution)}</small>` : ''}</div>`).join('')}</div>` : ''}
    ${asArray(output.limitations).length ? `<h4>Limitations</h4><ul>${asArray(output.limitations).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}
  `;
}

function renderAssistInteraction(payload) {
  const root = payload?.data || payload || {};
  const interaction = root.interaction || root.assist || {};
  if (document.querySelector('.judge-demo')) {
    const mode = interaction.status === 'generated' ? 'generated' : 'fallback';
    const plan = interaction.plan || interaction.output;
    if (plan?.steps?.length) {
      return renderJudgePlan(plan, { mode, model: interaction.model || '' });
    }
    return `
      <div class="judge-zero-state">
        <strong>${mode === 'fallback' ? 'Deterministic records loaded; adaptation unavailable.' : 'No validated plan returned.'}</strong>
        <span>The authoritative capability result remains visible above.</span>
      </div>
    `;
  }
  const generated = interaction.status === 'generated' && (interaction.explanation || interaction.output);
  if (!generated) {
    return `
      <section class="assist-result assist-fallback">
        <div class="assist-result-heading"><span class="generated-label">Spark-generated adaptation</span><strong>Unavailable</strong></div>
        <p>Deterministic records loaded; adaptation unavailable.</p>
      </section>
    `;
  }
  const selectedKeys = asArray(interaction.selected_asset_keys);
  return `
    <section class="assist-result">
      <div class="assist-result-heading"><span class="generated-label">Spark-generated adaptation</span><strong>Non-authoritative · ${escapeHtml(interaction.model || 'gpt-5.3-codex-spark')}</strong></div>
      ${typeof interaction.explanation === 'string' ? `<p class="assist-copy">${escapeHtml(interaction.explanation)}</p>` : ''}
      ${renderStructuredAssist(interaction.output || (typeof interaction.explanation === 'object' ? interaction.explanation : null))}
      ${selectedKeys.length ? `<div class="assist-assets"><strong>Stored assets used</strong>${renderAssetLinks(selectedKeys, '')}</div>` : ''}
    </section>
  `;
}

async function runAssist(form) {
  const taskKey = recommendationState.current?.taskKey;
  const request = form.elements.request.value.trim();
  const button = form.querySelector('button[type="submit"]');
  const status = document.querySelector('[data-assist-status]');
  const target = document.querySelector('[data-assist-result]');
  if (!taskKey || !request || !button || !status || !target) return;
  button.disabled = true;
  status.textContent = 'Requesting a bounded adaptation from Codex Spark...';
  target.innerHTML = document.querySelector('.judge-demo')
    ? '<div class="judge-loading">Adapting only the selected public-safe record…</div>'
    : '<div class="loading-state">Adapting only the selected public-safe record...</div>';
  try {
    const payload = await fetchJson('/api/public/capability-assist', {
      method: 'POST',
      body: JSON.stringify({ task_key: taskKey, request }),
    });
    const selectedTaskKey = document.querySelector('[data-recommendation-form] select')?.value;
    const judgeDemo = document.querySelector('.judge-demo');
    if ((!judgeDemo && selectedTaskKey !== taskKey) || recommendationState.current?.taskKey !== taskKey) return;
    const responseRoot = payload?.data || payload || {};
    const returnedRecommendation = responseRoot.recommendation
      || (responseRoot.task && Array.isArray(responseRoot.recommendations) ? responseRoot : null);
    if (returnedRecommendation) {
      const hydratedRecommendation = await hydrateRecommendation(returnedRecommendation);
      const currentTaskKey = document.querySelector('[data-recommendation-form] select')?.value;
      if ((!judgeDemo && currentTaskKey !== taskKey) || recommendationState.current?.taskKey !== taskKey) return;
      recommendationState.current = hydratedRecommendation;
      const recordTarget = document.querySelector('[data-recommendation-result]');
      if (recordTarget) recordTarget.innerHTML = renderRecommendationRecord(recommendationState.current);
    }
    target.innerHTML = renderAssistInteraction(payload);
    const interaction = responseRoot.interaction || {};
    if (document.querySelector('.judge-demo')) {
      const mode = interaction.status === 'generated' ? 'generated' : 'fallback';
      const plan = interaction.plan || interaction.output;
      judgeState.currentPlan = plan?.steps?.length ? plan : null;
      judgeState.currentPlanOptions = { mode, model: interaction.model || '' };
      const label = document.querySelector('[data-plan-mode]');
      if (label) label.textContent = interaction.status === 'generated' ? '(AI-assisted)' : '(deterministic fallback)';
      bindJudgePlanActions();
    }
    status.textContent = interaction.status === 'generated'
      ? 'Spark-generated adaptation returned; the deterministic record remains authoritative.'
      : 'Deterministic records loaded; adaptation unavailable.';
  } catch {
    const selectedTaskKey = document.querySelector('[data-recommendation-form] select')?.value;
    const judgeDemo = document.querySelector('.judge-demo');
    if (!judgeDemo && (selectedTaskKey !== taskKey || recommendationState.current?.taskKey !== taskKey)) return;
    if (judgeDemo && recommendationState.current) {
      setJudgePlan(deterministicJudgePlan(recommendationState.current), { mode: 'fallback' });
    } else {
      target.innerHTML = renderAssistInteraction({ interaction: { status: 'fallback' } });
    }
    if (document.querySelector('.judge-demo')) {
      const label = document.querySelector('[data-plan-mode]');
      if (label) label.textContent = '(deterministic fallback)';
    }
    status.textContent = 'Deterministic records loaded; adaptation unavailable.';
  } finally {
    const selectedTaskKey = document.querySelector('[data-recommendation-form] select')?.value;
    if ((document.querySelector('.judge-demo') || selectedTaskKey === taskKey) && recommendationState.current?.taskKey === taskKey) {
      button.disabled = false;
    }
  }
}

async function loadHomeTimeline() {
  const target = document.querySelector('[data-home-timeline]');
  if (!target) return;
  try {
    const payload = await fetchJson('/api/public/query', {
      method: 'POST',
      body: JSON.stringify({ query: DEFAULT_QUERY }),
    });
    target.innerHTML = renderTimelineFromFacts(normalizeQueryPayload(payload).facts);
  } catch {
    target.innerHTML = '<div class="error-state">Temporal records are temporarily unavailable.</div>';
  }
}

async function runQuery(form, { compact = false, timelineTarget = null, preserveReserve = false } = {}) {
  const resultTarget = document.querySelector(`#${CSS.escape(form.dataset.resultTarget)}`);
  const status = form.parentElement.querySelector('[data-query-status]') || form.nextElementSibling;
  const button = form.querySelector('button[type="submit"]');
  const query = form.elements.query.value.trim();
  if (!query) return;

  status.textContent = 'Retrieving public-safe memory...';
  button.disabled = true;
  resultTarget.innerHTML = '<div class="loading-state">Reading current facts and source paths from Postgres...</div>';
  try {
    const payload = await fetchJson('/api/public/query', {
      method: 'POST',
      body: JSON.stringify({ query }),
    });
    const normalized = normalizeQueryPayload(payload);
    resultTarget.innerHTML = renderQueryResult(payload, { compact });
    status.textContent = normalized.facts.length
      ? `${normalized.facts.length} fact record${normalized.facts.length === 1 ? '' : 's'} retrieved from the public corpus.`
      : 'Retrieval completed with no supporting facts.';
    if (timelineTarget) timelineTarget.innerHTML = renderTimelineFromFacts(normalized.facts);
    if (!preserveReserve) resultTarget.classList.remove('query-result-reserved');
  } catch (error) {
    resultTarget.innerHTML = `<div class="error-state"><h3>Memory retrieval is unavailable</h3><p>${escapeHtml(error.message)}</p></div>`;
    status.textContent = 'The query could not be completed.';
    if (timelineTarget) timelineTarget.innerHTML = '<div class="error-state">Temporal records are temporarily unavailable.</div>';
    if (!preserveReserve) resultTarget.classList.remove('query-result-reserved');
  } finally {
    button.disabled = false;
  }
}

async function loadCorpusInventory() {
  const target = document.querySelector('[data-corpus-inventory]');
  if (!target) return;
  try {
    const payload = await fetchJson('/api/public/corpus');
    const data = payload.data || payload;
    const counts = data.counts || data.inventory || data;
    const values = [
      ['threads', counts.threads ?? counts.thread_count],
      ['turns', counts.turns ?? counts.turn_count],
      ['observations', counts.observations ?? counts.observation_count],
      ['facts', counts.facts ?? counts.fact_count],
      ['summaries', counts.summaries ?? counts.summary_count],
      ['reflections', counts.reflections ?? counts.reflection_count],
    ].filter(([, value]) => value !== undefined && value !== null);
    target.textContent = `${values.map(([label, value]) => `${label} ${value}`).join(' | ')}${data.updated_at ? ` | updated ${formatDate(data.updated_at)}` : ''}`;
  } catch (error) {
    target.textContent = `Runtime inventory unavailable: ${error.message}`;
  }
}

let evidenceState = { type: 'facts', items: [], selectedId: '' };

async function loadEvidence(type = evidenceState.type) {
  const workspace = document.querySelector('[data-evidence-workspace]');
  if (!workspace) return;
  const list = workspace.querySelector('.evidence-list');
  const panel = workspace.querySelector('.provenance-panel');
  list.innerHTML = '<div class="loading-state">Loading public memory objects...</div>';
  panel.innerHTML = '<div class="loading-state">Waiting for a selected object...</div>';
  try {
    const apiType = {
      thread: 'thread',
      turns: 'turn',
      observations: 'observation',
      facts: 'fact',
      summary: 'summary',
      reflection: 'reflection',
    }[type] || 'all';
    const payload = await fetchJson(`/api/public/evidence?type=${encodeURIComponent(apiType)}`);
    const items = extractEvidenceItems(payload, type);
    evidenceState = {
      type,
      items,
      selectedId: selectedItemId(items[0] || {}, type),
    };
    list.innerHTML = renderEvidenceList(items, type, evidenceState.selectedId);
    panel.innerHTML = renderProvenancePanel(items[0], type);
    bindEvidenceRows();
  } catch (error) {
    list.innerHTML = `<div class="error-state"><h2>Evidence unavailable</h2><p>${escapeHtml(error.message)}</p></div>`;
    panel.innerHTML = '<div class="empty-state">No object selected.</div>';
  }
}

function selectEvidence(id) {
  evidenceState.selectedId = id;
  const item = evidenceState.items.find((candidate) => selectedItemId(candidate, evidenceState.type) === id);
  const list = document.querySelector('.evidence-list');
  const panel = document.querySelector('.provenance-panel');
  list.innerHTML = renderEvidenceList(evidenceState.items, evidenceState.type, id);
  panel.innerHTML = renderProvenancePanel(item, evidenceState.type);
  bindEvidenceRows();
}

function bindEvidenceRows() {
  document.querySelectorAll('[data-evidence-id]').forEach((element) => {
    element.addEventListener('click', () => selectEvidence(element.dataset.evidenceId));
    element.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectEvidence(element.dataset.evidenceId);
      }
    });
  });
}

function bindNavigation() {
  const path = window.location.pathname.replace(/\/$/, '') || '/';
  document.querySelectorAll('[data-nav-path]').forEach((link) => {
    const linkPath = link.dataset.navPath;
    if (linkPath === path) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });

  const button = document.querySelector('[data-menu-button]');
  const nav = document.querySelector('[data-navigation]');
  button?.addEventListener('click', () => {
    const open = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    nav.dataset.open = String(open);
  });
}

function bindQueryForms() {
  document.querySelectorAll('[data-query-form]').forEach((form) => {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      runQuery(form, {
        compact: window.location.pathname === '/',
        timelineTarget: document.querySelector('[data-home-timeline]'),
      });
    });
  });

  document.querySelectorAll('[data-example-query]').forEach((button) => {
    button.addEventListener('click', () => {
      const form = button.closest('section, .proof-band-inner')?.querySelector('[data-query-form]') || document.querySelector('[data-query-form]');
      if (!form) return;
      form.elements.query.value = button.dataset.exampleQuery;
      form.elements.query.focus();
    });
  });
}

function bindEvidenceTabs() {
  document.querySelectorAll('[data-evidence-type]').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('[data-evidence-type]').forEach((candidate) => {
        candidate.setAttribute('aria-selected', String(candidate === tab));
      });
      loadEvidence(tab.dataset.evidenceType);
    });
  });
}

function bindAssetFilters() {
  const form = document.querySelector('[data-asset-filters]');
  if (!form) return;
  form.addEventListener('change', () => applyAssetFilters());
  form.addEventListener('reset', () => {
    window.setTimeout(() => applyAssetFilters(), 0);
  });
}

function bindRecommendationForm() {
  const form = document.querySelector('[data-recommendation-form]');
  if (!form) return;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    runRecommendation(form.elements.task_key.value);
  });
  form.elements.task_key.addEventListener('change', () => {
    runRecommendation(form.elements.task_key.value);
  });
}

function bindAssistForm() {
  const form = document.querySelector('[data-assist-form]');
  if (!form) return;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    runAssist(form);
  });
}

function renderRoute() {
  const path = window.location.pathname.replace(/\/$/, '') || '/';
  document.body.classList.toggle('judge-demo-mode', path === '/demo');
  const routes = {
    '/': homePage,
    '/assets': assetsPage,
    '/demo': demoPage,
    '/method': methodPage,
    '/evidence': evidencePage,
  };
  const render = routes[path];
  if (!render) {
    document.title = 'Page not found | Organizational AI Memory';
    main.innerHTML = `<div class="page-shell">${pageIntro('Page not found', 'The requested route is not part of the public product surface.')}<a class="button" href="/">Return home</a></div>`;
    return;
  }

  document.title = `${path === '/' ? '' : `${PAGE_LABELS[path.slice(1)] || path.slice(1)} | `}Organizational AI Memory`;
  main.innerHTML = render();
  bindQueryForms();
  bindEvidenceTabs();
  bindAssetFilters();
  bindRecommendationForm();
  bindAssistForm();

  if (path === '/') {
    loadHomeCapabilityProof();
    loadHomeTimeline();
  }
  if (path === '/assets') {
    initializeAssetsPage();
  }
  if (path === '/demo') {
    initializeJudgeDemo();
  }
  if (path === '/evidence') {
    loadCorpusInventory();
    loadEvidence('facts');
  }
}

bindNavigation();
renderRoute();
