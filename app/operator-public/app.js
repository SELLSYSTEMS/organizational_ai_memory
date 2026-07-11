import { filterProvisioningJobs } from './provisioning-filter.js';
import {
  filterPrincipals,
  isOperationalPrincipal,
  principalFilterCounts,
} from './principal-filter.js';

const mountPrefix = window.location.pathname === '/architect'
  || window.location.pathname.startsWith('/architect/')
  ? '/architect'
  : '';
const API_BASE = `${mountPrefix}/api/v1`;

const app = document.querySelector('#operator-app');
const dialog = document.querySelector('[data-dialog]');
const dialogForm = document.querySelector('[data-dialog-form]');
const toastRegion = document.querySelector('[data-toast-region]');

const ui = {
  session: null,
  csrfToken: '',
  state: emptyState(),
  candidates: [],
  audit: [],
  view: 'principals',
  selectedPrincipalId: '',
  selectedJobId: '',
  selectedCandidateId: '',
  candidateFilter: 'actionable',
  principalTab: 'application',
  principalFilter: 'operational',
  provisioningFilter: 'current',
  principalHistoryOpen: false,
  provisioningHistoryOpen: false,
  principalSearch: '',
  effectiveAccess: null,
  effectiveAccessError: '',
  lastUpload: null,
  loadErrors: {},
  navOpen: false,
};

const NAVIGATION = [
  ['overview', 'Overview', 'layout-dashboard'],
  ['principals', 'People & agents', 'users'],
  ['provisioning', 'Provisioning', 'clipboard-list'],
  ['effective-access', 'Effective access', 'shield-check'],
  ['access-proofs', 'Access proofs', 'list-checks'],
  ['quarantine', 'Quarantine', 'bug'],
  ['candidate-review', 'Candidate review', 'user-check'],
  ['policy-templates', 'Policy templates', 'file-text'],
  ['audit', 'Audit', 'list'],
];

const ICON_PATHS = {
  'layout-dashboard': '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  'clipboard-list': '<rect width="16" height="18" x="4" y="3" rx="2"/><path d="M9 3V1h6v2M8 11h8M8 15h6M8 7h2"/>',
  'shield-check': '<path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3z"/><path d="m9 12 2 2 4-4"/>',
  'list-checks': '<path d="m3 5 2 2 4-4M3 12l2 2 4-4M3 19l2 2 4-4M13 6h8M13 13h8M13 20h8"/>',
  bug: '<path d="m8 2 1.88 1.88M14.12 3.88 16 2M9 7.13v-1a3 3 0 0 1 6 0v1M12 20c-4 0-6-3-6-7V9a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v4c0 4-2 7-6 7ZM2 13h4M18 13h4M4.93 4.93 8 8M16 8l3.07-3.07M4.93 21.07 8 18M16 18l3.07 3.07"/>',
  'user-check': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m16 11 2 2 4-4"/>',
  'file-text': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8M8 9h2"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 1 1 5.8 1c0 2-3 2-3 4M12 18h.01"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/>',
  'log-out': '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  'user-plus': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.07.07l2-2a5 5 0 0 0-7.07-7.07l-1.15 1.15M14 11a5 5 0 0 0-7.07-.07l-2 2A5 5 0 0 0 12 20l1.15-1.15"/>',
  play: '<path d="m5 3 14 9-14 9z"/>',
  pause: '<circle cx="12" cy="12" r="10"/><path d="M10 9v6M14 9v6"/>',
  filter: '<path d="M4 4h16l-6 7v5l-4 2v-7z"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'external-link': '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  refresh: '<path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5"/>',
  lock: '<rect width="16" height="12" x="4" y="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  check: '<path d="m20 6-11 11-5-5"/>',
  alert: '<path d="M10.3 2.9 1.8 17a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 2.9a2 2 0 0 0-3.4 0ZM12 9v4M12 17h.01"/>',
};

function icon(name, size = 18) {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ICON_PATHS.file}</svg>`;
}

function emptyState() {
  return {
    principals: [],
    departments: [],
    memberships: [],
    runtime_bindings: [],
    broker_credentials: [],
    capability_grants: [],
    employee_personal_agents: [],
    provisioning_jobs: [],
    proof_runs: [],
    uploads: [],
  };
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

function humanize(value = '') {
  return String(value).replaceAll('_', ' ');
}

function compact(value = '', length = 24) {
  const text = String(value || '');
  if (text.length <= length) return text;
  return `${text.slice(0, Math.ceil(length / 2))}…${text.slice(-Math.floor(length / 2) + 1)}`;
}

function formatDate(value, { short = false } = {}) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return String(value);
  return new Intl.DateTimeFormat('en', short
    ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }
    : { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(date) + ' UTC';
}

function initials(value = '') {
  const result = String(value).trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  return result || 'OP';
}

function envelope(payload) {
  return payload?.data ?? payload ?? {};
}

function errorMessage(error) {
  return error?.message || 'The request could not be completed.';
}

class ApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

async function api(path, options = {}) {
  const method = options.method || 'GET';
  const headers = { accept: 'application/json', ...(options.headers || {}) };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (!['GET', 'HEAD'].includes(method) && ui.csrfToken) headers['x-oam-csrf-token'] = ui.csrfToken;
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = payload?.error || {};
    throw new ApiError(error.code || `http_${response.status}`, error.message || `Request failed (${response.status}).`, response.status);
  }
  return payload;
}

function statusBadge(status, label = '') {
  const value = String(status || 'unknown').toLowerCase();
  const kind = ['active', 'passed', 'succeeded', 'approved', 'allowed', 'promoted_to_draft'].includes(value)
    ? 'good'
    : ['draft', 'queued', 'confirmed', 'running', 'review_pending', 'reviewed', 'inconclusive'].includes(value)
      ? 'pending'
      : ['failed', 'denied', 'suspended', 'rejected', 'revoked'].includes(value)
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

function sessionActor() {
  return ui.session?.actor || {};
}

function sessionDepartment() {
  const actor = sessionActor();
  return ui.session?.department || ui.state.departments[0] || {
    id: actor.department_id,
    department_key: actor.department_key,
    display_name: actor.department_name,
    membership_role: actor.membership_role,
  };
}

function principalById(id) {
  return ui.state.principals.find((principal) => principal.id === id) || null;
}

function personalPairFor(principalId) {
  return asArray(ui.state.employee_personal_agents).find((pair) => (
    pair.human_principal_id === principalId || pair.agent_principal_id === principalId
  )) || null;
}

function operationalPrincipals() {
  return ui.state.principals.filter(isOperationalPrincipal);
}

function preferredOperationalPrincipal() {
  const principals = operationalPrincipals();
  return [...principals].sort((left, right) => {
    const score = (principal) => {
      const name = String(principal.display_name || '').toLowerCase();
      if (name === 'broker integration agent' && principal.status === 'active') return 300;
      if (principal.principal_key === 'human:ai_architect' && principal.status === 'active') return 250;
      if (principal.status === 'active') return 100;
      if (principal.status === 'draft') return 40;
      return 0;
    };
    return score(right) - score(left);
  })[0] || ui.state.principals[0] || null;
}

function isActionableCandidate(candidate = {}) {
  return candidate.status === 'review_pending'
    || (candidate.status === 'reviewed' && !candidate.promotion_draft_id);
}

function membershipFor(principalId) {
  return ui.state.memberships.find((membership) => membership.principal_id === principalId) || null;
}

function bindingsFor(principalId) {
  return ui.state.runtime_bindings.filter((binding) => binding.principal_id === principalId);
}

function grantsFor(principalId) {
  return ui.state.capability_grants.filter((grant) => grant.principal_id === principalId);
}

function credentialsFor(principalId) {
  return ui.state.broker_credentials.filter((credential) => credential.principal_id === principalId);
}

function proofFor(principalId) {
  return ui.state.proof_runs.find((proof) => proof.target_key === principalId) || null;
}

function principalName(principalId) {
  const principal = principalById(principalId);
  return principal?.display_name || principal?.principal_key || compact(principalId);
}

function candidateCount(statuses) {
  return ui.candidates.filter((candidate) => statuses.includes(candidate.status)).length;
}

function navCount(view) {
  if (view === 'quarantine') return candidateCount(['draft']);
  if (view === 'candidate-review') return candidateCount(['review_pending', 'reviewed']);
  return 0;
}

async function restoreSession() {
  try {
    const payload = envelope(await api('/session'));
    ui.session = payload.session || payload;
    ui.csrfToken = payload.csrf_token || '';
    await refreshAll();
    renderShell();
  } catch (error) {
    if (error.status && error.status !== 401) ui.loadErrors.session = errorMessage(error);
    renderLogin();
  }
}

async function refreshAll({ render = false } = {}) {
  const [stateResult, candidateResult, auditResult] = await Promise.allSettled([
    api('/state'),
    api('/candidates'),
    api('/audit?limit=100'),
  ]);
  ui.loadErrors = {};
  if (stateResult.status === 'fulfilled') {
    const data = envelope(stateResult.value);
    ui.state = { ...emptyState(), ...(data.state || data) };
    for (const key of Object.keys(emptyState())) ui.state[key] = asArray(ui.state[key]);
    const currentUpload = ui.state.uploads.find((upload) => upload.id === ui.lastUpload?.id);
    ui.lastUpload = currentUpload || ui.state.uploads.find((upload) => (
      ['ready_for_review', 'approved_for_promotion'].includes(upload.status)
    )) || null;
  } else {
    ui.loadErrors.state = errorMessage(stateResult.reason);
  }
  if (candidateResult.status === 'fulfilled') {
    const data = envelope(candidateResult.value);
    ui.candidates = asArray(data.items || data.candidates || data);
  } else {
    ui.loadErrors.candidates = errorMessage(candidateResult.reason);
  }
  if (auditResult.status === 'fulfilled') {
    const data = envelope(auditResult.value);
    ui.audit = asArray(data.items || data.events || data);
  } else {
    ui.loadErrors.audit = errorMessage(auditResult.reason);
  }
  const selectedPrincipal = principalById(ui.selectedPrincipalId);
  const visiblePrincipals = filterPrincipals(
    ui.state.principals,
    ui.principalFilter,
    ui.principalSearch,
  );
  if (!selectedPrincipal || !visiblePrincipals.some((principal) => principal.id === selectedPrincipal.id)) {
    ui.selectedPrincipalId = ui.principalFilter === 'operational'
      ? preferredOperationalPrincipal()?.id || ''
      : visiblePrincipals[0]?.id || '';
  }
  if (ui.selectedCandidateId !== '__closed__') {
    const selectedCandidate = ui.candidates.find((candidate) => candidate.id === ui.selectedCandidateId);
    if (!selectedCandidate || (ui.candidateFilter === 'actionable' && !isActionableCandidate(selectedCandidate))) {
      ui.selectedCandidateId = ui.candidates.find(isActionableCandidate)?.id || ui.candidates[0]?.id || '';
    }
  }
  if (render) renderShell();
}

function renderLogin() {
  document.body.classList.remove('operator-nav-open');
  const sessionError = ui.loadErrors.session;
  app.innerHTML = `
    <main class="login-page" id="operator-main">
      <section class="login-panel" aria-labelledby="login-title">
        <div class="login-mark">${icon('lock', 22)}</div>
        <h1 id="login-title">Architect Console</h1>
        <p>Authenticate with a bounded operator token. The token is exchanged for an HttpOnly session cookie and is not retained by this interface.</p>
        ${sessionError ? `<div class="inline-error">${escapeHtml(sessionError)}</div>` : ''}
        <form data-login-form>
          <label>Operator token<input type="password" name="token" autocomplete="current-password" required autofocus /></label>
          <button class="primary-button" type="submit">Open console</button>
        </form>
        <a href="https://memory.sellsystems.agency/" class="back-link">Open public product</a>
      </section>
      <aside class="login-boundary" aria-label="Console security boundary">
        <h2>Four-plane enforcement</h2>
        <ol><li><strong>Application identity</strong><span>Authenticated human or agent principal.</span></li><li><strong>Policy</strong><span>Department-scoped effective permissions.</span></li><li><strong>Runtime identity</strong><span>Dedicated process and Linux identity for agents.</span></li><li><strong>Data authority</strong><span>Brokered or least-privileged PostgreSQL access.</span></li></ol>
      </aside>
    </main>
  `;
  app.querySelector('[data-login-form]').addEventListener('submit', handleLogin);
}

async function handleLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button');
  button.disabled = true;
  button.textContent = 'Authenticating…';
  try {
    const payload = envelope(await api('/session', {
      method: 'POST',
      body: { token: form.elements.token.value },
    }));
    ui.session = payload.session;
    ui.csrfToken = payload.csrf_token || '';
    form.reset();
    await refreshAll();
    renderShell();
  } catch (error) {
    const prior = form.querySelector('.form-error');
    prior?.remove();
    button.insertAdjacentHTML('beforebegin', `<div class="form-error" role="alert">${escapeHtml(errorMessage(error))}</div>`);
    button.disabled = false;
    button.textContent = 'Open console';
  }
}

function renderShell() {
  if (!ui.session) return renderLogin();
  const actor = sessionActor();
  const pending = candidateCount(['review_pending', 'reviewed']);
  const mobileNavOpen = ui.navOpen && window.matchMedia('(max-width: 900px)').matches;
  document.body.classList.toggle('operator-nav-open', mobileNavOpen);
  app.innerHTML = `
    <div class="console-shell">
      <header class="console-topbar">
        <button class="icon-button mobile-menu" type="button" data-toggle-nav aria-label="${mobileNavOpen ? 'Close' : 'Open'} navigation" aria-controls="operator-navigation" aria-expanded="${mobileNavOpen}">${icon('menu')}</button>
          <a class="console-brand" href="./">Architect Console</a>
        <div class="topbar-actions">
          <a class="icon-button" href="https://memory.sellsystems.agency/method" target="_blank" rel="noreferrer" aria-label="Open architecture method" title="Architecture method">${icon('help')}</a>
          <button class="icon-button notification-button" type="button" data-view-target="candidate-review" aria-label="Open candidate review" title="Candidate review">${icon('bell')}${pending ? `<span>${pending}</span>` : ''}</button>
          <div class="operator-identity"><span class="avatar">${escapeHtml(initials(actor.display_name || actor.principal_key))}</span><span><strong>${escapeHtml(actor.display_name || humanize(actor.principal_key || 'Operator'))}</strong><small>${escapeHtml(humanize(actor.membership_role || sessionDepartment().membership_role || 'operator'))}</small></span></div>
          <button class="icon-button" type="button" data-logout aria-label="Sign out" title="Sign out">${icon('log-out')}</button>
        </div>
      </header>
      <div class="console-nav-backdrop" data-close-nav data-open="${mobileNavOpen}" aria-hidden="true"></div>
      <aside class="console-sidebar" id="operator-navigation" data-open="${mobileNavOpen}" ${mobileNavOpen ? 'role="dialog" aria-modal="true" aria-label="Architect Console navigation"' : ''}>
        <nav aria-label="Architect Console">
          ${NAVIGATION.map(([key, label, iconName]) => {
            const count = navCount(key);
            return `<button type="button" data-view-target="${key}" aria-current="${ui.view === key ? 'page' : 'false'}">${icon(iconName)}<span>${escapeHtml(label)}</span>${count ? `<b>${count}</b>` : ''}</button>`;
          }).join('')}
        </nav>
        <div class="scope-footer"><span>Department scope</span><strong>${escapeHtml(sessionDepartment().display_name || sessionDepartment().department_key || 'Assigned department')}</strong><small>Expires ${escapeHtml(formatDate(ui.session.expires_at))}</small></div>
      </aside>
      <main class="console-main" id="operator-main" tabindex="-1" ${mobileNavOpen ? 'inert' : ''}>
        ${renderActiveView()}
      </main>
    </div>
  `;
  bindShellEvents();
}

function renderActiveView() {
  if (ui.loadErrors.state && !ui.state.principals.length) {
    return renderPageError('Console state unavailable', ui.loadErrors.state);
  }
  switch (ui.view) {
    case 'overview': return renderOverview();
    case 'provisioning': return renderProvisioning();
    case 'effective-access': return renderEffectiveAccess();
    case 'access-proofs': return renderAccessProofs();
    case 'quarantine': return renderQuarantine();
    case 'candidate-review': return renderCandidateReview();
    case 'policy-templates': return renderPolicyTemplates();
    case 'audit': return renderAudit();
    default: return renderPrincipals();
  }
}

function pageHeader(title, description = '', actions = '') {
  return `<header class="page-header"><div><h1>${escapeHtml(title)}</h1>${description ? `<p>${escapeHtml(description)}</p>` : ''}</div>${actions ? `<div class="page-actions">${actions}</div>` : ''}</header>`;
}

function renderPageError(title, message) {
  return `<section class="page-surface">${pageHeader(title)}<div class="empty-panel is-error">${icon('alert', 22)}<strong>${escapeHtml(message)}</strong><button class="secondary-button" type="button" data-refresh>Retry</button></div></section>`;
}

function renderOverview() {
  const principals = operationalPrincipals();
  const principalIds = new Set(principals.map((principal) => principal.id));
  const activeBindings = ui.state.runtime_bindings.filter((item) => (
    principalIds.has(item.principal_id) && item.status === 'active'
  )).length;
  const openJobs = ui.state.provisioning_jobs.filter((item) => (
    principalIds.has(item.principal_id) && ['queued', 'confirmed', 'running'].includes(item.status)
  )).length;
  const pendingCandidates = candidateCount(['review_pending', 'reviewed']);
  const recentJobs = ui.state.provisioning_jobs.filter((job) => principalIds.has(job.principal_id)).slice(0, 5);
  return `
    <section class="page-surface overview-page">
      ${pageHeader('Overview', 'Live governed identity and capability operations for the active department.', `<button class="secondary-button" type="button" data-refresh>${icon('refresh', 15)}Refresh</button>`)}
      <div class="metric-strip">
        <div><strong>${principals.length}</strong><span>Operational principals</span></div>
        <div><strong>${activeBindings}</strong><span>Active runtime bindings</span></div>
        <div><strong>${openJobs}</strong><span>Open provisioning jobs</span></div>
        <div><strong>${pendingCandidates}</strong><span>Candidates awaiting action</span></div>
      </div>
      <section class="open-section">
        <div class="section-heading"><div><h2>Four-plane identity map</h2><p>Application identity, policy, runtime binding, and data authority must agree.</p></div><button class="text-button" data-view-target="principals">Inspect principals</button></div>
        ${renderIdentityPlaneTable(principals)}
      </section>
      <div class="overview-columns">
        <section class="open-section"><div class="section-heading"><h2>Recent provisioning</h2><button class="text-button" data-view-target="provisioning">View all</button></div>${recentJobs.length ? `<div class="compact-list">${recentJobs.map((job) => `<button data-job-id="${escapeHtml(job.id)}" data-view-target="provisioning"><span><strong>${escapeHtml(humanize(job.job_type || job.plan?.operation))}</strong><small>${escapeHtml(principalName(job.principal_id))}</small></span>${statusBadge(job.status)}<time>${escapeHtml(formatDate(job.requested_at, { short: true }))}</time></button>`).join('')}</div>` : renderEmpty('No provisioning jobs are recorded.')}</section>
        <section class="open-section"><div class="section-heading"><h2>Operational proof posture</h2><button class="text-button" data-view-target="access-proofs">Open proof history</button></div>${renderProofSummary(principalIds)}</section>
      </div>
    </section>
  `;
}

function renderIdentityPlaneTable(principals = operationalPrincipals()) {
  if (!principals.length) return renderEmpty('No operational principals are recorded in this department.');
  return `
    <div class="table-scroll"><table class="data-table plane-table"><thead><tr><th>Principal</th><th>Application</th><th>Policy</th><th>Runtime identity</th><th>Data authority</th></tr></thead><tbody>
      ${principals.map((principal) => {
        const membership = membershipFor(principal.id);
        const bindings = bindingsFor(principal.id);
        const runtime = bindings.filter((item) => ['linux_user', 'systemd_unit', 'workspace', 'broker_client'].includes(item.binding_kind));
        const database = bindings.filter((item) => item.binding_kind === 'postgres_role');
        const grants = grantsFor(principal.id);
        return `<tr data-principal-id="${escapeHtml(principal.id)}"><td>${principalCell(principal)}</td><td>${statusBadge(principal.status)}<small>${escapeHtml(humanize(principal.principal_kind))}</small></td><td>${membership ? statusBadge(membership.status, membership.membership_role) : statusBadge('unknown', 'No membership')}</td><td>${runtime.length ? `<strong>${runtime.length}</strong><small>${escapeHtml(runtime.map((item) => humanize(item.binding_kind)).join(', '))}</small>` : '<span class="not-recorded">Not recorded</span>'}</td><td>${database.length || grants.length ? `<strong>${database.length} direct / ${grants.length} grant</strong><small>${database.length ? 'PostgreSQL binding recorded' : 'Brokered capability grants'}</small>` : '<span class="not-recorded">Not recorded</span>'}</td></tr>`;
      }).join('')}
    </tbody></table></div>
  `;
}

function renderProofSummary(principalIds = null) {
  const counts = new Map();
  ui.state.proof_runs
    .filter((proof) => !principalIds || principalIds.has(proof.target_key))
    .forEach((proof) => counts.set(proof.status, (counts.get(proof.status) || 0) + 1));
  return `<div class="proof-summary"><div>${statusBadge('passed')}<strong>${counts.get('passed') || 0}</strong></div><div>${statusBadge('failed')}<strong>${counts.get('failed') || 0}</strong></div><div>${statusBadge('inconclusive')}<strong>${counts.get('inconclusive') || 0}</strong></div><p>Values are derived from recorded proof runs. This console does not infer unrecorded checks.</p></div>`;
}

function principalCell(principal) {
  return `<span class="principal-cell"><span class="avatar is-${escapeHtml(principal.principal_kind)}">${escapeHtml(initials(principal.display_name || principal.principal_key))}</span><span><strong>${escapeHtml(principal.display_name || principal.principal_key)}</strong><small>${escapeHtml(principal.principal_key)}</small></span></span>`;
}

function filteredPrincipals() {
  return filterPrincipals(ui.state.principals, ui.principalFilter, ui.principalSearch);
}

function renderPrincipals() {
  const principals = filteredPrincipals();
  const counts = principalFilterCounts(ui.state.principals);
  const selected = principals.find((principal) => principal.id === ui.selectedPrincipalId) || principals[0] || null;
  if (selected) ui.selectedPrincipalId = selected.id;
  const selectedCanSuspend = selected
    && selected.status !== 'suspended'
    && (selected.principal_kind === 'agent' || personalPairFor(selected.id));
  return `
    <section class="page-surface principals-page ${selected ? 'has-inspector' : ''}">
      <div class="page-body">
        ${pageHeader('People & personal agents', 'Onboarding creates one employee identity, one independently governed Personal Memory Agent, and one revocable workspace credential in a single transaction.')}
        <div class="command-bar">
          <div class="command-group"><button class="primary-button" type="button" data-open-dialog="onboard-employee">${icon('user-plus', 16)}Onboard employee</button><button class="secondary-button" type="button" data-open-dialog="record-proof">${icon('play', 16)}Record proof</button><button class="secondary-button" type="button" data-open-dialog="suspend" ${selectedCanSuspend ? '' : 'disabled'}>${icon('pause', 16)}Suspend</button></div>
          <label class="search-control">${icon('search', 16)}<input type="search" placeholder="Search principals" value="${escapeHtml(ui.principalSearch)}" data-principal-search /></label>
          <button class="icon-button bordered" type="button" title="Refresh principals" aria-label="Refresh principals" data-refresh>${icon('refresh', 17)}</button>
        </div>
        <div class="filter-bar"><div class="view-tabs" role="tablist" aria-label="Operational principal filters">${[['operational', 'Operational', counts.operational], ['human', 'Humans', counts.human], ['agent', 'Agents', counts.agent]].map(([key, label, count]) => `<button type="button" role="tab" aria-selected="${ui.principalFilter === key}" data-principal-filter="${key}">${escapeHtml(label)} <span>${count}</span></button>`).join('')}</div><button class="history-disclosure" type="button" data-principal-history-toggle aria-expanded="${ui.principalHistoryOpen}" aria-controls="principal-audit-history">${icon('list', 15)}Audit history${icon(ui.principalHistoryOpen ? 'chevron-down' : 'chevron-right', 13)}</button></div>
        ${ui.principalHistoryOpen ? `<div class="audit-history-band" id="principal-audit-history"><span class="audit-history-context"><strong>Retained principal history</strong><small>Suspended identities and proof fixtures remain available for governance review.</small></span><div class="audit-history-tabs" role="tablist" aria-label="Principal audit-history filters">${[['all', 'All principals', counts.all], ['suspended', 'Suspended', counts.suspended], ['proof_fixtures', 'Proof fixtures', counts.proof_fixtures]].map(([key, label, count]) => `<button type="button" role="tab" aria-selected="${ui.principalFilter === key}" data-principal-filter="${key}">${escapeHtml(label)} <span>${count}</span></button>`).join('')}</div></div>` : ''}
        <div class="table-scroll principal-table-wrap">
          <table class="data-table principal-table"><thead><tr><th>Principal</th><th>Type</th><th>Role</th><th>Runtime bindings</th><th>Effective state</th><th>Proof status</th><th>Last activity</th></tr></thead><tbody>
            ${principals.map((principal) => {
              const membership = membershipFor(principal.id);
              const proof = proofFor(principal.id);
              const pair = personalPairFor(principal.id);
              return `<tr tabindex="0" data-principal-id="${escapeHtml(principal.id)}" aria-selected="${principal.id === selected?.id}"><td>${principalCell(principal)}</td><td>${escapeHtml(humanize(principal.principal_kind))}</td><td>${escapeHtml(humanize(membership?.membership_role || 'not recorded'))}${pair ? `<small>Personal pair · ${escapeHtml(humanize(pair.status))}</small>` : ''}</td><td><strong>${bindingsFor(principal.id).length}</strong></td><td>${statusBadge(principal.status)}</td><td>${proof ? statusBadge(proof.status) : '<span class="not-recorded">Not recorded</span>'}</td><td>${escapeHtml(formatDate(proof?.executed_at || principal.created_at, { short: true }))}</td></tr>`;
            }).join('') || `<tr><td colspan="7">${renderEmpty('No principals match this view.')}</td></tr>`}
          </tbody></table>
        </div>
        <footer class="table-footer"><span>${ui.principalHistoryOpen && ['all', 'suspended', 'proof_fixtures'].includes(ui.principalFilter) ? `Showing ${principals.length} retained records` : `Showing ${principals.length} operational principals`}</span><span>Rows per page: <strong>200</strong></span></footer>
      </div>
      ${selected ? renderPrincipalInspector(selected) : ''}
    </section>
  `;
}

function renderPrincipalInspector(principal) {
  const membership = membershipFor(principal.id);
  const bindings = bindingsFor(principal.id);
  const proof = proofFor(principal.id);
  const personalPair = personalPairFor(principal.id);
  const pairedPrincipal = personalPair
    ? principalById(personalPair.human_principal_id === principal.id
      ? personalPair.agent_principal_id
      : personalPair.human_principal_id)
    : null;
  const tabContent = {
    application: `<dl class="inspector-grid"><div><dt>Principal state</dt><dd>${statusBadge(principal.status)}</dd></div><div><dt>Policy source</dt><dd>${escapeHtml(humanize(membership?.membership_role || 'Not recorded'))}</dd></div><div><dt>Enforcement point</dt><dd>Application gateway</dd></div><div><dt>Last proof</dt><dd>${escapeHtml(formatDate(proof?.executed_at))}</dd></div><div><dt>Proof status</dt><dd>${proof ? statusBadge(proof.status) : '<span class="not-recorded">Not recorded</span>'}</dd></div></dl>`,
    os: renderBindingList(bindings.filter((item) => ['linux_user', 'systemd_unit', 'workspace'].includes(item.binding_kind)), 'No OS runtime identity is recorded.'),
    database: renderBindingList(bindings.filter((item) => item.binding_kind === 'postgres_role'), 'No direct PostgreSQL role is recorded. Brokered access does not require one.'),
    memory: renderGrantList(grantsFor(principal.id)),
  }[ui.principalTab];
  const canSuspend = principal.status !== 'suspended'
    && (principal.principal_kind === 'agent' || personalPair);
  return `<aside class="principal-inspector" aria-label="Selected principal detail"><header><span class="avatar is-${escapeHtml(principal.principal_kind)}">${escapeHtml(initials(principal.display_name || principal.principal_key))}</span><span><h2>${escapeHtml(principal.display_name || principal.principal_key)}</h2><p>${escapeHtml(humanize(principal.principal_kind))}</p></span><button class="icon-button" type="button" data-close-inspector aria-label="Close principal detail">${icon('x')}</button></header><div class="inspector-tabs" role="tablist">${['application', 'os', 'database', 'memory'].map((tab) => `<button type="button" role="tab" aria-selected="${ui.principalTab === tab}" data-principal-tab="${tab}">${escapeHtml(tab === 'os' ? 'OS' : humanize(tab))}</button>`).join('')}</div><div class="inspector-content">${tabContent}</div>${personalPair ? `<section class="inspector-section"><h3>Personal pairing</h3><dl class="key-values"><div><dt>Linked principal</dt><dd>${escapeHtml(pairedPrincipal?.display_name || pairedPrincipal?.principal_key || 'Recorded')}</dd></div><div><dt>Pair state</dt><dd>${statusBadge(personalPair.status)}</dd></div><div><dt>Cardinality</dt><dd>One human · one personal agent</dd></div></dl></section>` : ''}<section class="inspector-section"><h3>Identifiers</h3><dl class="key-values"><div><dt>Principal key</dt><dd>${escapeHtml(principal.principal_key)}</dd></div><div><dt>Principal ID</dt><dd>${escapeHtml(principal.id)}</dd></div></dl></section><section class="inspector-section"><h3>Actions</h3><button class="secondary-button" type="button" data-open-dialog="suspend" ${canSuspend ? '' : 'disabled'}>${icon('pause', 15)}Suspend</button></section></aside>`;
}

function renderBindingList(bindings, emptyMessage) {
  if (!bindings.length) return renderEmpty(emptyMessage);
  return `<div class="detail-list">${bindings.map((binding) => `<div><span>${statusBadge(binding.status)}</span><strong>${escapeHtml(humanize(binding.binding_kind))}</strong><code>${escapeHtml(binding.binding_value)}</code><small>${escapeHtml(humanize(binding.access_mode || 'not recorded'))}</small></div>`).join('')}</div>`;
}

function renderGrantList(grants) {
  if (!grants.length) return renderEmpty('No capability grants are recorded.');
  return `<div class="detail-list">${grants.map((grant) => `<div><span>${statusBadge(grant.status)}</span><strong>${escapeHtml(grant.capability_task_key)}</strong><code>${escapeHtml(asArray(grant.allowed_review_statuses).join(', '))}</code></div>`).join('')}</div>`;
}

function renderProvisioning() {
  const allJobs = ui.state.provisioning_jobs;
  const operationalPrincipalIds = operationalPrincipals().map((principal) => principal.id);
  const jobs = filterProvisioningJobs(allJobs, operationalPrincipalIds, ui.provisioningFilter);
  const currentCount = filterProvisioningJobs(allJobs, operationalPrincipalIds, 'current').length;
  const failureCount = filterProvisioningJobs(allJobs, operationalPrincipalIds, 'failed').length;
  const selected = ui.selectedJobId === '__closed__'
    ? null
    : jobs.find((job) => job.id === ui.selectedJobId) || jobs[0];
  const emptyMessage = ui.provisioningFilter === 'failed'
    ? 'No failed provisioning jobs are recorded.'
    : ui.provisioningFilter === 'all'
      ? 'No provisioning jobs are recorded.'
      : 'No current provisioning jobs are recorded.';
  return `<section class="page-surface provisioning-page">${pageHeader('Provisioning', 'Queue an immutable plan, inspect its hash and revision, then confirm it explicitly.', `<button class="primary-button" data-open-dialog="provision">${icon('plus', 15)}New plan</button>`)}<div class="filter-bar"><div class="view-tabs" role="tablist" aria-label="Current provisioning filters"><button type="button" role="tab" aria-selected="${ui.provisioningFilter === 'current'}" data-provisioning-filter="current">Current <span>${currentCount}</span></button></div><button class="history-disclosure" type="button" data-provisioning-history-toggle aria-expanded="${ui.provisioningHistoryOpen}" aria-controls="provisioning-audit-history">${icon('list', 15)}Audit history${icon(ui.provisioningHistoryOpen ? 'chevron-down' : 'chevron-right', 13)}</button></div>${ui.provisioningHistoryOpen ? `<div class="audit-history-band" id="provisioning-audit-history"><span class="audit-history-context"><strong>Retained provisioning history</strong><small>Failed and superseded jobs remain immutable and reviewable.</small></span><div class="audit-history-tabs" role="tablist" aria-label="Provisioning audit-history filters">${[['failed', 'Failures', failureCount], ['all', 'All history', allJobs.length]].map(([key, label, count]) => `<button type="button" role="tab" class="${key === 'failed' && count ? 'is-alert' : ''}" aria-selected="${ui.provisioningFilter === key}" data-provisioning-filter="${key}">${escapeHtml(label)} <span>${count}</span></button>`).join('')}</div></div>` : ''}<div class="table-scroll"><table class="data-table"><thead><tr><th>Requested</th><th>Principal</th><th>Operation</th><th>Status</th><th>Revision</th><th>Plan hash</th><th>Action</th></tr></thead><tbody>${jobs.map((job) => `<tr tabindex="0" data-job-id="${escapeHtml(job.id)}" aria-selected="${selected?.id === job.id}"><td>${escapeHtml(formatDate(job.requested_at, { short: true }))}</td><td>${escapeHtml(principalName(job.principal_id))}</td><td>${escapeHtml(humanize(job.plan?.operation || job.job_type))}</td><td>${statusBadge(job.status)}</td><td>${escapeHtml(String(job.revision ?? '—'))}</td><td><code title="${escapeHtml(job.plan_hash)}">${escapeHtml(compact(job.plan_hash, 20))}</code></td><td>${job.status === 'queued' ? `<button class="text-button" data-confirm-job="${escapeHtml(job.id)}">Confirm</button>` : '<span class="not-recorded">—</span>'}</td></tr>`).join('') || `<tr><td colspan="7">${renderEmpty(emptyMessage)}</td></tr>`}</tbody></table></div><footer class="table-footer"><span>${ui.provisioningHistoryOpen && ['failed', 'all'].includes(ui.provisioningFilter) ? `Showing ${jobs.length} retained jobs` : `Showing ${jobs.length} current jobs`}</span><span>Ledger limit: <strong>200</strong></span></footer>${selected ? renderProvisioningDrawer(selected) : ''}</section>`;
}

function renderProvisioningDrawer(job) {
  const steps = [
    ['Validate plan', ['queued', 'confirmed', 'running', 'succeeded'].includes(job.status)],
    ['Confirm revision', ['confirmed', 'running', 'succeeded'].includes(job.status)],
    ['Stage logical principal', ['running', 'succeeded'].includes(job.status)],
    ['Apply runtime bindings', job.status === 'succeeded'],
    ['Run activation proofs', job.status === 'succeeded'],
    ['Activate', job.status === 'succeeded'],
  ];
  return `<aside class="job-drawer"><header><div><strong>Provisioning job: ${escapeHtml(principalName(job.principal_id))}</strong>${statusBadge(job.status)}</div><button class="icon-button" data-close-job aria-label="Close job detail">${icon('x')}</button></header><div class="job-meta"><span>Requested ${escapeHtml(formatDate(job.requested_at))}</span><span>Revision ${escapeHtml(String(job.revision ?? '—'))}</span><code>${escapeHtml(compact(job.plan_hash, 34))}</code></div><ol class="job-steps">${steps.map(([label, complete], index) => `<li class="${complete ? 'is-complete' : ''}"><span>${complete ? icon('check', 14) : index + 1}</span><strong>${escapeHtml(label)}</strong><small>${complete ? 'Recorded' : 'Not recorded'}</small></li>`).join('')}</ol></aside>`;
}

function renderEffectiveAccess() {
  const selectedPrincipal = principalById(ui.selectedPrincipalId) || ui.state.principals[0];
  const selectedDepartment = ui.state.departments[0];
  const result = ui.effectiveAccess;
  return `<section class="page-surface access-page">${pageHeader('Effective access', 'Evaluate application policy from the live principal, department membership, and runtime bindings.')}
    <form class="access-query" data-effective-access-form><label>Principal<select name="principal_id" required>${ui.state.principals.map((principal) => `<option value="${escapeHtml(principal.id)}" ${selectedPrincipal?.id === principal.id ? 'selected' : ''}>${escapeHtml(principal.display_name || principal.principal_key)}</option>`).join('')}</select></label><label>Department<select name="department_id" required>${ui.state.departments.map((department) => `<option value="${escapeHtml(department.id)}" ${selectedDepartment?.id === department.id ? 'selected' : ''}>${escapeHtml(department.display_name || department.department_key)}</option>`).join('')}</select></label><button class="primary-button" type="submit">Evaluate</button></form>
    ${ui.effectiveAccessError ? `<div class="inline-error">${escapeHtml(ui.effectiveAccessError)}</div>` : ''}
    ${result ? renderAccessResult(result) : `<div class="empty-panel">${icon('shield-check', 26)}<strong>Run an effective-access evaluation.</strong><span>No permission result is inferred before the API responds.</span></div>`}
  </section>`;
}

function renderAccessResult(result) {
  const permissions = asArray(result.permissions);
  const denials = asArray(result.explicit_denials);
  const findings = asArray(result.runtime_findings);
  return `<div class="access-result"><header><div>${statusBadge(findings.length ? 'inconclusive' : 'allowed', findings.length ? 'Review runtime findings' : 'Policy evaluated')}</div><span>Evaluated ${escapeHtml(formatDate(result.evaluated_at))}</span></header><div class="access-columns"><section><h2>Effective permissions <span>${permissions.length}</span></h2>${permissions.length ? `<ul class="permission-list">${permissions.map((permission) => `<li>${icon('check', 14)}<code>${escapeHtml(permission)}</code></li>`).join('')}</ul>` : renderEmpty('No permissions returned.')}</section><section><h2>Explicit denials <span>${denials.length}</span></h2>${denials.length ? `<ul class="permission-list is-denied">${denials.map((permission) => `<li>${icon('x', 14)}<code>${escapeHtml(permission)}</code></li>`).join('')}</ul>` : renderEmpty('No explicit denials returned.')}</section></div><section class="runtime-findings"><h2>Runtime findings</h2>${findings.length ? findings.map((finding) => `<div>${statusBadge('inconclusive')}<strong>${escapeHtml(humanize(finding.code))}</strong><code>${escapeHtml(finding.binding_kind || '')} ${escapeHtml(finding.binding_value || '')}</code></div>`).join('') : `<p>${icon('check', 15)}No runtime finding was returned by this evaluation.</p>`}</section></div>`;
}

function renderAccessProofs() {
  const proofs = ui.state.proof_runs;
  return `<section class="page-surface proofs-page">${pageHeader('Access proofs', 'Recorded evidence only. Use this surface to register an executed proof; it does not execute shell commands in the browser.', `<button class="primary-button" data-open-dialog="record-proof">${icon('plus', 15)}Record proof</button>`)}<div class="proof-filter-strip"><span>${proofs.length} recorded proof${proofs.length === 1 ? '' : 's'}</span><span>${proofs.filter((proof) => proof.status === 'passed').length} passed</span><span>${proofs.filter((proof) => proof.status === 'failed').length} failed</span></div><div class="table-scroll"><table class="data-table"><thead><tr><th>Proof key</th><th>Target</th><th>Status</th><th>Executed</th><th>Evidence</th></tr></thead><tbody>${proofs.map((proof) => `<tr><td><strong>${escapeHtml(proof.proof_key)}</strong><small>${escapeHtml(proof.id)}</small></td><td>${escapeHtml(humanize(proof.target_kind))}<small>${escapeHtml(compact(proof.target_key, 34))}</small></td><td>${statusBadge(proof.status)}</td><td>${escapeHtml(formatDate(proof.executed_at))}</td><td><details><summary>Inspect JSON</summary><pre>${escapeHtml(JSON.stringify(proof.evidence || {}, null, 2))}</pre></details></td></tr>`).join('') || `<tr><td colspan="5">${renderEmpty('No proof runs are recorded.')}</td></tr>`}</tbody></table></div></section>`;
}

function renderQuarantine() {
  return `<section class="page-surface quarantine-page">${pageHeader('Quarantine', 'Submit bounded text or Markdown into quarantine. Uploading never writes canonical memory.', `<button class="primary-button" data-open-dialog="upload">${icon('upload', 15)}Submit text</button>`)}<div class="boundary-banner">${icon('lock', 18)}<div><strong>Quarantine is append-only at ingestion.</strong><span>A separate candidate, review, and architect promotion action is required before a draft can exist.</span></div></div>${ui.lastUpload ? renderLastUpload(ui.lastUpload) : `<div class="empty-panel">${icon('upload', 24)}<strong>No reviewable upload is available.</strong><span>Submit bounded text to create a sealed source record.</span></div>`}<section class="open-section"><div class="section-heading"><h2>Department uploads</h2><button class="text-button" data-view-target="candidate-review">Open candidates</button></div>${renderCandidateUploadTable()}</section></section>`;
}

function renderLastUpload(upload) {
  const reviewable = ['ready_for_review', 'approved_for_promotion'].includes(upload.status);
  return `<section class="upload-result"><div><span>Selected sealed source</span><h2>${escapeHtml(upload.original_name || upload.upload_key || upload.id)}</h2><code>${escapeHtml(upload.id || '')}</code></div>${statusBadge(upload.status)}<dl><div><dt>SHA-256</dt><dd>${escapeHtml(compact(upload.sha256, 34))}</dd></div><div><dt>Latest scan</dt><dd>${escapeHtml(humanize(upload.latest_scan_verdict || 'not recorded'))}</dd></div><div><dt>Submitted by</dt><dd>${escapeHtml(upload.submitted_by_principal_key || compact(upload.submitted_by_principal_id))}</dd></div></dl>${reviewable ? `<button class="secondary-button" data-open-dialog="create-candidate" data-upload-id="${escapeHtml(upload.id)}">${icon('plus', 15)}Create candidate</button>` : ''}</section>`;
}

function renderCandidateUploadTable() {
  const uploads = ui.state.uploads;
  if (!uploads.length) return renderEmpty('No uploads are returned for this department.');
  return `<div class="table-scroll"><table class="data-table"><thead><tr><th>Original name</th><th>Status</th><th>SHA-256</th><th>Candidates</th><th>Action</th></tr></thead><tbody>${uploads.map((upload) => `<tr><td>${escapeHtml(upload.original_name || 'Not returned')}<small>${escapeHtml(compact(upload.id))}</small></td><td>${statusBadge(upload.status)}<small>${escapeHtml(humanize(upload.latest_scan_verdict || 'not scanned'))}</small></td><td><code>${escapeHtml(compact(upload.sha256, 28))}</code></td><td>${escapeHtml(String(upload.candidate_count ?? 0))}</td><td>${['ready_for_review', 'approved_for_promotion'].includes(upload.status) ? `<button class="text-button" data-open-dialog="create-candidate" data-upload-id="${escapeHtml(upload.id)}">Create candidate</button>` : '<span class="not-recorded">Unavailable</span>'}</td></tr>`).join('')}</tbody></table></div>`;
}

function renderCandidateReview() {
  const candidates = ui.candidates.filter((candidate) => (
    ui.candidateFilter === 'all'
    || (ui.candidateFilter === 'actionable' && isActionableCandidate(candidate))
    || (ui.candidateFilter === 'pending' && candidate.status === 'review_pending')
    || (ui.candidateFilter === 'promoted' && candidate.status === 'promoted_to_draft')
  ));
  const selected = ui.selectedCandidateId === '__closed__'
    ? null
    : candidates.find((candidate) => candidate.id === ui.selectedCandidateId) || candidates[0];
  return `<section class="page-surface candidates-page ${selected ? 'has-candidate-detail' : ''}"><div class="page-body">${pageHeader('Candidate review', 'Review quarantined candidates and promote only an approved revision into draft canonical memory.')}<div class="view-tabs" role="tablist">${[['actionable', 'Actionable', ui.candidates.filter(isActionableCandidate).length], ['all', 'All candidates', ui.candidates.length], ['pending', 'Pending', candidateCount(['review_pending'])], ['promoted', 'Promoted', candidateCount(['promoted_to_draft'])]].map(([key, label, count]) => `<button type="button" role="tab" aria-selected="${ui.candidateFilter === key}" data-candidate-filter="${key}">${escapeHtml(label)} <span>${count}</span></button>`).join('')}</div><div class="table-scroll"><table class="data-table"><thead><tr><th>Candidate</th><th>Type</th><th>Status</th><th>Revision</th><th>Evidence</th><th>Created</th></tr></thead><tbody>${candidates.map((candidate) => `<tr tabindex="0" data-candidate-id="${escapeHtml(candidate.id)}" aria-selected="${selected?.id === candidate.id}"><td><strong>${escapeHtml(candidate.title)}</strong><small>${escapeHtml(candidate.candidate_key)}</small></td><td>${escapeHtml(humanize(candidate.candidate_type))}</td><td>${statusBadge(candidate.status)}</td><td>${escapeHtml(String(candidate.revision))}</td><td>${asArray(candidate.evidence).length}</td><td>${escapeHtml(formatDate(candidate.created_at, { short: true }))}</td></tr>`).join('') || `<tr><td colspan="6">${renderEmpty(ui.loadErrors.candidates || 'No candidates match this view.')}</td></tr>`}</tbody></table></div></div>${selected ? renderCandidateDetail(selected) : ''}</section>`;
}

function renderCandidateDetail(candidate) {
  const canReview = candidate.status === 'review_pending';
  const canPromote = candidate.status === 'reviewed' && !candidate.promotion_draft_id;
  return `<aside class="candidate-detail"><header><div><span>${statusBadge(candidate.status)}</span><h2>${escapeHtml(candidate.title)}</h2><p>${escapeHtml(candidate.candidate_key)}</p></div><button class="icon-button" data-close-candidate aria-label="Close candidate detail">${icon('x')}</button></header><section><h3>Bound provenance</h3><dl class="key-values"><div><dt>Human submitter</dt><dd>${escapeHtml(candidate.submitted_by_principal_key || compact(candidate.submitted_by_principal_id))}</dd></div><div><dt>Ingestion processor</dt><dd>${escapeHtml(candidate.produced_by_principal_key || 'Not returned')}</dd></div><div><dt>Upload SHA-256</dt><dd><code>${escapeHtml(candidate.source_upload_sha256 || candidate.upload_sha256)}</code></dd></div><div><dt>Candidate hash</dt><dd><code>${escapeHtml(candidate.content_hash)}</code></dd></div></dl></section><section><h3>Candidate payload</h3><pre>${escapeHtml(JSON.stringify(candidate.candidate_payload || {}, null, 2))}</pre></section><section><h3>Evidence</h3>${asArray(candidate.evidence).length ? asArray(candidate.evidence).map((evidence) => `<details><summary>${escapeHtml(humanize(evidence.evidence_kind))}</summary><code>${escapeHtml(evidence.evidence_ref)}</code><blockquote>${escapeHtml(evidence.excerpt)}</blockquote></details>`).join('') : renderEmpty('No evidence returned.')}</section><section><h3>Review history</h3>${asArray(candidate.reviews).length ? `<div class="review-list">${asArray(candidate.reviews).map((review) => `<div>${statusBadge(review.action)}<p>${escapeHtml(review.reason)}</p><code>${escapeHtml(compact(review.candidate_content_hash, 28))}</code><time>${escapeHtml(formatDate(review.created_at))}</time></div>`).join('')}</div>` : renderEmpty('No review action is recorded.')}</section><footer>${canReview ? `<button class="secondary-button is-danger" data-review-action="reject">Reject</button><button class="primary-button" data-review-action="approve_for_draft">Approve for draft</button>` : ''}${canPromote ? `<button class="primary-button" data-promote-candidate>Promote approved revision</button>` : ''}${candidate.promotion_draft_id ? `<div class="promotion-record">${statusBadge('promoted_to_draft')}<code>${escapeHtml(candidate.draft_key || candidate.promotion_draft_id)}</code></div>` : ''}</footer></aside>`;
}

function renderPolicyTemplates() {
  const bindingKinds = new Map();
  ui.state.runtime_bindings.forEach((binding) => bindingKinds.set(binding.binding_kind, (bindingKinds.get(binding.binding_kind) || 0) + 1));
  const planes = [
    ['Application identity', 'Logical principals authenticated by the application gateway.', ui.state.principals.length, 'principal records'],
    ['Policy', 'Department memberships and capability grants determine effective permission.', ui.state.memberships.length + ui.state.capability_grants.length, 'policy records'],
    ['Runtime identity', 'Dedicated Linux users, units, workspaces, or broker clients bind agent workload identity.', [...bindingKinds.entries()].filter(([kind]) => ['linux_user', 'systemd_unit', 'workspace', 'broker_client'].includes(kind)).reduce((sum, [, count]) => sum + count, 0), 'runtime bindings'],
    ['PostgreSQL authority', 'Direct roles are explicit exceptions; brokered grants remain separate from the Node service account.', bindingKinds.get('postgres_role') || 0, 'direct database bindings'],
  ];
  return `<section class="page-surface policy-page">${pageHeader('Policy templates', 'Read-only enforcement reference derived from the active department state.')}<div class="policy-invariant"><strong>Isolation invariant</strong><p>A web human is a logical application principal. A Linux UID becomes an enforcement boundary only for a dedicated process mapped to the same policy and data authority.</p></div><ol class="plane-list">${planes.map(([title, description, count, label], index) => `<li><span>${index + 1}</span><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div><strong>${count}<small>${escapeHtml(label)}</small></strong></li>`).join('')}</ol><section class="open-section"><div class="section-heading"><div><h2>Observed binding kinds</h2><p>Counts are returned by the live operator state endpoint.</p></div></div>${bindingKinds.size ? `<div class="binding-kind-list">${[...bindingKinds.entries()].map(([kind, count]) => `<div><code>${escapeHtml(kind)}</code><strong>${count}</strong></div>`).join('')}</div>` : renderEmpty('No runtime binding is recorded.')}</section></section>`;
}

function renderAudit() {
  return `<section class="page-surface audit-page">${pageHeader('Audit', 'Append-only operator events returned for the active department.', `<button class="secondary-button" data-refresh>${icon('refresh', 15)}Refresh</button>`)}${ui.loadErrors.audit ? `<div class="inline-error">${escapeHtml(ui.loadErrors.audit)}</div>` : ''}<div class="audit-stream">${ui.audit.map((event) => `<article><span class="audit-rail"></span><header><strong>${escapeHtml(humanize(event.event_type || event.action || 'audit event'))}</strong><time>${escapeHtml(formatDate(event.occurred_at || event.created_at || event.recorded_at))}</time></header><dl><div><dt>Actor</dt><dd>${escapeHtml(compact(event.actor_principal_id || event.actor_principal_key || 'Not returned', 34))}</dd></div><div><dt>Resource</dt><dd>${escapeHtml(event.resource_type || 'Not returned')} / ${escapeHtml(compact(event.resource_key || '', 34))}</dd></div><div><dt>Workload</dt><dd>${escapeHtml(humanize(event.workload_role || 'Not returned'))}</dd></div></dl>${event.payload ? `<details><summary>Payload</summary><pre>${escapeHtml(JSON.stringify(event.payload, null, 2))}</pre></details>` : ''}</article>`).join('') || renderEmpty('No audit events are returned.')}</div></section>`;
}

function renderEmpty(message) {
  return `<div class="inline-empty">${escapeHtml(message)}</div>`;
}

function setMobileNavigation(open, { returnFocus = false } = {}) {
  ui.navOpen = open;
  renderShell();
  const target = open
    ? app.querySelector('.console-sidebar [data-view-target][aria-current="page"]')
      || app.querySelector('.console-sidebar [data-view-target]')
    : returnFocus
      ? app.querySelector('[data-toggle-nav]')
      : null;
  target?.focus({ preventScroll: true });
}

function focusOperatorMain() {
  const main = document.querySelector('#operator-main');
  window.scrollTo(0, 0);
  main?.focus({ preventScroll: true });
}

function handleOperatorNavigationKeydown(event) {
  if (!ui.navOpen || !window.matchMedia('(max-width: 900px)').matches) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    setMobileNavigation(false, { returnFocus: true });
    return;
  }
  if (event.key !== 'Tab') return;
  const items = [...app.querySelectorAll('.console-sidebar [data-view-target]')];
  if (!items.length) return;
  const first = items[0];
  const last = items.at(-1);
  const active = document.activeElement;
  if (!app.querySelector('.console-sidebar')?.contains(active)) {
    event.preventDefault();
    first.focus();
  } else if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

function handleOperatorResize() {
  if (ui.navOpen && !window.matchMedia('(max-width: 900px)').matches) {
    ui.navOpen = false;
    renderShell();
  }
}

function bindShellEvents() {
  app.querySelector('[data-toggle-nav]')?.addEventListener('click', () => {
    setMobileNavigation(!ui.navOpen, { returnFocus: ui.navOpen });
  });
  app.querySelector('[data-close-nav]')?.addEventListener('click', () => setMobileNavigation(false, { returnFocus: true }));
  app.querySelectorAll('[data-view-target]').forEach((control) => control.addEventListener('click', () => {
    ui.view = control.dataset.viewTarget;
    if (control.dataset.jobId) ui.selectedJobId = control.dataset.jobId;
    ui.navOpen = false;
    renderShell();
    focusOperatorMain();
  }));
  app.querySelector('[data-logout]')?.addEventListener('click', logout);
  app.querySelectorAll('[data-refresh]').forEach((button) => button.addEventListener('click', () => refreshAll({ render: true })));
  app.querySelectorAll('[data-open-dialog]').forEach((button) => button.addEventListener('click', () => {
    if (button.dataset.uploadId) {
      ui.lastUpload = ui.state.uploads.find((upload) => upload.id === button.dataset.uploadId) || ui.lastUpload;
    }
    openDialog(button.dataset.openDialog, { uploadId: button.dataset.uploadId || '' });
  }));
  app.querySelectorAll('[data-principal-id]').forEach((row) => {
    const select = () => {
      ui.selectedPrincipalId = row.dataset.principalId;
      if (ui.view === 'overview') ui.view = 'principals';
      renderShell();
    };
    row.addEventListener('click', select);
    row.addEventListener('keydown', (event) => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); select(); } });
  });
  app.querySelector('[data-close-inspector]')?.addEventListener('click', () => { ui.selectedPrincipalId = ''; renderShell(); });
  app.querySelectorAll('[data-principal-tab]').forEach((button) => button.addEventListener('click', () => { ui.principalTab = button.dataset.principalTab; renderShell(); }));
  app.querySelectorAll('[data-principal-filter]').forEach((button) => button.addEventListener('click', () => {
    ui.principalFilter = button.dataset.principalFilter;
    ui.selectedPrincipalId = '';
    renderShell();
  }));
  app.querySelector('[data-principal-history-toggle]')?.addEventListener('click', () => {
    ui.principalHistoryOpen = !ui.principalHistoryOpen;
    if (!ui.principalHistoryOpen) {
      ui.principalFilter = 'operational';
      ui.selectedPrincipalId = '';
    }
    renderShell();
  });
  app.querySelectorAll('[data-provisioning-filter]').forEach((button) => button.addEventListener('click', () => {
    ui.provisioningFilter = button.dataset.provisioningFilter;
    ui.selectedJobId = '';
    renderShell();
  }));
  app.querySelector('[data-provisioning-history-toggle]')?.addEventListener('click', () => {
    ui.provisioningHistoryOpen = !ui.provisioningHistoryOpen;
    if (!ui.provisioningHistoryOpen) {
      ui.provisioningFilter = 'current';
      ui.selectedJobId = '';
    }
    renderShell();
  });
  app.querySelector('[data-principal-search]')?.addEventListener('input', (event) => {
    ui.principalSearch = event.target.value;
    const caret = event.target.selectionStart;
    renderShell();
    const input = app.querySelector('[data-principal-search]');
    input?.focus();
    input?.setSelectionRange(caret, caret);
  });
  app.querySelectorAll('[data-job-id]').forEach((row) => {
    const select = () => { ui.selectedJobId = row.dataset.jobId; renderShell(); };
    row.addEventListener('click', select);
    row.addEventListener('keydown', (event) => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); select(); } });
  });
  app.querySelector('[data-close-job]')?.addEventListener('click', () => { ui.selectedJobId = '__closed__'; renderShell(); });
  app.querySelectorAll('[data-confirm-job]').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation();
    openDialog('confirm-job', { jobId: button.dataset.confirmJob });
  }));
  app.querySelector('[data-effective-access-form]')?.addEventListener('submit', evaluateAccess);
  app.querySelectorAll('[data-candidate-id]').forEach((row) => {
    const select = () => { ui.selectedCandidateId = row.dataset.candidateId; renderShell(); };
    row.addEventListener('click', select);
    row.addEventListener('keydown', (event) => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); select(); } });
  });
  app.querySelectorAll('[data-candidate-filter]').forEach((button) => button.addEventListener('click', () => {
    ui.candidateFilter = button.dataset.candidateFilter;
    ui.selectedCandidateId = '';
    renderShell();
  }));
  app.querySelector('[data-close-candidate]')?.addEventListener('click', () => { ui.selectedCandidateId = '__closed__'; renderShell(); });
  app.querySelectorAll('[data-review-action]').forEach((button) => button.addEventListener('click', () => openDialog('review-candidate', { action: button.dataset.reviewAction })));
  app.querySelector('[data-promote-candidate]')?.addEventListener('click', () => openDialog('promote-candidate'));
}

async function logout() {
  try {
    await api('/session', { method: 'DELETE' });
  } catch {
    // The local session is cleared even if the server already expired it.
  }
  ui.session = null;
  ui.csrfToken = '';
  ui.state = emptyState();
  ui.candidates = [];
  ui.navOpen = false;
  renderLogin();
}

async function evaluateAccess(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button');
  button.disabled = true;
  ui.selectedPrincipalId = form.elements.principal_id.value;
  ui.effectiveAccessError = '';
  try {
    const payload = envelope(await api(`/access/${encodeURIComponent(form.elements.principal_id.value)}?department_id=${encodeURIComponent(form.elements.department_id.value)}`));
    ui.effectiveAccess = payload.effective_access || payload.access || payload;
  } catch (error) {
    ui.effectiveAccess = null;
    ui.effectiveAccessError = errorMessage(error);
  }
  renderShell();
}

function dialogHeading(title, description = '') {
  return `<header class="dialog-header"><div><h2 id="dialog-title">${escapeHtml(title)}</h2>${description ? `<p>${escapeHtml(description)}</p>` : ''}</div><button class="icon-button" type="button" data-close-dialog aria-label="Close dialog">${icon('x')}</button></header>`;
}

function dialogActions(label, { danger = false } = {}) {
  return `<footer class="dialog-actions"><button class="secondary-button" type="button" data-close-dialog>Cancel</button><button class="${danger ? 'danger-button' : 'primary-button'}" type="submit" value="confirm">${escapeHtml(label)}</button></footer><div class="form-error" role="alert" data-dialog-error hidden></div>`;
}

function principalOptions({ agentsOnly = false } = {}) {
  return ui.state.principals
    .filter((principal) => !agentsOnly || principal.principal_kind === 'agent')
    .map((principal) => `<option value="${escapeHtml(principal.id)}" ${principal.id === ui.selectedPrincipalId ? 'selected' : ''}>${escapeHtml(principal.display_name || principal.principal_key)}</option>`)
    .join('');
}

function openDialog(kind, context = {}) {
  const selected = principalById(ui.selectedPrincipalId);
  const selectedPersonalPair = selected ? personalPairFor(selected.id) : null;
  const personalSuspensionDescription = selected?.principal_kind === 'human'
    ? 'This permanently suspends the employee and their Personal Memory Agent, revokes the private workspace credential, and removes agent host access. There is no self-service or in-product resume.'
    : 'This permanently suspends the Personal Memory Agent, revokes its private workspace credential, and removes agent host access. There is no self-service or in-product resume.';
  const candidate = ui.candidates.find((item) => item.id === ui.selectedCandidateId) || ui.candidates[0];
  const job = ui.state.provisioning_jobs.find((item) => item.id === context.jobId);
  const reviewableUploads = ui.state.uploads.filter((upload) => (
    ['ready_for_review', 'approved_for_promotion'].includes(upload.status)
  ));
  const selectedUploadId = context.uploadId || ui.lastUpload?.id || reviewableUploads[0]?.id || '';
  const templates = {
    'onboard-employee': `${dialogHeading('Onboard employee', 'Creates the employee, their one Personal Memory Agent, and a revocable private workspace credential atomically.')}<input type="hidden" name="action" value="onboard-employee" /><div class="form-grid"><label>Full name<input name="display_name" maxlength="200" autocomplete="name" required /></label><label>Work email<input name="work_email" type="email" maxlength="254" autocomplete="email" required /></label><label>Job title<input name="job_title" maxlength="160" required /></label><label>Personal agent name<input name="agent_display_name" maxlength="200" placeholder="e.g. Alex's Memory Agent" required /></label></div><div class="dialog-note">The agent has its own principal, policy, credential, and lifecycle. It receives only memories the employee explicitly shares and does not impersonate the employee.</div>${dialogActions('Create employee workspace')}`,
    'add-human': `${dialogHeading('Add human principal', 'Creates a logical application principal and department membership.')}<input type="hidden" name="action" value="add-human" /><div class="form-grid"><label>Principal key<input name="principal_key" placeholder="human:principal_key" pattern="human:[a-z0-9][a-z0-9_.-]{1,118}" maxlength="120" required /></label><label>Display name<input name="display_name" maxlength="200" required /></label><label>External issuer<input name="external_issuer" maxlength="200" required /></label><label>External subject<input name="external_subject" maxlength="300" required /></label><label>Membership role<select name="membership_role"><option value="member">Member</option><option value="reviewer">Reviewer</option><option value="architect">Architect</option></select></label></div>${dialogActions('Create human')}`,
    'add-agent': `${dialogHeading('Link agent', 'Creates a draft agent linked to the authenticated human. Permissions are not inherited.')}<input type="hidden" name="action" value="add-agent" /><div class="form-grid"><label class="full">Agent display name<input name="display_name" maxlength="200" required /></label></div><div class="dialog-note">The API stages a broker credential and governed capability grant. Runtime provisioning remains a separate confirmed plan.</div>${dialogActions('Create agent draft')}`,
    provision: `${dialogHeading('Queue provisioning plan', 'The plan must be confirmed at its returned revision before the privileged provisioner can run.')}<input type="hidden" name="action" value="provision" /><div class="form-grid"><label>Agent<select name="principal_id" required>${principalOptions({ agentsOnly: true })}</select></label><label>Operation<select name="operation"><option value="provision_agent">Provision agent</option><option value="verify_agent">Verify agent</option></select></label></div>${dialogActions('Queue plan')}`,
    'confirm-job': `${dialogHeading('Confirm provisioning plan', 'Confirmation is revision-bound. A stale plan is rejected by the API.')}<input type="hidden" name="action" value="confirm-job" /><input type="hidden" name="job_id" value="${escapeHtml(job?.id || '')}" /><div class="confirmation-ledger"><span>Principal<strong>${escapeHtml(principalName(job?.principal_id))}</strong></span><span>Operation<strong>${escapeHtml(humanize(job?.plan?.operation || job?.job_type))}</strong></span><span>Plan hash<code>${escapeHtml(job?.plan_hash || 'Not returned')}</code></span></div><label>Expected revision<input type="number" name="expected_revision" min="0" step="1" value="${escapeHtml(String(job?.revision ?? 0))}" required /></label>${dialogActions('Confirm plan')}`,
    'record-proof': `${dialogHeading('Record access proof', 'Record the outcome of commands that were executed outside this browser.')}<input type="hidden" name="action" value="record-proof" /><div class="form-grid"><label>Proof key<input name="proof_key" pattern="[a-z][a-z0-9_.:-]{1,119}" maxlength="120" required /></label><label>Target kind<select name="target_kind"><option value="principal">Principal</option><option value="runtime_binding">Runtime binding</option><option value="systemd_unit">systemd unit</option><option value="postgres_role">PostgreSQL role</option><option value="workspace">Workspace</option></select></label><label>Target principal<select name="target_key">${principalOptions()}</select></label><label>Status<select name="status"><option value="passed">Passed</option><option value="failed">Failed</option><option value="inconclusive">Inconclusive</option></select></label><label class="full">Commands, one per line<textarea name="commands" rows="4" required></textarea></label><label class="full">Evidence JSON<textarea name="evidence" rows="5">{}</textarea></label></div>${dialogActions('Record proof')}`,
    suspend: `${dialogHeading(selectedPersonalPair ? 'Suspend personal identity' : 'Suspend principal', selectedPersonalPair ? personalSuspensionDescription : 'Suspension closes active memberships, runtime bindings, grants, and queued work.')}<input type="hidden" name="action" value="suspend" /><div class="confirmation-ledger"><span>Principal<strong>${escapeHtml(selected?.display_name || selected?.principal_key || 'No principal selected')}</strong></span><span>Current state<strong>${escapeHtml(humanize(selected?.status || 'unknown'))}</strong></span></div><label>Reason<textarea name="reason" rows="3" maxlength="1000" required></textarea></label>${dialogActions(selectedPersonalPair ? 'Suspend and revoke access' : 'Suspend principal', { danger: true })}`,
    upload: `${dialogHeading('Submit quarantined text', 'Only bounded text/plain and text/markdown content is accepted.')}<input type="hidden" name="action" value="upload" /><div class="form-grid"><label>Original name<input name="original_name" maxlength="255" required /></label><label>Media type<select name="media_type"><option value="text/plain">text/plain</option><option value="text/markdown">text/markdown</option></select></label><label class="full">Content<textarea name="content" rows="12" maxlength="1048576" required></textarea></label></div>${dialogActions('Submit to quarantine')}`,
    'create-candidate': `${dialogHeading('Create candidate', 'Creates a typed candidate bound to sealed bytes; evidence is derived by the server.')}<input type="hidden" name="action" value="create-candidate" /><div class="form-grid"><label class="full">Sealed upload<select name="upload_id" required>${reviewableUploads.map((upload) => `<option value="${escapeHtml(upload.id)}" ${upload.id === selectedUploadId ? 'selected' : ''}>${escapeHtml(upload.original_name)} · ${escapeHtml(compact(upload.sha256, 18))}</option>`).join('')}</select></label><label>Candidate type<select name="candidate_type"><option value="prompt">Prompt</option><option value="workflow">Workflow</option><option value="agent">Agent</option><option value="decision_pattern">Decision pattern</option><option value="best_practice">Best practice</option></select></label><label>Title<input name="title" maxlength="240" required /></label><label class="full">Candidate payload JSON<textarea name="payload" rows="8" required>{}</textarea></label></div>${dialogActions('Create candidate')}`,
    'review-candidate': `${dialogHeading(humanize(context.action), 'The review is applied only to the displayed candidate revision.')}<input type="hidden" name="action" value="review-candidate" /><input type="hidden" name="review_action" value="${escapeHtml(context.action)}" /><div class="confirmation-ledger"><span>Candidate<strong>${escapeHtml(candidate?.title || '')}</strong></span><span>Revision<strong>${escapeHtml(String(candidate?.revision ?? ''))}</strong></span></div><label>Reason<textarea name="reason" rows="4" maxlength="2000" required></textarea></label>${dialogActions(humanize(context.action), { danger: context.action === 'reject' })}`,
    'promote-candidate': `${dialogHeading('Promote approved revision', 'Promotion creates a draft only. It cannot publish canonical memory.')}<input type="hidden" name="action" value="promote-candidate" /><div class="confirmation-ledger"><span>Candidate<strong>${escapeHtml(candidate?.title || '')}</strong></span><span>Revision<strong>${escapeHtml(String(candidate?.revision ?? ''))}</strong></span><span>Result<strong>Draft canonical memory</strong></span></div>${dialogActions('Promote to draft')}`,
  };
  if (!templates[kind]) return;
  dialogForm.innerHTML = templates[kind];
  dialogForm.dataset.dialogKind = kind;
  dialogForm.onsubmit = handleDialogSubmit;
  dialogForm.querySelectorAll('[data-close-dialog]').forEach((button) => {
    button.addEventListener('click', () => dialog.close());
  });
  dialog.showModal();
  window.setTimeout(() => dialogForm.querySelector('input:not([type="hidden"]), select, textarea')?.focus());
}

function parseJsonField(value, label) {
  try {
    const result = JSON.parse(value || '{}');
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
    return result;
  } catch {
    throw new Error(`${label} must be a JSON object.`);
  }
}

async function handleDialogSubmit(event) {
  event.preventDefault();
  const submitter = event.submitter;
  if (submitter?.value === 'cancel') {
    dialog.close();
    return;
  }
  const action = dialogForm.elements.action.value;
  const selected = principalById(ui.selectedPrincipalId);
  const candidate = ui.candidates.find((item) => item.id === ui.selectedCandidateId) || ui.candidates[0];
  const errorTarget = dialogForm.querySelector('[data-dialog-error]');
  const confirm = dialogForm.querySelector('[value="confirm"]');
  const confirmLabel = confirm.textContent;
  errorTarget.hidden = true;
  confirm.disabled = true;
  confirm.textContent = 'Submitting…';
  try {
    let payload;
    if (action === 'onboard-employee') {
      payload = await api('/employees', { method: 'POST', body: {
        display_name: dialogForm.elements.display_name.value,
        work_email: dialogForm.elements.work_email.value,
        job_title: dialogForm.elements.job_title.value,
        agent_display_name: dialogForm.elements.agent_display_name.value,
      } });
    } else if (action === 'add-human') {
      payload = await api('/humans', { method: 'POST', body: {
        principal_key: dialogForm.elements.principal_key.value,
        display_name: dialogForm.elements.display_name.value,
        external_issuer: dialogForm.elements.external_issuer.value,
        external_subject: dialogForm.elements.external_subject.value,
        membership_role: dialogForm.elements.membership_role.value,
      } });
    } else if (action === 'add-agent') {
      payload = await api('/agents', { method: 'POST', body: { display_name: dialogForm.elements.display_name.value } });
    } else if (action === 'provision') {
      payload = await api('/provisioning/plans', { method: 'POST', body: { principal_id: dialogForm.elements.principal_id.value, operation: dialogForm.elements.operation.value } });
    } else if (action === 'confirm-job') {
      payload = await api(`/provisioning/plans/${encodeURIComponent(dialogForm.elements.job_id.value)}/confirm`, { method: 'POST', body: { expected_revision: Number(dialogForm.elements.expected_revision.value) } });
    } else if (action === 'record-proof') {
      payload = await api('/proofs', { method: 'POST', body: {
        proof_key: dialogForm.elements.proof_key.value,
        target_kind: dialogForm.elements.target_kind.value,
        target_key: dialogForm.elements.target_key.value,
        status: dialogForm.elements.status.value,
        commands: dialogForm.elements.commands.value.split('\n').map((line) => line.trim()).filter(Boolean),
        evidence: parseJsonField(dialogForm.elements.evidence.value, 'Evidence'),
      } });
    } else if (action === 'suspend') {
      if (!selected) throw new Error('Select a principal first.');
      payload = await api(`/principals/${encodeURIComponent(selected.id)}/suspend`, { method: 'POST', body: { reason: dialogForm.elements.reason.value } });
    } else if (action === 'upload') {
      payload = await api('/uploads', { method: 'POST', body: {
        original_name: dialogForm.elements.original_name.value,
        media_type: dialogForm.elements.media_type.value,
        content: dialogForm.elements.content.value,
      } });
      const data = envelope(payload);
      ui.lastUpload = data.upload || data;
    } else if (action === 'create-candidate') {
      const uploadId = dialogForm.elements.upload_id.value;
      if (!uploadId) throw new Error('Select a sealed upload.');
      payload = await api(`/uploads/${encodeURIComponent(uploadId)}/candidates`, { method: 'POST', body: {
        candidate_type: dialogForm.elements.candidate_type.value,
        title: dialogForm.elements.title.value,
        payload: parseJsonField(dialogForm.elements.payload.value, 'Candidate payload'),
      } });
    } else if (action === 'review-candidate') {
      if (!candidate) throw new Error('No candidate is selected.');
      payload = await api(`/candidates/${encodeURIComponent(candidate.id)}/reviews`, { method: 'POST', body: { action: dialogForm.elements.review_action.value, reason: dialogForm.elements.reason.value, expected_revision: Number(candidate.revision) } });
    } else if (action === 'promote-candidate') {
      if (!candidate) throw new Error('No candidate is selected.');
      payload = await api(`/candidates/${encodeURIComponent(candidate.id)}/promote`, { method: 'POST', body: { expected_revision: Number(candidate.revision) } });
    }
    await refreshAll();
    const candidateAction = ['create-candidate', 'review-candidate', 'promote-candidate'].includes(action);
    if (ui.loadErrors.state || (candidateAction && ui.loadErrors.candidates)) {
      throw new Error(`The operation was accepted, but live-state verification failed: ${ui.loadErrors.state || ui.loadErrors.candidates}`);
    }
    const data = envelope(payload);
    const returned = data.principal || data.agent || data.job || data.proof || data.candidate || data.draft || data;
    if (action === 'onboard-employee') {
      const employee = data.employee || data.human || {};
      const agent = data.personal_agent || data.agent || {};
      const token = data.workspace_access?.token || data.workspace_token || '';
      if (!token) throw new Error('The employee was created, but the workspace credential was not returned in the creation response. Rotate it before sharing access.');
      const workspaceUrl = new URL('/workspace/', window.location.origin);
      workspaceUrl.hash = `access_token=${encodeURIComponent(token)}`;
      dialogForm.innerHTML = `${dialogHeading('Employee workspace created', 'Complete the agent provisioning plan, then share this private access link through an approved channel. The raw credential is returned only in this creation response and is masked on screen.')}<div class="confirmation-ledger"><span>Employee<strong>${escapeHtml(employee.display_name || employee.principal_key || 'Created')}</strong></span><span>Personal Memory Agent<strong>${escapeHtml(agent.display_name || agent.principal_key || 'Created')}</strong></span><span>Pairing<strong>Draft until physical provisioning passes</strong></span></div><label class="full">Private workspace link<input type="password" name="workspace_link" readonly value="${escapeHtml(workspaceUrl.href)}" aria-label="Masked private workspace link" /></label><div class="dialog-note">After provisioning, opening the link creates a secure HttpOnly session and every request revalidates the revocable workspace credential. The agent remains a distinct principal and sees only explicitly shared personal memory.</div><footer class="dialog-actions"><button class="secondary-button" type="button" data-close-dialog>Close</button><button class="primary-button" type="button" data-copy-workspace-link>${icon('link', 15)}Copy private link</button></footer>`;
      dialogForm.querySelectorAll('[data-close-dialog]').forEach((button) => {
        button.addEventListener('click', () => dialog.close());
      });
      dialogForm.querySelector('[data-copy-workspace-link]')?.addEventListener('click', async () => {
        await navigator.clipboard.writeText(workspaceUrl.href);
        toast('Private workspace link copied.');
      });
      ui.selectedPrincipalId = agent.id || employee.id || ui.selectedPrincipalId;
      toast('Employee and Personal Memory Agent created.');
      renderShell();
      return;
    }
    dialog.close();
    if (returned?.id && ['add-human', 'add-agent'].includes(action)) ui.selectedPrincipalId = returned.id;
    if (returned?.id && ['provision', 'confirm-job'].includes(action)) ui.selectedJobId = returned.id;
    if (action === 'provision') {
      ui.provisioningFilter = 'current';
      ui.provisioningHistoryOpen = false;
    }
    if (returned?.id && action === 'create-candidate') ui.selectedCandidateId = returned.id;
    toast('The API accepted the operation and live state was reloaded.');
    renderShell();
  } catch (error) {
    errorTarget.textContent = errorMessage(error);
    errorTarget.hidden = false;
    confirm.disabled = false;
    confirm.textContent = confirmLabel;
  }
}

document.addEventListener('keydown', handleOperatorNavigationKeydown);
window.addEventListener('resize', handleOperatorResize);
restoreSession();
