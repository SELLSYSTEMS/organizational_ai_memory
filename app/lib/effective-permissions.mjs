export const PERMISSIONS = Object.freeze({
  PUBLIC_MEMORY_READ: 'memory.public.read',
  DEPARTMENT_MEMORY_READ: 'memory.department.read',
  QUARANTINE_SUBMIT: 'quarantine.submit',
  CANDIDATE_CREATE: 'candidate.create',
  CANDIDATE_REVIEW: 'candidate.review',
  CANDIDATE_PROMOTE_AS_DRAFT: 'candidate.promote_as_draft',
  PROVISIONING_QUEUE: 'provisioning.queue',
  PROVISIONING_CONFIRM: 'provisioning.confirm',
  PROOF_RECORD: 'proof.record',
  PRINCIPAL_SUSPEND: 'principal.suspend',
  AUDIT_APPEND: 'audit.append',
  AUDIT_READ: 'audit.read',
  CANONICAL_MEMORY_WRITE: 'memory.canonical.write',
});

const ALL_PERMISSIONS = new Set(Object.values(PERMISSIONS));
const PRINCIPAL_KINDS = new Set(['human', 'agent', 'service']);
const MEMBERSHIP_ROLES = new Set(['member', 'reviewer', 'architect']);
const DATABASE_BINDINGS = new Set(['postgres_role']);
const HUMAN_RUNTIME_BINDINGS = new Set(['linux_user', 'systemd_unit', 'postgres_role']);
const DEPARTMENT_SCOPED = new Set([
  PERMISSIONS.DEPARTMENT_MEMORY_READ,
  PERMISSIONS.QUARANTINE_SUBMIT,
  PERMISSIONS.CANDIDATE_CREATE,
  PERMISSIONS.CANDIDATE_REVIEW,
  PERMISSIONS.CANDIDATE_PROMOTE_AS_DRAFT,
  PERMISSIONS.PROVISIONING_QUEUE,
  PERMISSIONS.PROVISIONING_CONFIRM,
  PERMISSIONS.PROOF_RECORD,
  PERMISSIONS.PRINCIPAL_SUSPEND,
  PERMISSIONS.AUDIT_READ,
]);
const NEVER_SPONSOR_DERIVED = new Set([
  PERMISSIONS.PUBLIC_MEMORY_READ,
  PERMISSIONS.AUDIT_APPEND,
]);

const KIND_CEILINGS = Object.freeze({
  human: new Set([
    PERMISSIONS.PUBLIC_MEMORY_READ,
    PERMISSIONS.DEPARTMENT_MEMORY_READ,
    PERMISSIONS.QUARANTINE_SUBMIT,
    PERMISSIONS.CANDIDATE_CREATE,
    PERMISSIONS.CANDIDATE_REVIEW,
    PERMISSIONS.CANDIDATE_PROMOTE_AS_DRAFT,
    PERMISSIONS.PROVISIONING_QUEUE,
    PERMISSIONS.PROVISIONING_CONFIRM,
    PERMISSIONS.PROOF_RECORD,
    PERMISSIONS.PRINCIPAL_SUSPEND,
    PERMISSIONS.AUDIT_APPEND,
    PERMISSIONS.AUDIT_READ,
  ]),
  agent: new Set([
    PERMISSIONS.PUBLIC_MEMORY_READ,
    PERMISSIONS.DEPARTMENT_MEMORY_READ,
    PERMISSIONS.QUARANTINE_SUBMIT,
    PERMISSIONS.CANDIDATE_CREATE,
    PERMISSIONS.AUDIT_APPEND,
  ]),
  service: new Set([
    PERMISSIONS.PUBLIC_MEMORY_READ,
    PERMISSIONS.DEPARTMENT_MEMORY_READ,
    PERMISSIONS.CANDIDATE_CREATE,
    PERMISSIONS.PROOF_RECORD,
    PERMISSIONS.AUDIT_APPEND,
  ]),
});

function asDate(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new TypeError(`${label} must be a valid date.`);
  return date;
}

function isActiveAt(record, at) {
  if (!record || (record.status && record.status !== 'active')) return false;
  const validFrom = record.valid_from ? asDate(record.valid_from, 'valid_from') : null;
  const validTo = record.valid_to ? asDate(record.valid_to, 'valid_to') : null;
  return (!validFrom || validFrom <= at) && (!validTo || validTo > at);
}

function normalizePrincipal(principal) {
  if (!principal || typeof principal !== 'object' || Array.isArray(principal)) {
    throw new TypeError('principal must be an object.');
  }
  if (!PRINCIPAL_KINDS.has(principal.principal_kind)) throw new TypeError('principal_kind is unsupported.');
  if (typeof principal.id !== 'string' || !principal.id) throw new TypeError('principal.id is required.');
  return principal;
}

function relevantMemberships(principal, memberships, departmentId, at) {
  return memberships.filter((membership) => membership
    && MEMBERSHIP_ROLES.has(membership.membership_role)
    && membership.principal_id === principal.id
    && membership.department_id === departmentId
    && isActiveAt(membership, at));
}

function activeBindings(principal, bindings, at) {
  return bindings.filter((binding) => binding
    && binding.principal_id === principal.id
    && isActiveAt(binding, at));
}

function legacyRolePermissions(kind, roles, bindings) {
  const permissions = new Set([PERMISSIONS.PUBLIC_MEMORY_READ, PERMISSIONS.AUDIT_APPEND]);
  if (!roles.size) return permissions;
  permissions.add(PERMISSIONS.DEPARTMENT_MEMORY_READ);
  if (kind === 'human') {
    permissions.add(PERMISSIONS.PROVISIONING_QUEUE);
    permissions.add(PERMISSIONS.QUARANTINE_SUBMIT);
    if (roles.has('reviewer') || roles.has('architect')) {
      permissions.add(PERMISSIONS.CANDIDATE_REVIEW);
      permissions.add(PERMISSIONS.PROOF_RECORD);
    }
    if (roles.has('architect')) {
      permissions.add(PERMISSIONS.CANDIDATE_PROMOTE_AS_DRAFT);
      permissions.add(PERMISSIONS.PROVISIONING_CONFIRM);
      permissions.add(PERMISSIONS.PRINCIPAL_SUSPEND);
      permissions.add(PERMISSIONS.AUDIT_READ);
    }
  }
  const brokered = bindings.some((binding) =>
    binding.binding_kind === 'broker_client' && binding.access_mode === 'brokered');
  if ((kind === 'agent' || kind === 'service') && brokered) permissions.add(PERMISSIONS.CANDIDATE_CREATE);
  if (kind === 'service') permissions.add(PERMISSIONS.PROOF_RECORD);
  return permissions;
}

function roleMaximum(kind, roles) {
  const maximum = new Set(KIND_CEILINGS[kind]);
  if (!roles.size) {
    for (const permission of DEPARTMENT_SCOPED) maximum.delete(permission);
    return maximum;
  }
  if (kind === 'human' && !roles.has('reviewer') && !roles.has('architect')) {
    maximum.delete(PERMISSIONS.CANDIDATE_REVIEW);
    maximum.delete(PERMISSIONS.PROOF_RECORD);
  }
  if (kind === 'human' && !roles.has('architect')) {
    maximum.delete(PERMISSIONS.CANDIDATE_PROMOTE_AS_DRAFT);
    maximum.delete(PERMISSIONS.PROVISIONING_CONFIRM);
    maximum.delete(PERMISSIONS.PRINCIPAL_SUSPEND);
    maximum.delete(PERMISSIONS.AUDIT_READ);
  }
  return maximum;
}

function evaluatePolicyRules(policyRules, at, findings) {
  const allows = new Set();
  const denies = new Set();
  const sources = new Map();
  for (const rule of policyRules) {
    if (!rule || !isActiveAt(rule, at)) continue;
    const permission = rule.permission_key;
    if (!ALL_PERMISSIONS.has(permission)) {
      findings.push({ code: 'unknown_policy_permission', permission_key: String(permission || '') });
      continue;
    }
    if (rule.conditions && Object.keys(rule.conditions).length) {
      findings.push({ code: 'unsupported_policy_conditions', permission_key: permission });
      denies.add(permission);
      continue;
    }
    const source = rule.source || rule.template_key || 'policy_template';
    if (!sources.has(permission)) sources.set(permission, []);
    sources.get(permission).push(source);
    if (rule.effect === 'deny') denies.add(permission);
    else if (rule.effect === 'allow') allows.add(permission);
    else findings.push({ code: 'invalid_policy_effect', permission_key: permission });
  }
  return { allows, denies, sources };
}

function runtimeFindings(principal, roles, bindings) {
  const findings = [];
  if (principal.principal_kind === 'human' && !roles.has('architect')) {
    for (const binding of bindings) {
      if (HUMAN_RUNTIME_BINDINGS.has(binding.binding_kind)) {
        findings.push({
          code: 'ordinary_human_must_remain_logical_only',
          binding_kind: binding.binding_kind,
          binding_value: binding.binding_value,
        });
      }
    }
  }
  if (principal.principal_kind === 'agent') {
    if (!bindings.some((binding) => binding.binding_kind === 'broker_client' && binding.access_mode === 'brokered')) {
      findings.push({ code: 'agent_broker_binding_required' });
    }
    for (const binding of bindings) {
      if (DATABASE_BINDINGS.has(binding.binding_kind) && binding.access_mode === 'direct') {
        findings.push({
          code: 'agent_direct_database_binding_requires_exception',
          binding_kind: binding.binding_kind,
          binding_value: binding.binding_value,
        });
      }
    }
  }
  return findings;
}

function frozenResult({
  principal,
  at,
  permissions,
  denials,
  findings,
  sources,
  policyAssignments = [],
  sponsorPrincipalId = null,
}) {
  const orderedPermissions = Object.freeze([...permissions].sort());
  const orderedDenials = Object.freeze([...denials].sort());
  const orderedFindings = Object.freeze([...findings].sort((left, right) =>
    `${left.code}:${left.permission_key || ''}:${left.binding_value || ''}`
      .localeCompare(`${right.code}:${right.permission_key || ''}:${right.binding_value || ''}`)));
  const decisions = Object.freeze([...ALL_PERMISSIONS].sort().map((permission) => Object.freeze({
    permission,
    state: orderedPermissions.includes(permission) ? 'allowed' : 'denied',
    sources: Object.freeze([...(sources.get(permission) || [])].sort()),
    explicit_deny: orderedDenials.includes(permission),
  })));
  return Object.freeze({
    principal_id: principal.id,
    evaluated_at: at.toISOString(),
    permissions: orderedPermissions,
    explicit_denials: orderedDenials,
    runtime_findings: orderedFindings,
    policy_assignment_ids: Object.freeze(policyAssignments.map((assignment) => assignment.id).filter(Boolean).sort()),
    policy_template_ids: Object.freeze([...new Set(policyAssignments.map((assignment) => assignment.template_id))]
      .filter(Boolean).sort()),
    sponsor_principal_id: sponsorPrincipalId,
    decisions,
    can(permission) {
      return orderedPermissions.includes(permission) && !orderedDenials.includes(permission);
    },
  });
}

export function computeEffectiveAccess({
  principal,
  memberships = [],
  bindings = [],
  policyAssignments = [],
  policyRules = [],
  explicitDenials = [],
  sponsorPermissions = null,
  sponsorPrincipalId = null,
  requireSponsorIntersection = false,
  requirePolicyAssignment = false,
  resourceDepartmentId,
  at = new Date(),
} = {}) {
  const actor = normalizePrincipal(principal);
  if (!Array.isArray(memberships) || !Array.isArray(bindings)
      || !Array.isArray(policyAssignments) || !Array.isArray(policyRules)) {
    throw new TypeError('memberships, bindings, policyAssignments, and policyRules must be arrays.');
  }
  if (!Array.isArray(explicitDenials)) throw new TypeError('explicitDenials must be an array.');
  if (typeof resourceDepartmentId !== 'string' || !resourceDepartmentId) {
    throw new TypeError('resourceDepartmentId is required.');
  }
  const evaluatedAt = asDate(at, 'at');
  const denials = new Set([PERMISSIONS.CANONICAL_MEMORY_WRITE]);
  const findings = [];
  const sources = new Map();
  if (actor.status !== 'active') {
    return frozenResult({
      principal: actor,
      at: evaluatedAt,
      permissions: new Set(),
      denials,
      findings,
      sources,
      sponsorPrincipalId,
    });
  }

  const membershipsForDepartment = relevantMemberships(
    actor,
    memberships,
    resourceDepartmentId,
    evaluatedAt,
  );
  const roles = new Set(membershipsForDepartment.map((membership) => membership.membership_role));
  const bindingsForActor = activeBindings(actor, bindings, evaluatedAt);
  const assignmentsForActor = policyAssignments.filter((assignment) => assignment
    && (assignment.principal_id === actor.id
      || (assignment.assignment_scope === 'department' && assignment.principal_id == null))
    && assignment.department_id === resourceDepartmentId
    && isActiveAt(assignment, evaluatedAt));
  const assignedTemplateIds = new Set(assignmentsForActor.map((assignment) => assignment.template_id));
  const applicableRules = policyRules.filter((rule) => rule
    && (!requirePolicyAssignment || assignedTemplateIds.has(rule.template_id))
    && (!rule.principal_kind || rule.principal_kind === actor.principal_kind)
    && (!rule.membership_role || roles.has(rule.membership_role)));
  const ceiling = roleMaximum(actor.principal_kind, roles);
  const policy = evaluatePolicyRules(applicableRules, evaluatedAt, findings);
  let permissions;
  if (requirePolicyAssignment) {
    permissions = new Set([PERMISSIONS.PUBLIC_MEMORY_READ, PERMISSIONS.AUDIT_APPEND]);
    if (!assignmentsForActor.length) {
      findings.push({ code: 'policy_assignment_missing' });
    } else if (!applicableRules.length) {
      findings.push({ code: 'policy_allow_rule_missing' });
    } else {
      for (const permission of policy.allows) permissions.add(permission);
    }
  } else {
    permissions = applicableRules.length
      ? new Set([PERMISSIONS.PUBLIC_MEMORY_READ, PERMISSIONS.AUDIT_APPEND, ...policy.allows])
      : legacyRolePermissions(actor.principal_kind, roles, bindingsForActor);
  }

  for (const permission of explicitDenials) {
    if (ALL_PERMISSIONS.has(permission)) denials.add(permission);
    else findings.push({ code: 'unknown_explicit_deny', permission_key: String(permission || '') });
  }
  for (const permission of policy.denies) denials.add(permission);
  for (const [permission, permissionSources] of policy.sources) sources.set(permission, permissionSources);

  if ((actor.principal_kind === 'agent' || actor.principal_kind === 'service')
      && !bindingsForActor.some((binding) =>
        binding.binding_kind === 'broker_client' && binding.access_mode === 'brokered')) {
    permissions.delete(PERMISSIONS.CANDIDATE_CREATE);
  }
  for (const permission of [...permissions]) {
    if (!ceiling.has(permission) || denials.has(permission)) permissions.delete(permission);
  }

  if (actor.principal_kind === 'agent' && requireSponsorIntersection) {
    if (!Array.isArray(sponsorPermissions)) {
      findings.push({ code: 'agent_sponsor_context_missing' });
      for (const permission of [...permissions]) {
        if (!NEVER_SPONSOR_DERIVED.has(permission)) permissions.delete(permission);
      }
    } else {
      const sponsor = new Set(sponsorPermissions);
      for (const permission of [...permissions]) {
        if (!NEVER_SPONSOR_DERIVED.has(permission) && !sponsor.has(permission)) permissions.delete(permission);
      }
    }
  }

  findings.push(...runtimeFindings(actor, roles, bindingsForActor));
  return frozenResult({
    principal: actor,
    at: evaluatedAt,
    permissions,
    denials,
    findings,
    sources,
    policyAssignments: assignmentsForActor,
    sponsorPrincipalId,
  });
}
