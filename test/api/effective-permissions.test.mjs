import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeEffectiveAccess,
  PERMISSIONS,
} from '../../app/lib/effective-permissions.mjs';

const AT = new Date('2026-07-11T05:00:00Z');
const DEPARTMENT_ID = '00000000-0000-4000-8000-000000000001';

function principal(kind, status = 'active', id = `${kind}-1`) {
  return { id, principal_kind: kind, status };
}

function membership(principalId, role = 'member', overrides = {}) {
  return {
    principal_id: principalId,
    department_id: DEPARTMENT_ID,
    membership_role: role,
    status: 'active',
    valid_from: '2026-07-01T00:00:00Z',
    valid_to: null,
    ...overrides,
  };
}

function binding(principalId, kind, accessMode = 'brokered', overrides = {}) {
  return {
    principal_id: principalId,
    binding_kind: kind,
    binding_value: `${kind}:test`,
    access_mode: accessMode,
    status: 'active',
    valid_from: '2026-07-01T00:00:00Z',
    valid_to: null,
    ...overrides,
  };
}

test('ordinary humans remain logical-only and can never write canonical memory', () => {
  const human = principal('human');
  const result = computeEffectiveAccess({
    principal: human,
    memberships: [membership(human.id)],
    bindings: [binding(human.id, 'postgres_role', 'direct')],
    resourceDepartmentId: DEPARTMENT_ID,
    at: AT,
  });

  assert.equal(result.can(PERMISSIONS.PUBLIC_MEMORY_READ), true);
  assert.equal(result.can(PERMISSIONS.DEPARTMENT_MEMORY_READ), true);
  assert.equal(result.can(PERMISSIONS.QUARANTINE_SUBMIT), true);
  assert.equal(result.can(PERMISSIONS.CANONICAL_MEMORY_WRITE), false);
  assert.deepEqual(result.runtime_findings, [{
    code: 'ordinary_human_must_remain_logical_only',
    binding_kind: 'postgres_role',
    binding_value: 'postgres_role:test',
  }]);
});

test('reviewer and architect permissions are human-only and promotion creates a draft', () => {
  const reviewer = principal('human', 'active', 'human-reviewer');
  const architect = principal('human', 'active', 'human-architect');
  const reviewerAccess = computeEffectiveAccess({
    principal: reviewer,
    memberships: [membership(reviewer.id, 'reviewer')],
    resourceDepartmentId: DEPARTMENT_ID,
    at: AT,
  });
  const architectAccess = computeEffectiveAccess({
    principal: architect,
    memberships: [membership(architect.id, 'architect')],
    resourceDepartmentId: DEPARTMENT_ID,
    at: AT,
  });

  assert.equal(reviewerAccess.can(PERMISSIONS.CANDIDATE_REVIEW), true);
  assert.equal(reviewerAccess.can(PERMISSIONS.CANDIDATE_PROMOTE_AS_DRAFT), false);
  assert.equal(architectAccess.can(PERMISSIONS.CANDIDATE_PROMOTE_AS_DRAFT), true);
  assert.equal(architectAccess.can(PERMISSIONS.CANONICAL_MEMORY_WRITE), false);
});

test('an architect sponsor can delegate candidate creation to a broker-bound agent', () => {
  const architect = principal('human', 'active', 'human-sponsor');
  const architectAccess = computeEffectiveAccess({
    principal: architect,
    memberships: [membership(architect.id, 'architect')],
    policyRules: [{
      status: 'active',
      permission_key: PERMISSIONS.CANDIDATE_CREATE,
      effect: 'allow',
    }],
    resourceDepartmentId: DEPARTMENT_ID,
    at: AT,
  });
  const agent = principal('agent', 'active', 'agent-sponsored');
  const agentAccess = computeEffectiveAccess({
    principal: agent,
    memberships: [membership(agent.id)],
    bindings: [binding(agent.id, 'broker_client')],
    policyRules: [{
      status: 'active',
      permission_key: PERMISSIONS.CANDIDATE_CREATE,
      effect: 'allow',
    }],
    sponsorPermissions: architectAccess.permissions,
    sponsorPrincipalId: architect.id,
    requireSponsorIntersection: true,
    resourceDepartmentId: DEPARTMENT_ID,
    at: AT,
  });

  assert.equal(architectAccess.can(PERMISSIONS.CANDIDATE_CREATE), true);
  assert.equal(agentAccess.can(PERMISSIONS.CANDIDATE_CREATE), true);
  assert.equal(agentAccess.sponsor_principal_id, architect.id);
});

test('linked agents are independent and need their own membership plus broker binding', () => {
  const human = principal('human', 'active', 'human-owner');
  const agent = principal('agent', 'active', 'agent-linked');
  const withoutOwnMembership = computeEffectiveAccess({
    principal: agent,
    memberships: [membership(human.id, 'architect')],
    bindings: [binding(agent.id, 'broker_client')],
    resourceDepartmentId: DEPARTMENT_ID,
    at: AT,
  });
  const withOwnMembership = computeEffectiveAccess({
    principal: agent,
    memberships: [membership(agent.id, 'member')],
    bindings: [binding(agent.id, 'broker_client')],
    resourceDepartmentId: DEPARTMENT_ID,
    at: AT,
  });

  assert.equal(withoutOwnMembership.can(PERMISSIONS.DEPARTMENT_MEMORY_READ), false);
  assert.equal(withoutOwnMembership.can(PERMISSIONS.CANDIDATE_CREATE), false);
  assert.equal(withOwnMembership.can(PERMISSIONS.DEPARTMENT_MEMORY_READ), true);
  assert.equal(withOwnMembership.can(PERMISSIONS.CANDIDATE_CREATE), true);
  assert.equal(withOwnMembership.can(PERMISSIONS.CANDIDATE_REVIEW), false);
});

test('agents without a broker do not receive candidate creation and direct DB is flagged', () => {
  const agent = principal('agent');
  const result = computeEffectiveAccess({
    principal: agent,
    memberships: [membership(agent.id)],
    bindings: [binding(agent.id, 'postgres_role', 'direct')],
    resourceDepartmentId: DEPARTMENT_ID,
    at: AT,
  });

  assert.equal(result.can(PERMISSIONS.CANDIDATE_CREATE), false);
  assert.deepEqual(result.runtime_findings.map((item) => item.code), [
    'agent_broker_binding_required',
    'agent_direct_database_binding_requires_exception',
  ]);
});

test('suspended or expired identities receive no permissions', () => {
  const human = principal('human', 'suspended');
  const result = computeEffectiveAccess({
    principal: human,
    memberships: [membership(human.id, 'architect')],
    resourceDepartmentId: DEPARTMENT_ID,
    at: AT,
  });

  assert.deepEqual(result.permissions, []);
  assert.equal(result.can(PERMISSIONS.PUBLIC_MEMORY_READ), false);
  assert.equal(result.can(PERMISSIONS.CANDIDATE_PROMOTE_AS_DRAFT), false);
});

test('membership scope and validity are deterministic', () => {
  const human = principal('human');
  const access = computeEffectiveAccess({
    principal: human,
    memberships: [
      membership(human.id, 'architect', { department_id: 'another-department' }),
      membership(human.id, 'reviewer', { valid_to: '2026-07-10T00:00:00Z' }),
    ],
    resourceDepartmentId: DEPARTMENT_ID,
    at: AT,
  });

  assert.equal(access.can(PERMISSIONS.PUBLIC_MEMORY_READ), true);
  assert.equal(access.can(PERMISSIONS.DEPARTMENT_MEMORY_READ), false);
  assert.equal(access.can(PERMISSIONS.CANDIDATE_REVIEW), false);
});

test('immutable policy rules narrow role permissions and explicit deny wins', () => {
  const architect = principal('human', 'active', 'human-policy-architect');
  const access = computeEffectiveAccess({
    principal: architect,
    memberships: [membership(architect.id, 'architect')],
    bindings: [],
    policyRules: [
      { status: 'active', permission_key: PERMISSIONS.DEPARTMENT_MEMORY_READ, effect: 'allow', source: 'department_member_v1' },
      { status: 'active', permission_key: PERMISSIONS.CANDIDATE_PROMOTE_AS_DRAFT, effect: 'allow', source: 'architect_v1' },
      { status: 'active', permission_key: PERMISSIONS.CANDIDATE_PROMOTE_AS_DRAFT, effect: 'deny', source: 'incident_hold_v1' },
    ],
    resourceDepartmentId: DEPARTMENT_ID,
    at: AT,
  });

  assert.equal(access.can(PERMISSIONS.DEPARTMENT_MEMORY_READ), true);
  assert.equal(access.can(PERMISSIONS.PROVISIONING_CONFIRM), false);
  assert.equal(access.can(PERMISSIONS.CANDIDATE_PROMOTE_AS_DRAFT), false);
  assert.equal(
    access.decisions.find((item) => item.permission === PERMISSIONS.CANDIDATE_PROMOTE_AS_DRAFT).explicit_deny,
    true,
  );
});

test('agent access is the intersection of own policy, own membership, binding, and sponsor ceiling', () => {
  const agent = principal('agent', 'active', 'agent-policy-linked');
  const access = computeEffectiveAccess({
    principal: agent,
    memberships: [membership(agent.id)],
    bindings: [binding(agent.id, 'broker_client')],
    policyRules: [
      { status: 'active', permission_key: PERMISSIONS.DEPARTMENT_MEMORY_READ, effect: 'allow' },
      { status: 'active', permission_key: PERMISSIONS.CANDIDATE_CREATE, effect: 'allow' },
    ],
    sponsorPermissions: [PERMISSIONS.DEPARTMENT_MEMORY_READ],
    requireSponsorIntersection: true,
    resourceDepartmentId: DEPARTMENT_ID,
    at: AT,
  });

  assert.equal(access.can(PERMISSIONS.DEPARTMENT_MEMORY_READ), true);
  assert.equal(access.can(PERMISSIONS.CANDIDATE_CREATE), false);
  assert.equal(access.can(PERMISSIONS.CANDIDATE_REVIEW), false);
});

test('missing sponsor context fails closed when sponsor intersection is required', () => {
  const agent = principal('agent', 'active', 'agent-no-sponsor-context');
  const access = computeEffectiveAccess({
    principal: agent,
    memberships: [membership(agent.id)],
    bindings: [binding(agent.id, 'broker_client')],
    policyRules: [
      { status: 'active', permission_key: PERMISSIONS.DEPARTMENT_MEMORY_READ, effect: 'allow' },
    ],
    requireSponsorIntersection: true,
    resourceDepartmentId: DEPARTMENT_ID,
    at: AT,
  });

  assert.equal(access.can(PERMISSIONS.DEPARTMENT_MEMORY_READ), false);
  assert.equal(access.runtime_findings.some((item) => item.code === 'agent_sponsor_context_missing'), true);
});

test('strict mode grants no department authority without an active assignment', () => {
  const architect = principal('human', 'active', 'strict-architect');
  const access = computeEffectiveAccess({
    principal: architect,
    memberships: [membership(architect.id, 'architect')],
    policyRules: [{
      id: 'rule-unassigned',
      template_id: 'template-architect',
      principal_kind: 'human',
      membership_role: 'architect',
      permission_key: PERMISSIONS.PROVISIONING_CONFIRM,
      effect: 'allow',
      conditions: {},
    }],
    requirePolicyAssignment: true,
    resourceDepartmentId: DEPARTMENT_ID,
    at: AT,
  });
  assert.equal(access.can(PERMISSIONS.PROVISIONING_CONFIRM), false);
  assert.equal(access.runtime_findings.some((item) => item.code === 'policy_assignment_missing'), true);
});

test('strict mode filters assigned rules by principal kind and membership role', () => {
  const reviewer = principal('human', 'active', 'strict-reviewer');
  const assignment = {
    id: 'assignment-reviewer',
    assignment_scope: 'principal',
    principal_id: reviewer.id,
    department_id: DEPARTMENT_ID,
    template_id: 'template-reviewer',
    status: 'active',
    valid_from: '2026-07-01T00:00:00Z',
    valid_to: null,
  };
  const access = computeEffectiveAccess({
    principal: reviewer,
    memberships: [membership(reviewer.id, 'reviewer')],
    policyAssignments: [assignment],
    policyRules: [
      {
        template_id: assignment.template_id,
        principal_kind: 'human',
        membership_role: 'reviewer',
        permission_key: PERMISSIONS.CANDIDATE_REVIEW,
        effect: 'allow',
        conditions: {},
      },
      {
        template_id: assignment.template_id,
        principal_kind: 'agent',
        membership_role: 'reviewer',
        permission_key: PERMISSIONS.CANDIDATE_CREATE,
        effect: 'allow',
        conditions: {},
      },
      {
        template_id: assignment.template_id,
        principal_kind: 'human',
        membership_role: 'architect',
        permission_key: PERMISSIONS.PROVISIONING_CONFIRM,
        effect: 'allow',
        conditions: {},
      },
    ],
    explicitDenials: [PERMISSIONS.CANDIDATE_REVIEW],
    requirePolicyAssignment: true,
    resourceDepartmentId: DEPARTMENT_ID,
    at: AT,
  });
  assert.equal(access.can(PERMISSIONS.CANDIDATE_REVIEW), false);
  assert.equal(access.can(PERMISSIONS.CANDIDATE_CREATE), false);
  assert.equal(access.can(PERMISSIONS.PROVISIONING_CONFIRM), false);
  assert.deepEqual(access.policy_assignment_ids, ['assignment-reviewer']);
});
