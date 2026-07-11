import { wrapEmployeeService } from './employee-db-context.mjs';
import { EmployeeRepositoryError } from './employee-repository.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const MEMORY_TYPES = new Set(['experience', 'lesson', 'preference', 'skill', 'decision', 'pattern']);
const SENSITIVITIES = new Set(['private', 'restricted']);
const SHARING_SCOPES = new Set(['owner_only', 'owner_and_personal_agent']);
const PERSONAL_MEMORY_LIMITATIONS = Object.freeze([
  'Only current profile and memory versions explicitly shared with this Personal Memory Agent were searched.',
  'Owner-only, restricted, historical, and organizational sources were not searched.',
]);

function boundedText(value, maxLength) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function databaseContractFailed() {
  throw new EmployeeRepositoryError(
    'employee_service_unavailable',
    'The employee workspace is temporarily unavailable.',
    503,
  );
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function isRevision(value) {
  return Number.isSafeInteger(value) && value >= 1;
}

function validMemory(item) {
  return isObject(item)
    && UUID.test(item.id || '')
    && MEMORY_TYPES.has(item.memory_type)
    && SENSITIVITIES.has(item.sensitivity)
    && SHARING_SCOPES.has(item.sharing_scope)
    && typeof item.agent_shared === 'boolean'
    && item.agent_shared === (item.sharing_scope === 'owner_and_personal_agent')
    && (item.sensitivity !== 'restricted' || item.sharing_scope === 'owner_only')
    && isRevision(item.revision)
    && (!('current_revision' in item) || item.current_revision === item.revision)
    && SHA256.test(item.content_sha256 || '')
    && typeof item.title === 'string' && item.title.trim().length >= 1 && item.title.trim().length <= 200
    && typeof item.content === 'string' && item.content.trim().length >= 1 && item.content.trim().length <= 12_000
    && typeof item.context === 'string' && item.context.length <= 4_000
    && typeof item.why_it_worked === 'string' && item.why_it_worked.length <= 4_000
    && Array.isArray(item.evidence)
    && Array.isArray(item.tags);
}

function validProfile(profile) {
  return isObject(profile)
    && UUID.test(profile.id || '')
    && SHARING_SCOPES.has(profile.sharing_scope)
    && typeof profile.agent_shared === 'boolean'
    && profile.agent_shared === (profile.sharing_scope === 'owner_and_personal_agent')
    && isRevision(profile.revision)
    && SHA256.test(profile.content_sha256 || '')
    && typeof profile.job_title === 'string'
    && profile.job_title.trim().length >= 1 && profile.job_title.trim().length <= 160
    && typeof profile.role_summary === 'string' && profile.role_summary.length <= 2_000
    && Array.isArray(profile.expertise)
    && profile.expertise.length <= 32
    && profile.expertise.every((entry) => typeof entry === 'string' && entry.length >= 1 && entry.length <= 120)
    && typeof profile.working_style === 'string' && profile.working_style.length <= 2_000
    && Array.isArray(profile.current_goals)
    && profile.current_goals.length <= 24
    && profile.current_goals.every((entry) => typeof entry === 'string' && entry.length >= 1 && entry.length <= 240)
    && typeof profile.boundaries === 'string' && profile.boundaries.length <= 2_000;
}

function projectMemory(item) {
  return {
    ...('source_type' in item ? { source_type: item.source_type } : {}),
    id: item.id,
    memory_type: item.memory_type,
    title: item.title,
    content: item.content,
    context: item.context,
    why_it_worked: item.why_it_worked,
    evidence: item.evidence,
    tags: item.tags,
    sensitivity: item.sensitivity,
    sharing_scope: item.sharing_scope,
    agent_shared: item.agent_shared,
    ...('status' in item ? { status: item.status } : {}),
    ...('current_revision' in item ? { current_revision: item.current_revision } : {}),
    revision: item.revision,
    content_sha256: item.content_sha256,
    ...('created_at' in item ? { created_at: item.created_at } : {}),
    ...('updated_at' in item ? { updated_at: item.updated_at } : {}),
  };
}

function projectProfile(profile, { includeSourceType = false } = {}) {
  return {
    ...(includeSourceType ? { source_type: 'profile' } : {}),
    id: profile.id,
    job_title: profile.job_title,
    role_summary: profile.role_summary,
    expertise: [...profile.expertise],
    working_style: profile.working_style,
    current_goals: [...profile.current_goals],
    boundaries: profile.boundaries,
    sharing_scope: profile.sharing_scope,
    agent_shared: profile.agent_shared,
    revision: profile.revision,
    content_sha256: profile.content_sha256,
    ...('created_at' in profile ? { created_at: profile.created_at } : {}),
  };
}

function assertWorkspaceContract(workspace, actor) {
  if (!isObject(workspace)
      || workspace.schema_version !== 1
      || !isObject(workspace.principal)
      || workspace.principal?.id !== actor.principal_id
      || typeof workspace.principal.principal_key !== 'string'
      || typeof workspace.principal.display_name !== 'string'
      || workspace.principal.status !== 'active'
      || typeof workspace.principal.membership_role !== 'string'
      || !isObject(workspace.department)
      || workspace.department?.id !== actor.department_id
      || typeof workspace.department.department_key !== 'string'
      || typeof workspace.department.display_name !== 'string'
      || workspace.department.status !== 'active'
      || !isObject(workspace.agent)
      || workspace.agent?.id !== actor.agent_id
      || typeof workspace.agent.principal_key !== 'string'
      || typeof workspace.agent.display_name !== 'string'
      || workspace.agent.status !== 'active'
      || workspace.agent.pair_status !== 'active'
      || !Array.isArray(workspace.memories)
      || !workspace.memories.every(validMemory)
      || (workspace.profile !== null && !isObject(workspace.profile))) {
    databaseContractFailed();
  }
  if (workspace.profile !== null && !validProfile(workspace.profile)) {
    databaseContractFailed();
  }
}

function assertProfileWrite(document, expectedRevision) {
  if (!validProfile(document)
      || document.revision !== expectedRevision + 1
      || document.sharing_scope !== 'owner_only'
      || document.agent_shared !== false
      || !UUID.test(document.audit_event_key || '')) {
    databaseContractFailed();
  }
  return document;
}

function assertProfileSharingWrite(document, expectedRevision, sharingScope) {
  const changed = document?.revision === expectedRevision + 1;
  if (!validProfile(document)
      || (document.revision !== expectedRevision && !changed)
      || document.sharing_scope !== sharingScope
      || document.agent_shared !== (sharingScope === 'owner_and_personal_agent')
      || (changed && !UUID.test(document.audit_event_key || ''))
      || (!changed && 'audit_event_key' in document)) {
    databaseContractFailed();
  }
  return document;
}

function assertMemoryWrite(document, { expectedRevision, newRecord = false } = {}) {
  const requiredRevision = newRecord ? 1 : expectedRevision + 1;
  if (!validMemory(document)
      || document.current_revision !== requiredRevision
      || document.revision !== requiredRevision
      || document.sharing_scope !== 'owner_only'
      || document.agent_shared !== false
      || !UUID.test(document.audit_event_key || '')) {
    databaseContractFailed();
  }
  return document;
}

function assertSharingWrite(document, memoryId, expectedRevision, sharingScope) {
  const changed = document?.revision === expectedRevision + 1;
  if (!isObject(document)
      || document.id !== memoryId
      || document.current_revision !== document.revision
      || !isRevision(document.revision)
      || (document.revision !== expectedRevision && !changed)
      || document.sharing_scope !== sharingScope
      || document.agent_shared !== (sharingScope === 'owner_and_personal_agent')
      || (changed && (!SHA256.test(document.content_sha256 || '')
        || !UUID.test(document.audit_event_key || '')))) {
    databaseContractFailed();
  }
  return document;
}

function projectAgentContext(document, submittedQuery, actor) {
  const source = isObject(document) ? document : {};
  if (source.schema_version !== 1
      || source.authorization !== 'allowed'
      || source.principal?.human_id !== actor.principal_id
      || source.principal?.department_id !== actor.department_id
      || source.principal?.agent_id !== actor.agent_id
      || !isObject(source.query)
      || typeof source.query.text !== 'string'
      || source.query.text !== submittedQuery.trim().replace(/\s+/g, ' ')
      || source.query.limit !== 10
      || !Number.isSafeInteger(source.query.matched_count)
      || source.query.matched_count < 0
      || source.query.matched_count > 10
      || !Array.isArray(source.items)
      || source.items.length !== source.query.matched_count
      || !source.items.every((item) => (
        item?.source_type === 'memory'
          ? validMemory(item)
            && item.sharing_scope === 'owner_and_personal_agent'
            && item.agent_shared === true
            && item.sensitivity === 'private'
          : item?.source_type === 'profile'
            && validProfile(item)
            && item.sharing_scope === 'owner_and_personal_agent'
            && item.agent_shared === true
      ))
      || !Array.isArray(source.citations)
      || source.citations.length !== source.items.length
      || !UUID.test(source.audit_event_key || '')) {
    databaseContractFailed();
  }
  const sourceItems = source.items;
  for (let index = 0; index < sourceItems.length; index += 1) {
    const citation = source.citations[index];
    const item = sourceItems[index];
    const sourceIdField = item.source_type === 'profile' ? 'profile_id' : 'memory_id';
    if (!isObject(citation)
        || citation.source_type !== item.source_type
        || citation.source_id !== item.id
        || citation[sourceIdField] !== item.id
        || citation.revision !== item.revision
        || citation.content_sha256 !== item.content_sha256
        || !isObject(item.citation)
        || item.citation.source_type !== citation.source_type
        || item.citation.source_id !== citation.source_id
        || item.citation[sourceIdField] !== citation[sourceIdField]
        || item.citation.revision !== citation.revision
        || item.citation.content_sha256 !== citation.content_sha256) {
      databaseContractFailed();
    }
  }
  const items = sourceItems.map((item) => (
    item.source_type === 'profile'
      ? projectProfile(item, { includeSourceType: true })
      : projectMemory(item)
  ));
  const citations = items.map((item) => ({
    source_type: item.source_type,
    source_id: item.id,
    ...(item.source_type === 'profile'
      ? { profile_id: item.id, title: 'Employee profile' }
      : {
          memory_id: item.id,
          title: boundedText(item.title, 200) || 'Untitled memory',
          memory_type: item.memory_type,
        }),
    revision: item.revision,
    content_sha256: item.content_sha256,
    excerpt: item.source_type === 'profile'
      ? boundedText(item.role_summary || item.job_title, 280)
      : boundedText(item.content, 280),
    visibility: 'personal_agent',
  }));
  const answer = items.map((item, index) => {
    if (item.source_type === 'profile') {
      return [
        `${index + 1}. Employee profile`,
        `Job title: ${boundedText(item.job_title, 160)}`,
        item.role_summary ? `Role summary: ${boundedText(item.role_summary, 500)}` : '',
        item.expertise.length ? `Expertise: ${item.expertise.map((entry) => boundedText(entry, 120)).join(', ')}` : '',
        item.working_style ? `Working style: ${boundedText(item.working_style, 320)}` : '',
        item.current_goals.length ? `Current goals: ${item.current_goals.map((entry) => boundedText(entry, 180)).join('; ')}` : '',
        item.boundaries ? `Working constraints: ${boundedText(item.boundaries, 320)}` : '',
      ].filter(Boolean).join('\n');
    }
    const title = boundedText(item.title, 200) || 'Untitled memory';
    const content = boundedText(item.content, 800);
    const whyItWorked = boundedText(item.why_it_worked, 320);
    return [
      `${index + 1}. ${title}`,
      content,
      whyItWorked ? `Why it worked: ${whyItWorked}` : '',
    ].filter(Boolean).join('\n');
  }).join('\n\n');
  return {
    schema_version: source.schema_version,
    authorization: source.authorization,
    principal: {
      human_id: source.principal.human_id,
      agent_id: source.principal.agent_id,
      department_id: source.principal.department_id,
    },
    query: {
      text: source.query.text,
      limit: source.query.limit,
      matched_count: source.query.matched_count,
    },
    status: items.length ? 'matched' : 'no_match',
    mode: 'deterministic_personal_memory',
    answer,
    citations,
    limitations: [...PERSONAL_MEMORY_LIMITATIONS],
    items,
    audit_event_key: source.audit_event_key,
  };
}

export function createEmployeeService({ repository } = {}) {
  if (!repository) throw new TypeError('An employee repository is required.');
  const service = {
    async validateSession(actor) {
      const current = await repository.currentContext();
      if (current.principal_id !== actor.principal_id
          || current.department_id !== actor.department_id
          || current.agent_id !== actor.agent_id) {
        throw new EmployeeRepositoryError('authentication_failed', 'Authentication is required.', 401);
      }
      return true;
    },
    async workspace(actor) {
      const workspace = await repository.workspace();
      assertWorkspaceContract(workspace, actor);
      return {
        schema_version: workspace.schema_version,
        actor: {
          id: workspace.principal.id,
          principal_key: workspace.principal.principal_key,
          display_name: workspace.principal.display_name,
          status: workspace.principal.status,
          membership_role: workspace.principal.membership_role,
        },
        department: {
          id: workspace.department.id,
          department_key: workspace.department.department_key,
          display_name: workspace.department.display_name,
          status: workspace.department.status,
        },
        personal_agent: {
          id: workspace.agent.id,
          principal_key: workspace.agent.principal_key,
          display_name: workspace.agent.display_name,
          status: workspace.agent.status,
          pair_status: workspace.agent.pair_status,
        },
        profile: workspace.profile === null ? null : projectProfile(workspace.profile),
        memories: workspace.memories.map(projectMemory),
      };
    },
    async updateProfile(_actor, input) {
      return assertProfileWrite(await repository.updateProfile(input), input.expected_revision);
    },
    async shareProfile(_actor, expectedRevision) {
      return assertProfileSharingWrite(
        await repository.shareProfile(expectedRevision),
        expectedRevision,
        'owner_and_personal_agent',
      );
    },
    async unshareProfile(_actor, expectedRevision) {
      return assertProfileSharingWrite(
        await repository.unshareProfile(expectedRevision),
        expectedRevision,
        'owner_only',
      );
    },
    async createMemory(_actor, input) {
      return assertMemoryWrite(await repository.createMemory(input), { newRecord: true });
    },
    async updateMemory(_actor, memoryId, input) {
      return assertMemoryWrite(await repository.updateMemory(memoryId, input), {
        expectedRevision: input.expected_revision,
      });
    },
    async shareMemory(_actor, memoryId, expectedRevision) {
      return assertSharingWrite(
        await repository.shareMemory(memoryId, expectedRevision),
        memoryId,
        expectedRevision,
        'owner_and_personal_agent',
      );
    },
    async unshareMemory(_actor, memoryId, expectedRevision) {
      return assertSharingWrite(
        await repository.unshareMemory(memoryId, expectedRevision),
        memoryId,
        expectedRevision,
        'owner_only',
      );
    },
    async agentContext(actor, query) {
      return projectAgentContext(await repository.agentContext(query, 10), query, actor);
    },
  };
  return Object.freeze(wrapEmployeeService(service));
}
