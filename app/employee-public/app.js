const mountPrefix = window.location.pathname === '/workspace'
  || window.location.pathname.startsWith('/workspace/')
  ? '/workspace'
  : '';
const API_BASE = `${mountPrefix}/api/v1`;

const app = document.querySelector('#employee-app');
const dialog = document.querySelector('[data-dialog]');
const dialogForm = document.querySelector('[data-dialog-form]');
const toastRegion = document.querySelector('[data-toast-region]');

let fragmentAccessToken = consumeFragmentAccessToken();

const VIEWS = new Set(['search', 'memory', 'profile', 'agent']);
const NAVIGATION = [
  ['search', 'Agent-visible memory', 'search'],
  ['memory', 'My memory', 'book-open'],
];

function consumeFragmentAccessToken() {
  const fragment = window.location.hash.replace(/^#/, '');
  if (!fragment.startsWith('access_token=')) return '';
  const parameters = new URLSearchParams(fragment);
  const token = parameters.get('access_token') || '';
  history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  return token;
}

const ui = {
  session: null,
  csrfToken: '',
  workspace: emptyWorkspace(),
  view: viewFromHash(),
  navOpen: false,
  loadingWorkspace: false,
  workspaceError: '',
  sessionError: '',
  memoryFilter: 'all',
  memorySearch: '',
  selectedMemoryId: '',
  agentQuery: '',
  agentResult: null,
  agentPending: false,
  agentError: '',
  profileSaving: false,
};

const ICON_PATHS = {
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  'book-open': '<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/>',
  library: '<path d="m16 6 4 14M12 6v14M8 8v12M4 4v16"/><path d="M2 20h20"/>',
  user: '<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/>',
  bot: '<rect width="16" height="12" x="4" y="8" rx="2"/><path d="M9 12h.01M15 12h.01M10 16h4M12 8V4M9 4h6M2 12h2M20 12h2"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  'log-out': '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  lock: '<rect width="16" height="12" x="4" y="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3z"/><path d="m9 12 2 2 4-4"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"/>',
  unshare: '<path d="m2 2 20 20M16.8 16.8A3 3 0 0 0 18 19M15.4 6.5l-6.8 4M8.6 13.5l2.9 1.7M18 2a3 3 0 0 1 2.1 5.1M6 9a3 3 0 1 0 0 6"/>',
  refresh: '<path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="m20 6-11 11-5-5"/>',
  alert: '<path d="M10.3 2.9 1.8 17a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 2.9a2 2 0 0 0-3.4 0ZM12 9v4M12 17h.01"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
};

function icon(name, size = 18) {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ICON_PATHS.file}</svg>`;
}

function emptyWorkspace() {
  return {
    actor: {},
    department: {},
    profile: {},
    agent: null,
    memories: [],
  };
}

function viewFromHash() {
  const value = window.location.hash.replace(/^#/, '');
  return VIEWS.has(value) ? value : 'search';
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function stringList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function parseLineList(value) {
  return stringList(String(value || ''));
}

function normalizeEvidence(value) {
  return asArray(value).filter((item) => (
    typeof item === 'string'
    || (item && typeof item === 'object' && !Array.isArray(item))
  ));
}

function evidenceLabel(value) {
  if (typeof value === 'string') return value;
  return Object.entries(value || {}).map(([key, item]) => `${humanize(key)}: ${item}`).join(' | ');
}

function evidenceEditorValue(values) {
  return normalizeEvidence(values).map((item) => (
    typeof item === 'string' ? item : JSON.stringify(item)
  )).join('\n');
}

function parseEvidenceLines(value) {
  return String(value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    if (!line.startsWith('{')) return line;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error('Evidence JSON lines must contain valid objects.');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Evidence JSON lines must contain objects.');
    }
    return parsed;
  });
}

function compact(value = '', length = 26) {
  const text = String(value || '');
  if (text.length <= length) return text;
  const left = Math.ceil((length - 1) / 2);
  return `${text.slice(0, left)}...${text.slice(-(length - left - 3))}`;
}

function humanize(value = '') {
  return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value, { short = false } = {}) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return String(value);
  const options = short
    ? { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }
    : { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' };
  return `${new Intl.DateTimeFormat('en', options).format(date)}${short ? '' : ' UTC'}`;
}

function initials(value = '') {
  const result = String(value).trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  return result || 'ME';
}

function inputValue(value) {
  return escapeHtml(value ?? '');
}

function envelope(payload) {
  return payload?.data ?? payload ?? {};
}

function errorMessage(error) {
  return error?.message || 'The request could not be completed.';
}

class ApiError extends Error {
  constructor(code, message, status, details = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function api(path, options = {}) {
  const method = options.method || 'GET';
  const headers = { accept: 'application/json', ...(options.headers || {}) };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (!['GET', 'HEAD'].includes(method) && ui.csrfToken) {
    headers['x-oam-csrf-token'] = ui.csrfToken;
  }
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = payload?.error || {};
    throw new ApiError(
      error.code || `http_${response.status}`,
      error.message || `Request failed (${response.status}).`,
      response.status,
      error.details || null,
    );
  }
  return payload;
}

function normalizeProfile(raw = {}) {
  return {
    id: raw.id || raw.profile_id || '',
    job_title: raw.job_title || '',
    role_summary: raw.role_summary || '',
    expertise: stringList(raw.expertise),
    working_style: raw.working_style || '',
    current_goals: stringList(raw.current_goals),
    boundaries: raw.boundaries || '',
    revision: Number(raw.revision ?? raw.version ?? 0),
    content_hash: raw.content_hash || raw.content_sha256 || raw.sha256 || '',
    visibility: raw.sharing_scope || 'owner_only',
    shared: raw.agent_shared === true || raw.sharing_scope === 'owner_and_personal_agent',
    updated_at: raw.updated_at || raw.created_at || '',
  };
}

function normalizeMemory(raw = {}) {
  const visibility = raw.visibility
    || raw.sharing_status
    || raw.sharing_scope
    || (raw.shared ? 'shared' : 'private');
  const shared = raw.shared === true
    || raw.is_shared === true
    || raw.agent_shared === true
    || ['shared', 'department', 'approved', 'owner_and_personal_agent'].includes(visibility);
  return {
    id: raw.id || raw.memory_id || '',
    memory_key: raw.memory_key || raw.key || '',
    memory_type: raw.memory_type || raw.type || 'experience',
    title: raw.title || 'Untitled memory',
    content: raw.content || '',
    context: raw.context || '',
    why_it_worked: raw.why_it_worked || '',
    evidence: normalizeEvidence(raw.evidence),
    tags: asArray(raw.tags),
    sensitivity: raw.sensitivity || 'private',
    visibility,
    shared,
    status: raw.status || (shared ? 'shared' : 'private'),
    version: Number(raw.version ?? raw.revision ?? 1),
    revision: Number(raw.revision ?? raw.version ?? 0),
    content_hash: raw.content_hash || raw.content_sha256 || raw.sha256 || '',
    created_at: raw.created_at || '',
    updated_at: raw.updated_at || raw.created_at || '',
  };
}

function normalizeWorkspace(payload) {
  const root = envelope(payload);
  const source = root.workspace || root;
  const currentSession = source.session || ui.session || {};
  return {
    actor: source.actor || source.employee || currentSession.actor || {},
    department: source.department || currentSession.department || {},
    profile: normalizeProfile(source.profile || {}),
    agent: source.agent || source.personal_agent || null,
    memories: asArray(source.memories || source.memory_items).map(normalizeMemory),
  };
}

function normalizeAgentResult(payload) {
  const root = envelope(payload);
  const source = root.agent_context || root.result || root;
  return {
    status: source.status || 'completed',
    answer: source.answer || source.response || source.summary || '',
    mode: source.mode || source.authority || '',
    model: source.model || '',
    citations: asArray(source.citations || source.sources || source.retrieved_items),
    query: source.query || ui.agentQuery,
    created_at: source.created_at || source.retrieved_at || '',
    audit_event_key: source.audit_event_key || source.audit_receipt || '',
    limitations: asArray(source.limitations),
  };
}

function actor() {
  return ui.workspace.actor || ui.session?.actor || {};
}

function actorName() {
  const current = actor();
  return current.display_name || current.name || current.email || current.principal_key || 'Employee';
}

function statusBadge(status, label = '') {
  const value = String(status || 'unknown').toLowerCase();
  const kind = ['active', 'approved', 'shared', 'current', 'ready', 'passed'].includes(value)
    ? 'good'
    : ['draft', 'pending', 'review_pending', 'processing'].includes(value)
      ? 'pending'
      : ['failed', 'suspended', 'rejected', 'revoked', 'denied'].includes(value)
        ? 'bad'
        : 'neutral';
  return `<span class="status-badge is-${kind}"><i></i>${escapeHtml(label || humanize(value))}</span>`;
}

function toast(message, kind = 'success') {
  const item = document.createElement('div');
  item.className = `toast is-${kind}`;
  item.innerHTML = `${icon(kind === 'success' ? 'check' : 'alert', 16)}<span>${escapeHtml(message)}</span>`;
  toastRegion.append(item);
  window.setTimeout(() => item.remove(), 4_500);
}

function renderLogin() {
  document.body.classList.remove('workspace-nav-open');
  const sessionError = ui.sessionError;
  app.innerHTML = `
    <main class="login-page" id="workspace-main">
      <section class="login-panel" aria-labelledby="login-title">
        <a class="login-brand" href="/" aria-label="Organizational AI Memory home">
          <span class="brand-mark" aria-hidden="true">OM</span>
          <span>Organizational AI Memory</span>
        </a>
        <div class="login-heading">
          <span class="login-symbol">${icon('bot', 24)}</span>
          <h1 id="login-title">Employee workspace</h1>
          <p>Sign in to your private organizational memory workspace.</p>
        </div>
        ${sessionError ? `<div class="inline-error" role="alert">${icon('alert', 17)}<span>${escapeHtml(sessionError)}</span></div>` : ''}
        <form data-login-form>
          <label>Workspace access token
            <input type="password" name="token" autocomplete="current-password" minlength="32" maxlength="128" pattern="[A-Za-z0-9_-]+" required autofocus />
          </label>
          <button class="primary-button" type="submit">Sign in ${icon('arrow', 16)}</button>
        </form>
      </section>
      <aside class="login-contract" aria-label="Personal Memory Agent contract">
        <div>
          <span class="contract-icon">${icon('shield', 24)}</span>
          <h2>Personal Memory Agent</h2>
          <p>Your agent supports your work within explicit access boundaries. It does not impersonate you.</p>
        </div>
        <dl>
          <div><dt>Personal memory</dt><dd>Private by default</dd></div>
          <div><dt>Agent memory access</dt><dd>Explicit per version</dd></div>
          <div><dt>Answers</dt><dd>Grounded with citations</dd></div>
        </dl>
      </aside>
    </main>
  `;
  app.querySelector('[data-login-form]').addEventListener('submit', handleLogin);
}

async function handleLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.innerHTML = `<span class="button-spinner" aria-hidden="true"></span>Signing in`;
  try {
    const data = envelope(await api('/session', {
      method: 'POST',
      body: { token: form.elements.token.value },
    }));
    ui.session = data.session || data;
    ui.csrfToken = data.csrf_token || '';
    ui.sessionError = '';
    form.reset();
    await refreshWorkspace();
    renderShell();
  } catch (error) {
    ui.sessionError = errorMessage(error);
    renderLogin();
  }
}

function renderShell() {
  if (!ui.session) return renderLogin();
  const currentActor = actor();
  const currentDepartment = ui.workspace.department || {};
  const agent = ui.workspace.agent;
  const mobileNavOpen = ui.navOpen && window.matchMedia('(max-width: 860px)').matches;
  document.body.classList.toggle('workspace-nav-open', mobileNavOpen);
  app.innerHTML = `
    <div class="workspace-shell">
      <header class="workspace-topbar">
        <button class="icon-button mobile-menu" type="button" data-toggle-nav aria-label="${mobileNavOpen ? 'Close' : 'Open'} navigation" aria-controls="workspace-navigation" aria-expanded="${mobileNavOpen}">${icon('menu')}</button>
        <a class="workspace-brand" href="#search" data-view-target="search"><span class="brand-mark" aria-hidden="true">OM</span><span>Organizational AI Memory</span></a>
        <div class="topbar-agent" aria-label="Personal Memory Agent status">
          <span>${icon('bot', 16)}</span>
          <span><strong>${escapeHtml(agent?.display_name || agent?.name || 'Personal Memory Agent')}</strong><small>${escapeHtml(humanize(agent?.status || 'not assigned'))}</small></span>
        </div>
        <div class="topbar-actions">
          <button class="identity-button" type="button" data-view-target="profile" aria-label="Open profile">
            <span class="avatar">${escapeHtml(initials(actorName()))}</span>
            <span><strong>${escapeHtml(actorName())}</strong><small>${escapeHtml(ui.workspace.profile.job_title || currentActor.membership_role || currentDepartment.display_name || 'Employee')}</small></span>
          </button>
          <button class="icon-button" type="button" data-logout aria-label="Sign out" title="Sign out">${icon('log-out')}</button>
        </div>
      </header>
      <div class="workspace-nav-backdrop" data-close-nav data-open="${mobileNavOpen}" aria-hidden="true"></div>
      <aside class="workspace-sidebar" id="workspace-navigation" data-open="${mobileNavOpen}" ${mobileNavOpen ? 'role="dialog" aria-modal="true" aria-label="Workspace navigation"' : ''}>
        <nav aria-label="Employee workspace">
          ${NAVIGATION.map(([key, label, iconName]) => `
            <button type="button" data-view-target="${key}" aria-current="${ui.view === key ? 'page' : 'false'}">${icon(iconName)}<span>${label}</span></button>
          `).join('')}
          <a href="/capabilities">${icon('library')}<span>Organizational capabilities</span></a>
        </nav>
        <button class="new-memory-button" type="button" data-new-memory>${icon('plus', 16)}<span>Add memory</span></button>
        <div class="sidebar-secondary">
          <button type="button" data-view-target="agent" aria-current="${ui.view === 'agent' ? 'page' : 'false'}">${icon('bot')}<span>Personal Memory Agent</span></button>
          <button type="button" data-view-target="profile" aria-current="${ui.view === 'profile' ? 'page' : 'false'}">${icon('user')}<span>Profile</span></button>
        </div>
        <div class="scope-footer">
          <span>Workspace scope</span>
          <strong>${escapeHtml(currentDepartment.display_name || currentDepartment.name || 'Assigned department')}</strong>
          <small>${escapeHtml(currentActor.email || currentActor.principal_key || '')}</small>
        </div>
      </aside>
      <main class="workspace-main" id="workspace-main" tabindex="-1" ${mobileNavOpen ? 'inert' : ''}>
        ${renderActiveView()}
      </main>
    </div>
  `;
  bindShellEvents();
}

function renderActiveView() {
  if (ui.loadingWorkspace && !ui.workspace.actor?.id && !ui.workspace.memories.length) {
    return `<section class="page-surface"><div class="loading-panel"><span class="spinner" aria-hidden="true"></span>Loading workspace...</div></section>`;
  }
  if (ui.workspaceError) {
    return `<section class="page-surface">${pageHeader('Workspace unavailable')}<div class="empty-panel is-error">${icon('alert', 24)}<strong>${escapeHtml(ui.workspaceError)}</strong><button class="secondary-button" type="button" data-refresh>${icon('refresh', 15)}Retry</button></div></section>`;
  }
  switch (ui.view) {
    case 'memory': return renderMemoryView();
    case 'profile': return renderProfileView();
    case 'agent': return renderAgentView();
    default: return renderSearchView();
  }
}

function pageHeader(title, description = '', actions = '') {
  return `<header class="page-header"><div><h1>${escapeHtml(title)}</h1>${description ? `<p>${escapeHtml(description)}</p>` : ''}</div>${actions ? `<div class="page-actions">${actions}</div>` : ''}</header>`;
}

function renderSearchView() {
  const result = ui.agentResult;
  return `
    <section class="page-surface search-page">
      ${pageHeader('Preview agent-visible memory', 'Search the current personal-memory versions your linked agent is allowed to retrieve.')}
      <div class="agent-contract-line">${icon('shield', 16)}<span>This preview uses the same governed personal-memory retrieval rules. It does not execute the physical agent process.</span></div>
      <form class="agent-query" data-agent-query-form>
        <label for="agent-query">Search terms</label>
        <div class="query-compose">
          <textarea id="agent-query" name="query" rows="3" maxlength="200" placeholder="Search shared experience, decisions, or patterns" required>${escapeHtml(ui.agentQuery)}</textarea>
          <button class="primary-button" type="submit" ${ui.agentPending ? 'disabled' : ''}>${ui.agentPending ? '<span class="button-spinner" aria-hidden="true"></span>Searching' : `${icon('search', 16)}Search scope`}</button>
        </div>
      </form>
      <div class="agent-response" aria-live="polite">
        ${ui.agentPending ? `<div class="loading-panel compact"><span class="spinner" aria-hidden="true"></span>Retrieving governed context...</div>` : ''}
        ${ui.agentError ? `<div class="inline-error">${icon('alert', 17)}<span>${escapeHtml(ui.agentError)}</span></div>` : ''}
        ${!ui.agentPending && !ui.agentError && result ? renderAgentResult(result) : ''}
        ${!ui.agentPending && !ui.agentError && !result ? `<div class="empty-panel quiet">${icon('search', 24)}<strong>No search yet</strong></div>` : ''}
      </div>
    </section>
  `;
}

function citationProjection(raw = {}, index) {
  const source = raw.source || raw.memory || raw.capability || raw;
  return {
    label: raw.label || raw.title || source.title || raw.memory_key || raw.asset_key || `Source ${index + 1}`,
    type: raw.type || raw.source_type || source.memory_type || source.asset_type || 'source',
    version: raw.version ?? source.version ?? source.revision ?? '',
    hash: raw.content_hash || raw.content_sha256 || raw.sha256
      || source.content_hash || source.content_sha256 || source.sha256 || '',
    excerpt: raw.excerpt || raw.snippet || source.excerpt || '',
    visibility: raw.visibility || source.visibility || '',
  };
}

function renderAgentResult(result) {
  if (result.status === 'no_match' || (!result.answer && !result.citations.length)) {
    return `<div class="empty-panel">${icon('search', 24)}<strong>No grounded memory matched this question.</strong></div>`;
  }
  const citations = result.citations.map(citationProjection);
  return `
    <article class="answer-surface">
      <header class="answer-header">
        <div><span class="answer-icon">${icon('bot', 19)}</span><h2>Authorized context</h2></div>
        <div>${result.mode ? statusBadge(result.mode) : ''}${result.created_at ? `<time>${escapeHtml(formatDate(result.created_at))}</time>` : ''}</div>
      </header>
      ${result.answer ? `<div class="answer-copy">${escapeHtml(result.answer).replaceAll('\n', '<br />')}</div>` : ''}
      ${result.limitations.length ? `<section class="answer-limitations"><strong>Limitations</strong><ul>${result.limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>` : ''}
      <section class="citation-section">
        <div class="section-heading"><h3>Citations</h3><span>${citations.length} source${citations.length === 1 ? '' : 's'}</span></div>
        ${citations.length ? `<ol class="citation-list">${citations.map((citation, index) => `
          <li>
            <span class="citation-index">${index + 1}</span>
            <div><strong>${escapeHtml(citation.label)}</strong><span>${escapeHtml(humanize(citation.type))}${citation.visibility ? ` | ${escapeHtml(humanize(citation.visibility))}` : ''}</span>${citation.excerpt ? `<q>${escapeHtml(citation.excerpt)}</q>` : ''}</div>
            <dl><div><dt>Version</dt><dd>${escapeHtml(String(citation.version || 'Not returned'))}</dd></div><div><dt>Hash</dt><dd title="${escapeHtml(citation.hash)}">${escapeHtml(citation.hash ? compact(citation.hash, 22) : 'Not returned')}</dd></div></dl>
          </li>
        `).join('')}</ol>` : `<div class="inline-warning">${icon('alert', 16)}No citations were returned with this response.</div>`}
        ${result.audit_event_key ? `<div class="audit-receipt"><span>Audit receipt</span><code title="${escapeHtml(result.audit_event_key)}">${escapeHtml(compact(result.audit_event_key, 30))}</code></div>` : ''}
      </section>
    </article>
  `;
}

function filteredMemories() {
  const query = ui.memorySearch.trim().toLowerCase();
  return ui.workspace.memories.filter((memory) => {
    const filterMatch = ui.memoryFilter === 'all'
      || (ui.memoryFilter === 'shared' && memory.shared)
      || (ui.memoryFilter === 'private' && !memory.shared);
    const searchMatch = !query || `${memory.title} ${memory.content} ${memory.context} ${memory.tags.join(' ')}`.toLowerCase().includes(query);
    return filterMatch && searchMatch;
  });
}

function renderMemoryView() {
  const memories = filteredMemories();
  const selected = ui.selectedMemoryId && ui.selectedMemoryId !== '__closed__'
    ? memories.find((item) => item.id === ui.selectedMemoryId) || null
    : null;
  const privateCount = ui.workspace.memories.filter((item) => !item.shared).length;
  const sharedCount = ui.workspace.memories.filter((item) => item.shared).length;
  return `
    <section class="page-surface memory-page ${selected ? 'has-inspector' : ''}">
      <div class="page-body">
        ${pageHeader('My memory', 'Versioned work knowledge owned by you.', `<button class="primary-button" type="button" data-new-memory>${icon('plus', 15)}Add memory</button>`)}
        <div class="memory-command-bar">
          <div class="view-tabs" role="tablist" aria-label="Memory visibility filters">
            ${[['all', 'All', ui.workspace.memories.length], ['private', 'Private', privateCount], ['shared', 'Agent access', sharedCount]].map(([key, label, count]) => `<button type="button" role="tab" aria-selected="${ui.memoryFilter === key}" data-memory-filter="${key}">${label}<span>${count}</span></button>`).join('')}
          </div>
          <label class="search-control">${icon('search', 16)}<span class="sr-only">Search my memory</span><input type="search" placeholder="Search memory" value="${escapeHtml(ui.memorySearch)}" data-memory-search /></label>
        </div>
        <div class="memory-list">
          ${memories.length ? memories.map((memory) => renderMemoryRow(memory, selected?.id === memory.id)).join('') : `<div class="empty-panel">${icon('book-open', 25)}<strong>${ui.workspace.memories.length ? 'No memory matches this view.' : 'No memory recorded yet.'}</strong>${!ui.workspace.memories.length ? '<button class="secondary-button" type="button" data-new-memory>Add memory</button>' : ''}</div>`}
        </div>
      </div>
      ${selected ? renderMemoryInspector(selected) : ''}
    </section>
  `;
}

function renderMemoryRow(memory, selected) {
  return `
    <button class="memory-row" type="button" data-memory-id="${escapeHtml(memory.id)}" data-selected="${selected}">
      <span class="memory-type-icon">${icon(memory.memory_type === 'decision' ? 'shield' : 'file', 17)}</span>
      <span class="memory-row-copy"><strong>${escapeHtml(memory.title)}</strong><small>${escapeHtml(humanize(memory.memory_type))}${memory.tags.length ? ` | ${escapeHtml(memory.tags.slice(0, 3).join(', '))}` : ''}</small></span>
      <span class="memory-row-state">${statusBadge(memory.shared ? 'shared' : 'private', memory.shared ? 'Agent access' : 'Private')}<small>v${escapeHtml(String(memory.version))}</small></span>
      <time>${escapeHtml(formatDate(memory.updated_at, { short: true }))}</time>
      ${icon('chevron', 16)}
    </button>
  `;
}

function renderMemoryInspector(memory) {
  return `
    <aside class="memory-inspector" aria-label="Selected memory detail">
      <header>
        <div>${statusBadge(memory.shared ? 'shared' : 'private', memory.shared ? 'Agent access' : 'Private')}<h2>${escapeHtml(memory.title)}</h2><p>${escapeHtml(humanize(memory.memory_type))}</p></div>
        <button class="icon-button" type="button" data-close-memory aria-label="Close memory detail">${icon('x')}</button>
      </header>
      <div class="memory-inspector-actions">
        <button class="secondary-button" type="button" data-edit-memory="${escapeHtml(memory.id)}">${icon('edit', 15)}Edit current version</button>
        ${memory.sensitivity === 'restricted'
          ? `<span class="memory-access-boundary">${icon('lock', 15)}Restricted: owner only</span>`
          : memory.shared
          ? `<button class="secondary-button" type="button" data-unshare-memory="${escapeHtml(memory.id)}">${icon('unshare', 15)}Remove agent access</button>`
          : `<button class="primary-button" type="button" data-share-memory="${escapeHtml(memory.id)}">${icon('share', 15)}Allow agent access</button>`}
      </div>
      <section class="memory-detail-section"><h3>Memory</h3><p>${escapeHtml(memory.content).replaceAll('\n', '<br />') || '<span class="not-recorded">Not recorded</span>'}</p></section>
      <section class="memory-detail-section"><h3>Context</h3><p>${escapeHtml(memory.context).replaceAll('\n', '<br />') || '<span class="not-recorded">Not recorded</span>'}</p></section>
      <section class="memory-detail-section"><h3>Why it worked</h3><p>${escapeHtml(memory.why_it_worked).replaceAll('\n', '<br />') || '<span class="not-recorded">Not recorded</span>'}</p></section>
      <section class="memory-detail-section"><h3>Evidence</h3><p>${memory.evidence.length ? memory.evidence.map((item) => escapeHtml(evidenceLabel(item))).join('<br />') : '<span class="not-recorded">Not recorded</span>'}</p></section>
      ${memory.tags.length ? `<section class="memory-detail-section"><h3>Tags</h3><div class="tag-list">${memory.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div></section>` : ''}
      <section class="memory-ledger"><h3>Version record</h3><dl><div><dt>Version</dt><dd>${escapeHtml(String(memory.version))}</dd></div><div><dt>Sensitivity</dt><dd>${escapeHtml(humanize(memory.sensitivity))}</dd></div><div><dt>Updated</dt><dd>${escapeHtml(formatDate(memory.updated_at))}</dd></div><div><dt>Content hash</dt><dd title="${escapeHtml(memory.content_hash)}">${escapeHtml(memory.content_hash ? compact(memory.content_hash, 30) : 'Not returned')}</dd></div></dl></section>
    </aside>
  `;
}

function renderProfileView() {
  const profile = ui.workspace.profile;
  const currentActor = actor();
  const department = ui.workspace.department || {};
  return `
    <section class="page-surface profile-page">
      ${pageHeader('Work profile', 'Private, self-authored work context with its own immutable revision record.')}
      <section class="identity-strip" aria-label="Application identity">
        <span class="avatar large">${escapeHtml(initials(actorName()))}</span>
        <div><strong>${escapeHtml(actorName())}</strong><span>${escapeHtml(profile.job_title || 'Employee')}</span></div>
        <dl><div><dt>Department</dt><dd>${escapeHtml(department.display_name || department.name || 'Not returned')}</dd></div><div><dt>Membership</dt><dd>${escapeHtml(humanize(currentActor.membership_role || 'member'))}</dd></div></dl>
      </section>
      <form class="profile-form" data-profile-form>
        <input type="hidden" name="expected_revision" value="${escapeHtml(String(profile.revision))}" />
        <div class="form-grid">
          <label>Job title<input name="job_title" maxlength="160" value="${inputValue(profile.job_title)}" /></label>
          <label class="full">Role summary<textarea name="role_summary" rows="4" maxlength="2000">${escapeHtml(profile.role_summary)}</textarea></label>
          <label class="full">Expertise, one item per line<textarea name="expertise" rows="4" maxlength="3000">${escapeHtml(profile.expertise.join('\n'))}</textarea></label>
          <label class="full">Working style<textarea name="working_style" rows="4" maxlength="2000">${escapeHtml(profile.working_style)}</textarea></label>
          <label class="full">Current goals, one item per line<textarea name="current_goals" rows="4" maxlength="3000">${escapeHtml(profile.current_goals.join('\n'))}</textarea></label>
          <label class="full">Working constraints<textarea name="boundaries" rows="4" maxlength="2000">${escapeHtml(profile.boundaries)}</textarea></label>
        </div>
        <footer class="form-footer"><span>${profile.updated_at ? `Updated ${escapeHtml(formatDate(profile.updated_at))} | revision ${escapeHtml(String(profile.revision))}` : 'No profile version recorded.'}${profile.content_hash ? ` | SHA-256 ${escapeHtml(compact(profile.content_hash, 20))}` : ''}</span><button class="primary-button" type="submit" ${ui.profileSaving ? 'disabled' : ''}>${ui.profileSaving ? '<span class="button-spinner" aria-hidden="true"></span>Saving' : 'Save profile'}</button></footer>
        <div class="form-error" role="alert" data-profile-error hidden></div>
      </form>
      <section class="profile-consent" aria-label="Profile access">
        <div>
          ${statusBadge(profile.shared ? 'shared' : 'private', profile.shared ? 'Agent access' : 'Owner only')}
          <h2>Personal Memory Agent access</h2>
          <p>Profile access is explicit and bound to the current immutable revision.</p>
        </div>
        <dl>
          <div><dt>Revision</dt><dd>v${escapeHtml(String(profile.revision))}</dd></div>
          <div><dt>SHA-256</dt><dd title="${escapeHtml(profile.content_hash)}">${escapeHtml(profile.content_hash ? compact(profile.content_hash, 24) : 'Not returned')}</dd></div>
        </dl>
        <button class="${profile.shared ? 'secondary-button' : 'primary-button'}" type="button" data-${profile.shared ? 'unshare' : 'share'}-profile>${icon(profile.shared ? 'unshare' : 'share', 15)}${profile.shared ? 'Remove agent access' : 'Allow agent access'}</button>
      </section>
    </section>
  `;
}

function renderAgentView() {
  const agent = ui.workspace.agent;
  if (!agent) {
    return `<section class="page-surface agent-page">${pageHeader('Personal Memory Agent')}<div class="empty-panel">${icon('bot', 25)}<strong>No Personal Memory Agent is assigned to this workspace.</strong></div></section>`;
  }
  const sharedMemoryCount = ui.workspace.memories.filter((memory) => memory.shared).length;
  const visibleSourceCount = sharedMemoryCount + (ui.workspace.profile.shared ? 1 : 0);
  const ownerOnlyCount = ui.workspace.memories.length - sharedMemoryCount + (ui.workspace.profile.shared ? 0 : 1);
  const restrictedCount = ui.workspace.memories.filter((memory) => memory.sensitivity === 'restricted').length;
  return `
    <section class="page-surface agent-page">
      ${pageHeader('Personal Memory Agent', 'A separate agent principal linked one-to-one with your employee identity.', `<button class="primary-button" type="button" data-view-target="search">${icon('search', 15)}Preview visible memory</button>`)}
      <div class="agent-contract-line prominent">${icon('shield', 18)}<div><strong>Support, not impersonation</strong><span>The agent has its own identity and cannot act as your human principal.</span></div></div>
      <section class="agent-identity">
        <span class="agent-avatar">${icon('bot', 24)}</span>
        <div><h2>${escapeHtml(agent.display_name || agent.name || 'Personal Memory Agent')}</h2><p>${escapeHtml(agent.principal_key || agent.id || '')}</p></div>
        ${statusBadge(agent.status || 'unknown')}
      </section>
      <div class="agent-boundary-grid">
        <section><span>Agent-visible sources</span><strong>${visibleSourceCount}</strong><small>Current explicitly shared versions</small></section>
        <section><span>Owner-only sources</span><strong>${ownerOnlyCount}</strong><small>Excluded from agent retrieval</small></section>
        <section><span>Restricted memory</span><strong>${restrictedCount}</strong><small>Always owner only</small></section>
        <section><span>Pair status</span><strong>${escapeHtml(humanize(agent.pair_status || 'active'))}</strong><small>One human, one agent</small></section>
      </div>
      <section class="agent-boundary-ledger">
        <div>${icon('check', 16)}<span><strong>Allowed</strong> Current profile and personal-memory versions you explicitly share.</span></div>
        <div>${icon('lock', 16)}<span><strong>Excluded</strong> Owner-only, restricted, historical, and organizational memory.</span></div>
        <div>${icon('shield', 16)}<span><strong>Authority</strong> Agent access is brokered; direct PostgreSQL authority is not granted.</span></div>
      </section>
    </section>
  `;
}

function setView(view) {
  if (!VIEWS.has(view)) return;
  ui.view = view;
  ui.navOpen = false;
  if (window.location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`);
  renderShell();
  requestAnimationFrame(() => document.querySelector('#workspace-main')?.focus());
}

function setMobileNavigation(open, { returnFocus = false } = {}) {
  ui.navOpen = open;
  renderShell();
  requestAnimationFrame(() => {
    if (open) document.querySelector('.workspace-sidebar button')?.focus();
    else if (returnFocus) document.querySelector('[data-toggle-nav]')?.focus();
  });
}

function bindShellEvents() {
  app.querySelector('[data-toggle-nav]')?.addEventListener('click', () => setMobileNavigation(!ui.navOpen, { returnFocus: ui.navOpen }));
  app.querySelector('[data-close-nav]')?.addEventListener('click', () => setMobileNavigation(false, { returnFocus: true }));
  app.querySelectorAll('[data-view-target]').forEach((control) => control.addEventListener('click', (event) => {
    event.preventDefault();
    setView(control.dataset.viewTarget);
  }));
  app.querySelector('[data-logout]')?.addEventListener('click', logout);
  app.querySelectorAll('[data-refresh]').forEach((button) => button.addEventListener('click', async () => {
    await refreshWorkspace();
    renderShell();
  }));
  app.querySelectorAll('[data-new-memory]').forEach((button) => button.addEventListener('click', () => openMemoryDialog()));
  app.querySelector('[data-agent-query-form]')?.addEventListener('submit', askAgent);
  app.querySelector('[data-profile-form]')?.addEventListener('submit', saveProfile);
  app.querySelector('[data-share-profile]')?.addEventListener('click', () => openProfileShareDialog(true));
  app.querySelector('[data-unshare-profile]')?.addEventListener('click', () => openProfileShareDialog(false));
  app.querySelectorAll('[data-memory-filter]').forEach((button) => button.addEventListener('click', () => {
    ui.memoryFilter = button.dataset.memoryFilter;
    ui.selectedMemoryId = '';
    renderShell();
  }));
  app.querySelector('[data-memory-search]')?.addEventListener('input', (event) => {
    ui.memorySearch = event.target.value;
    const caret = event.target.selectionStart;
    renderShell();
    const input = app.querySelector('[data-memory-search]');
    input?.focus();
    input?.setSelectionRange(caret, caret);
  });
  app.querySelectorAll('[data-memory-id]').forEach((button) => button.addEventListener('click', () => {
    ui.selectedMemoryId = button.dataset.memoryId;
    renderShell();
  }));
  app.querySelector('[data-close-memory]')?.addEventListener('click', () => {
    ui.selectedMemoryId = '__closed__';
    renderShell();
  });
  app.querySelectorAll('[data-edit-memory]').forEach((button) => button.addEventListener('click', () => {
    openMemoryDialog(ui.workspace.memories.find((item) => item.id === button.dataset.editMemory));
  }));
  app.querySelectorAll('[data-share-memory]').forEach((button) => button.addEventListener('click', () => openShareDialog(button.dataset.shareMemory, true)));
  app.querySelectorAll('[data-unshare-memory]').forEach((button) => button.addEventListener('click', () => openShareDialog(button.dataset.unshareMemory, false)));
}

async function askAgent(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const query = form.elements.query.value.trim();
  if (!query) return;
  ui.agentQuery = query;
  ui.agentPending = true;
  ui.agentError = '';
  ui.agentResult = null;
  renderShell();
  try {
    ui.agentResult = normalizeAgentResult(await api('/agent-context', {
      method: 'POST',
      body: { query },
    }));
    await refreshWorkspace({ preserveError: true });
  } catch (error) {
    ui.agentError = errorMessage(error);
  } finally {
    ui.agentPending = false;
    renderShell();
  }
}

async function saveProfile(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const accessWasShared = ui.workspace.profile.shared;
  const errorTarget = form.querySelector('[data-profile-error]');
  ui.profileSaving = true;
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  submit.innerHTML = '<span class="button-spinner" aria-hidden="true"></span>Saving';
  errorTarget.hidden = true;
  try {
    await api('/profile', {
      method: 'PUT',
      body: {
        job_title: form.elements.job_title.value.trim(),
        role_summary: form.elements.role_summary.value.trim(),
        expertise: parseLineList(form.elements.expertise.value),
        working_style: form.elements.working_style.value.trim(),
        current_goals: parseLineList(form.elements.current_goals.value),
        boundaries: form.elements.boundaries.value.trim(),
        expected_revision: Number(form.elements.expected_revision.value),
      },
    });
    await refreshWorkspace();
    ui.profileSaving = false;
    toast(accessWasShared
      ? 'New private profile revision saved; agent access reset.'
      : 'Private profile saved as a new revision.');
    renderShell();
  } catch (error) {
    ui.profileSaving = false;
    errorTarget.textContent = error.status === 409
      ? 'This profile changed in another session. Reload the workspace before saving again.'
      : errorMessage(error);
    errorTarget.hidden = false;
    submit.disabled = false;
    submit.textContent = 'Save profile';
  }
}

function dialogHeading(title, description = '') {
  return `<header class="dialog-header"><div><h2 id="dialog-title">${escapeHtml(title)}</h2>${description ? `<p>${escapeHtml(description)}</p>` : ''}</div><button class="icon-button" type="button" data-close-dialog aria-label="Close dialog">${icon('x')}</button></header>`;
}

function dialogActions(label, { danger = false } = {}) {
  return `<footer class="dialog-actions"><button class="secondary-button" type="button" data-close-dialog>Cancel</button><button class="${danger ? 'danger-button' : 'primary-button'}" type="submit" value="confirm">${escapeHtml(label)}</button></footer><div class="form-error" role="alert" data-dialog-error hidden></div>`;
}

function openMemoryDialog(memory = null) {
  const editing = Boolean(memory);
  dialogForm.innerHTML = `
    ${dialogHeading(editing ? 'Edit current memory' : 'Add memory', editing ? 'Saving creates the next immutable version.' : 'New memory is private until you explicitly grant your agent access.')}
    <input type="hidden" name="action" value="${editing ? 'update-memory' : 'create-memory'}" />
    <input type="hidden" name="memory_id" value="${escapeHtml(memory?.id || '')}" />
    <input type="hidden" name="expected_revision" value="${escapeHtml(String(memory?.revision ?? 0))}" />
    <div class="form-grid dialog-fields">
      <label>Memory type<select name="type"><option value="experience" ${memory?.memory_type === 'experience' ? 'selected' : ''}>Experience</option><option value="lesson" ${memory?.memory_type === 'lesson' ? 'selected' : ''}>Lesson learned</option><option value="preference" ${memory?.memory_type === 'preference' ? 'selected' : ''}>Preference</option><option value="skill" ${memory?.memory_type === 'skill' ? 'selected' : ''}>Skill</option><option value="decision" ${memory?.memory_type === 'decision' ? 'selected' : ''}>Decision</option><option value="pattern" ${memory?.memory_type === 'pattern' ? 'selected' : ''}>Pattern</option></select></label>
      <label>Sensitivity<select name="sensitivity"><option value="private" ${memory?.sensitivity !== 'restricted' ? 'selected' : ''}>Personal, agent-shareable</option><option value="restricted" ${memory?.sensitivity === 'restricted' ? 'selected' : ''}>Restricted, owner only</option></select></label>
      <label class="full">Title<input name="title" maxlength="200" value="${inputValue(memory?.title)}" required /></label>
      <label class="full">Memory content<textarea name="content" rows="6" maxlength="12000" required>${escapeHtml(memory?.content || '')}</textarea></label>
      <label class="full">Context<textarea name="context" rows="4" maxlength="4000">${escapeHtml(memory?.context || '')}</textarea></label>
      <label class="full">Why it worked<textarea name="why_it_worked" rows="4" maxlength="4000">${escapeHtml(memory?.why_it_worked || '')}</textarea></label>
      <label class="full">Evidence, one item or JSON object per line<textarea name="evidence" rows="4" maxlength="12000">${escapeHtml(evidenceEditorValue(memory?.evidence || []))}</textarea></label>
      <label class="full">Tags, up to 16<input name="tags" maxlength="500" value="${inputValue(memory?.tags?.join(', '))}" placeholder="Comma-separated" /></label>
    </div>
    <div class="privacy-note">${icon('lock', 16)}<span>Saving does not grant agent access. Access is a separate action bound to the current revision.</span></div>
    ${dialogActions(editing ? 'Save new version' : 'Save private memory')}
  `;
  bindDialog('memory');
}

function openShareDialog(memoryId, sharing) {
  const memory = ui.workspace.memories.find((item) => item.id === memoryId);
  if (!memory) return;
  if (sharing && memory.sensitivity === 'restricted') {
    toast('Restricted memory remains owner only.', 'error');
    return;
  }
  const nextRevision = memory.revision + 1;
  dialogForm.innerHTML = `
    ${dialogHeading(sharing ? 'Allow Personal Memory Agent access' : 'Remove Personal Memory Agent access', `This access change creates v${nextRevision} with the same content hash. ${sharing ? 'Only that new current version becomes agent-visible; organizational memory is unchanged.' : 'The new current version becomes owner only.'}`)}
    <input type="hidden" name="action" value="${sharing ? 'share-memory' : 'unshare-memory'}" />
    <input type="hidden" name="memory_id" value="${escapeHtml(memory.id)}" />
    <input type="hidden" name="expected_revision" value="${escapeHtml(String(memory.revision))}" />
    <div class="confirmation-ledger"><span>Memory<strong>${escapeHtml(memory.title)}</strong></span><span>Revision<strong>v${escapeHtml(String(memory.version))} -> v${escapeHtml(String(nextRevision))}</strong></span><span>Content hash<code title="${escapeHtml(memory.content_hash)}">${escapeHtml(memory.content_hash ? compact(memory.content_hash, 28) : 'Not returned')}</code></span></div>
    ${sharing ? `<div class="privacy-note">${icon('share', 16)}<span>This explicit action grants only your linked Personal Memory Agent access to v${escapeHtml(String(nextRevision))}.</span></div>` : ''}
    ${dialogActions(sharing ? 'Allow agent access' : 'Remove agent access', { danger: !sharing })}
  `;
  bindDialog('share');
}

function openProfileShareDialog(sharing) {
  const profile = ui.workspace.profile;
  const nextRevision = profile.revision + 1;
  dialogForm.innerHTML = `
    ${dialogHeading(sharing ? 'Allow profile access' : 'Remove profile access', `This access change creates profile v${nextRevision} with the same content hash. ${sharing ? 'Only the linked Personal Memory Agent can retrieve that new current version.' : 'The new current version becomes owner only.'}`)}
    <input type="hidden" name="action" value="${sharing ? 'share-profile' : 'unshare-profile'}" />
    <input type="hidden" name="expected_revision" value="${escapeHtml(String(profile.revision))}" />
    <div class="confirmation-ledger"><span>Profile<strong>${escapeHtml(profile.job_title || 'Employee profile')}</strong></span><span>Revision<strong>v${escapeHtml(String(profile.revision))} -> v${escapeHtml(String(nextRevision))}</strong></span><span>Content hash<code title="${escapeHtml(profile.content_hash)}">${escapeHtml(profile.content_hash ? compact(profile.content_hash, 28) : 'Not returned')}</code></span></div>
    ${sharing ? `<div class="privacy-note">${icon('share', 16)}<span>This explicit action grants only your linked Personal Memory Agent access to profile v${escapeHtml(String(nextRevision))}.</span></div>` : ''}
    ${dialogActions(sharing ? 'Allow agent access' : 'Remove agent access', { danger: !sharing })}
  `;
  bindDialog('profile-share');
}

function bindDialog(kind) {
  dialogForm.dataset.dialogKind = kind;
  dialogForm.onsubmit = handleDialogSubmit;
  dialogForm.querySelectorAll('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => dialog.close()));
  dialog.showModal();
  window.setTimeout(() => dialogForm.querySelector('input:not([type="hidden"]), select, textarea')?.focus());
}

function memoryPayload(form) {
  const tags = form.elements.tags.value.split(',').map((value) => value.trim()).filter(Boolean);
  if (tags.length > 16) throw new Error('Use no more than 16 tags.');
  return {
    type: form.elements.type.value,
    title: form.elements.title.value.trim(),
    content: form.elements.content.value.trim(),
    context: form.elements.context.value.trim(),
    why_it_worked: form.elements.why_it_worked.value.trim(),
    evidence: parseEvidenceLines(form.elements.evidence.value),
    tags,
    sensitivity: form.elements.sensitivity.value,
  };
}

async function handleDialogSubmit(event) {
  event.preventDefault();
  if (event.submitter?.value === 'cancel') {
    dialog.close();
    return;
  }
  const action = dialogForm.elements.action.value;
  const errorTarget = dialogForm.querySelector('[data-dialog-error]');
  const confirm = dialogForm.querySelector('[value="confirm"]');
  const confirmLabel = confirm.textContent;
  const previousMemory = ui.workspace.memories.find((memory) => (
    memory.id === dialogForm.elements.memory_id?.value
  ));
  confirm.disabled = true;
  confirm.innerHTML = '<span class="button-spinner" aria-hidden="true"></span>Saving';
  errorTarget.hidden = true;
  try {
    if (action === 'create-memory') {
      await api('/memories', { method: 'POST', body: memoryPayload(dialogForm) });
    } else if (action === 'update-memory') {
      const body = {
        ...memoryPayload(dialogForm),
        expected_revision: Number(dialogForm.elements.expected_revision.value),
      };
      await api(`/memories/${encodeURIComponent(dialogForm.elements.memory_id.value)}`, { method: 'PUT', body });
    } else if (action === 'share-memory' || action === 'unshare-memory') {
      const endpoint = action === 'share-memory' ? 'share' : 'unshare';
      await api(`/memories/${encodeURIComponent(dialogForm.elements.memory_id.value)}/${endpoint}`, {
        method: 'POST',
        body: { expected_revision: Number(dialogForm.elements.expected_revision.value) },
      });
    } else if (action === 'share-profile' || action === 'unshare-profile') {
      const endpoint = action === 'share-profile' ? 'share' : 'unshare';
      await api(`/profile/${endpoint}`, {
        method: 'POST',
        body: { expected_revision: Number(dialogForm.elements.expected_revision.value) },
      });
    }
    await refreshWorkspace();
    dialog.close();
    toast(action === 'create-memory'
      ? 'Private memory saved.'
      : action === 'update-memory'
        ? previousMemory?.shared
          ? 'New private version saved; agent access reset.'
          : 'New private memory version saved.'
        : action === 'share-memory'
          ? 'Personal Memory Agent access granted in a new revision.'
          : action === 'unshare-memory'
            ? 'Personal Memory Agent access removed in a new revision.'
            : action === 'share-profile'
              ? 'Profile access granted in a new revision.'
              : 'Profile access removed in a new revision.');
    renderShell();
  } catch (error) {
    errorTarget.textContent = error.status === 409
      ? 'This record changed in another session. Close this dialog and reload the latest version.'
      : errorMessage(error);
    errorTarget.hidden = false;
    confirm.disabled = false;
    confirm.textContent = confirmLabel;
  }
}

async function refreshWorkspace({ preserveError = false } = {}) {
  ui.loadingWorkspace = true;
  if (!preserveError) ui.workspaceError = '';
  try {
    ui.workspace = normalizeWorkspace(await api('/workspace'));
    if (!ui.selectedMemoryId && ui.workspace.memories.length) ui.selectedMemoryId = ui.workspace.memories[0].id;
  } catch (error) {
    if (error.status === 401) {
      ui.session = null;
      ui.csrfToken = '';
      ui.sessionError = 'Your workspace session expired. Sign in again.';
    } else if (!preserveError) {
      ui.workspaceError = errorMessage(error);
    }
  } finally {
    ui.loadingWorkspace = false;
  }
}

async function logout() {
  try {
    await api('/session', { method: 'DELETE' });
  } catch {
    // Clear local state even if the server-side session already expired.
  }
  ui.session = null;
  ui.csrfToken = '';
  ui.workspace = emptyWorkspace();
  ui.agentResult = null;
  ui.agentQuery = '';
  ui.navOpen = false;
  renderLogin();
}

async function restoreSession() {
  if (fragmentAccessToken) {
    let token = fragmentAccessToken;
    fragmentAccessToken = '';
    try {
      const data = envelope(await api('/session', {
        method: 'POST',
        body: { token },
      }));
      ui.session = data.session || data;
      ui.csrfToken = data.csrf_token || '';
      await refreshWorkspace();
      if (ui.session) renderShell();
      else renderLogin();
    } catch (error) {
      ui.session = null;
      ui.csrfToken = '';
      ui.sessionError = errorMessage(error);
      renderLogin();
    } finally {
      token = '';
    }
    return;
  }
  try {
    const data = envelope(await api('/session'));
    ui.session = data.session || data;
    ui.csrfToken = data.csrf_token || '';
    await refreshWorkspace();
    if (ui.session) renderShell();
    else renderLogin();
  } catch (error) {
    ui.session = null;
    ui.csrfToken = '';
    if (error.status !== 401) ui.sessionError = errorMessage(error);
    renderLogin();
  }
}

function handleNavigationKeydown(event) {
  if (event.key === 'Escape' && ui.navOpen) {
    event.preventDefault();
    setMobileNavigation(false, { returnFocus: true });
    return;
  }
  if (event.key !== 'Tab' || !ui.navOpen || !window.matchMedia('(max-width: 860px)').matches) return;
  const sidebar = app.querySelector('.workspace-sidebar');
  const items = [...sidebar.querySelectorAll('button:not(:disabled), a[href]')];
  if (!items.length) return;
  const first = items[0];
  const last = items.at(-1);
  if (!sidebar.contains(document.activeElement)) {
    event.preventDefault();
    first.focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function handleResize() {
  if (ui.navOpen && !window.matchMedia('(max-width: 860px)').matches) {
    ui.navOpen = false;
    renderShell();
  }
}

window.addEventListener('hashchange', () => {
  const view = viewFromHash();
  if (view !== ui.view) {
    ui.view = view;
    if (ui.session) renderShell();
  }
});
window.addEventListener('resize', handleResize);
document.addEventListener('keydown', handleNavigationKeydown);
dialog.addEventListener('cancel', () => { dialogForm.onsubmit = null; });

restoreSession();
