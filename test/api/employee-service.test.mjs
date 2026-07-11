import assert from 'node:assert/strict';
import test from 'node:test';
import { actorWithEmployeeDatabaseContext } from '../../app/lib/employee-db-context.mjs';
import { createEmployeeService } from '../../app/lib/employee-service.mjs';

const TOKEN_HASH = 'a'.repeat(64);
const MEMORY_ID = '00000000-0000-4000-8000-000000000004';
const PROFILE_ID = '00000000-0000-4000-8000-000000000011';
const actor = actorWithEmployeeDatabaseContext({
  principal_id: '00000000-0000-4000-8000-000000000001',
  department_id: '00000000-0000-4000-8000-000000000002',
  agent_id: '00000000-0000-4000-8000-000000000003',
}, TOKEN_HASH);

test('employee service projects the v8 workspace into the public employee contract', async () => {
  const service = createEmployeeService({
    repository: {
      async workspace() {
        return {
          schema_version: 1,
          principal: {
            id: actor.principal_id,
            principal_key: 'human:maya.chen',
            display_name: 'Maya Chen',
            status: 'active',
            membership_role: 'member',
          },
          department: {
            id: actor.department_id,
            department_key: 'delivery',
            display_name: 'Delivery',
            status: 'active',
          },
          agent: {
            id: actor.agent_id,
            principal_key: 'agent:maya.chen',
            display_name: 'Maya Personal Agent',
            status: 'active',
            pair_status: 'active',
          },
          profile: {
            id: PROFILE_ID,
            job_title: 'Delivery lead',
            role_summary: 'Ships reviewed sites.',
            expertise: ['handoffs'],
            working_style: 'Evidence first.',
            current_goals: ['Reduce rework'],
            boundaries: 'No unapproved production writes.',
            sharing_scope: 'owner_only',
            agent_shared: false,
            revision: 1,
            content_sha256: 'c'.repeat(64),
          },
          memories: [{
            id: MEMORY_ID,
            memory_type: 'experience',
            sensitivity: 'private',
            sharing_scope: 'owner_only',
            agent_shared: false,
            current_revision: 1,
            revision: 1,
            content_sha256: 'd'.repeat(64),
            title: 'Release handoff',
            content: 'Verify the public route.',
            context: 'Website release',
            why_it_worked: 'It catches proxy drift.',
            evidence: ['Observed in release proof.'],
            tags: ['release'],
          }],
          unexpected_internal_field: 'not projected',
        };
      },
    },
  });
  const result = await service.workspace(actor);
  assert.equal(result.actor.id, actor.principal_id);
  assert.equal(result.personal_agent.id, actor.agent_id);
  assert.equal(result.memories[0].id, MEMORY_ID);
  assert.equal('unexpected_internal_field' in result, false);
});

test('employee session validation requires the same human, department, and personal agent', async () => {
  const service = createEmployeeService({
    repository: {
      async currentContext() {
        return {
          principal_id: actor.principal_id,
          department_id: actor.department_id,
          agent_id: '00000000-0000-4000-8000-000000000099',
        };
      },
    },
  });
  await assert.rejects(
    service.validateSession(actor),
    (error) => error.code === 'authentication_failed' && error.status === 401,
  );
});

test('employee agent context uses the database-enforced bounded result limit', async () => {
  const calls = [];
  const service = createEmployeeService({
    repository: {
      async agentContext(query, limit) {
        calls.push({ query, limit });
        return {
          schema_version: 1,
          authorization: 'allowed',
          principal: {
            human_id: actor.principal_id,
            agent_id: actor.agent_id,
            department_id: actor.department_id,
          },
          query: { text: query, limit, matched_count: 1 },
          items: [{
            source_type: 'memory',
            id: MEMORY_ID,
            title: 'Safe release handoff',
            memory_type: 'experience',
            sensitivity: 'private',
            sharing_scope: 'owner_and_personal_agent',
            agent_shared: true,
            content: 'Verify the public route immediately before handoff.',
            context: 'Website release',
            why_it_worked: 'It caught reverse-proxy drift before delivery.',
            evidence: ['Observed in release proof.'],
            tags: ['release'],
            revision: 3,
            content_sha256: 'd'.repeat(64),
            citation: {
              source_type: 'memory',
              source_id: MEMORY_ID,
              memory_id: MEMORY_ID,
              revision: 3,
              content_sha256: 'd'.repeat(64),
            },
          }],
          citations: [{
            source_type: 'memory',
            source_id: MEMORY_ID,
            memory_id: MEMORY_ID,
            revision: 3,
            content_sha256: 'd'.repeat(64),
          }],
          audit_event_key: '00000000-0000-4000-8000-000000000005',
        };
      },
    },
  });
  const result = await service.agentContext(actor, 'prepare a safe release');
  assert.deepEqual(calls, [{ query: 'prepare a safe release', limit: 10 }]);
  assert.equal(result.status, 'matched');
  assert.equal(result.mode, 'deterministic_personal_memory');
  assert.match(result.answer, /Safe release handoff/);
  assert.match(result.answer, /Verify the public route/);
  assert.match(result.answer, /Why it worked: It caught reverse-proxy drift/);
  assert.deepEqual(result.citations, [{
    source_type: 'memory',
    source_id: MEMORY_ID,
    memory_id: MEMORY_ID,
    title: 'Safe release handoff',
    memory_type: 'experience',
    revision: 3,
    content_sha256: 'd'.repeat(64),
    excerpt: 'Verify the public route immediately before handoff.',
    visibility: 'personal_agent',
  }]);
  assert.equal(result.authorization, 'allowed');
  assert.equal(result.principal.agent_id, actor.agent_id);
  assert.equal(result.query.matched_count, 1);
  assert.equal(result.audit_event_key, '00000000-0000-4000-8000-000000000005');
  assert.match(result.limitations.join(' '), /current profile and memory versions explicitly shared/);
  assert.match(result.limitations.join(' '), /organizational sources were not searched/);
});

test('employee agent context has an explicit deterministic no-match response', async () => {
  const service = createEmployeeService({
    repository: {
      async agentContext(query, limit) {
        return {
          schema_version: 1,
          authorization: 'allowed',
          principal: {
            human_id: actor.principal_id,
            agent_id: actor.agent_id,
            department_id: actor.department_id,
          },
          query: { text: query, limit, matched_count: 0 },
          items: [],
          citations: [],
          audit_event_key: '00000000-0000-4000-8000-000000000006',
        };
      },
    },
  });
  const result = await service.agentContext(actor, 'unknown operating practice');
  assert.equal(result.status, 'no_match');
  assert.equal(result.mode, 'deterministic_personal_memory');
  assert.equal(result.answer, '');
  assert.deepEqual(result.citations, []);
  assert.deepEqual(result.items, []);
  assert.equal(result.query.matched_count, 0);
  assert.equal(result.audit_event_key, '00000000-0000-4000-8000-000000000006');
});

test('employee agent context keeps shared profile citations distinct from memory citations', async () => {
  const profileHash = 'f'.repeat(64);
  const profileItem = {
    source_type: 'profile',
    id: PROFILE_ID,
    job_title: 'Release architect',
    role_summary: 'Coordinates evidence-first launches.',
    expertise: ['Release evidence', 'Accessibility'],
    working_style: 'Verify before handoff.',
    current_goals: ['Reduce release rework'],
    boundaries: 'No production writes without approval.',
    sharing_scope: 'owner_and_personal_agent',
    agent_shared: true,
    revision: 3,
    content_sha256: profileHash,
    citation: {
      source_type: 'profile',
      source_id: PROFILE_ID,
      profile_id: PROFILE_ID,
      revision: 3,
      content_sha256: profileHash,
    },
  };
  const service = createEmployeeService({
    repository: {
      async agentContext(query, limit) {
        return {
          schema_version: 1,
          authorization: 'allowed',
          principal: {
            human_id: actor.principal_id,
            agent_id: actor.agent_id,
            department_id: actor.department_id,
          },
          query: { text: query, limit, matched_count: 1 },
          items: [profileItem],
          citations: [profileItem.citation],
          audit_event_key: '00000000-0000-4000-8000-000000000014',
        };
      },
    },
  });
  const result = await service.agentContext(actor, 'release evidence');
  assert.match(result.answer, /Employee profile/);
  assert.match(result.answer, /Job title: Release architect/);
  assert.equal(result.items[0].source_type, 'profile');
  assert.deepEqual(result.citations, [{
    source_type: 'profile',
    source_id: PROFILE_ID,
    profile_id: PROFILE_ID,
    title: 'Employee profile',
    revision: 3,
    content_sha256: profileHash,
    excerpt: 'Coordinates evidence-first launches.',
    visibility: 'personal_agent',
  }]);
  assert.equal('memory_id' in result.citations[0], false);
});

test('employee service fails closed on workspace or citation contract drift', async () => {
  const workspaceService = createEmployeeService({
    repository: {
      async workspace() {
        return {
          schema_version: 2,
          principal: { id: actor.principal_id },
          department: { id: actor.department_id },
          agent: { id: actor.agent_id },
          profile: null,
          memories: [],
        };
      },
    },
  });
  await assert.rejects(
    workspaceService.workspace(actor),
    (error) => error.status === 503 && error.code === 'employee_service_unavailable',
  );

  const contextService = createEmployeeService({
    repository: {
      async agentContext(query, limit) {
        return {
          schema_version: 1,
          authorization: 'allowed',
          principal: {
            human_id: actor.principal_id,
            department_id: actor.department_id,
            agent_id: actor.agent_id,
          },
          query: { text: query, limit, matched_count: 1 },
          items: [{
            source_type: 'memory',
            id: MEMORY_ID,
            title: 'Release handoff',
            memory_type: 'experience',
            sensitivity: 'private',
            sharing_scope: 'owner_and_personal_agent',
            agent_shared: true,
            content: 'Verify the public route.',
            context: 'Website release',
            why_it_worked: 'It catches proxy drift.',
            evidence: ['Observed in release proof.'],
            tags: ['release'],
            revision: 2,
            content_sha256: 'd'.repeat(64),
            citation: {
              source_type: 'memory',
              source_id: MEMORY_ID,
              memory_id: MEMORY_ID,
              revision: 2,
              content_sha256: 'd'.repeat(64),
            },
          }],
          citations: [{
            source_type: 'memory', source_id: MEMORY_ID, memory_id: MEMORY_ID,
            revision: 2, content_sha256: 'e'.repeat(64),
          }],
          audit_event_key: '00000000-0000-4000-8000-000000000007',
        };
      },
    },
  });
  await assert.rejects(
    contextService.agentContext(actor, 'release handoff'),
    (error) => error.status === 503 && error.code === 'employee_service_unavailable',
  );
});

test('employee mutation contracts preserve revisions and reset edited profile and memory consent', async () => {
  const memoryDocument = {
    id: MEMORY_ID,
    memory_type: 'experience',
    sensitivity: 'private',
    sharing_scope: 'owner_only',
    agent_shared: false,
    current_revision: 1,
    revision: 1,
    content_sha256: 'd'.repeat(64),
    title: 'Release handoff',
    content: 'Verify the public route.',
    context: 'Website release',
    why_it_worked: 'It catches proxy drift.',
    evidence: ['Observed in release proof.'],
    tags: ['release'],
    audit_event_key: '00000000-0000-4000-8000-000000000008',
  };
  const service = createEmployeeService({
    repository: {
      async updateProfile(input) {
        return {
          id: PROFILE_ID,
          job_title: 'Delivery lead',
          role_summary: 'Ships reviewed sites.',
          expertise: ['handoffs'],
          working_style: 'Evidence first.',
          current_goals: ['Reduce rework'],
          boundaries: 'No unapproved production writes.',
          sharing_scope: 'owner_only',
          agent_shared: false,
          revision: input.expected_revision + 1,
          content_sha256: 'c'.repeat(64),
          audit_event_key: '00000000-0000-4000-8000-000000000009',
        };
      },
      async shareProfile(revision) {
        return {
          id: PROFILE_ID,
          job_title: 'Delivery lead', role_summary: 'Ships reviewed sites.',
          expertise: ['handoffs'], working_style: 'Evidence first.',
          current_goals: ['Reduce rework'], boundaries: 'No unapproved production writes.',
          sharing_scope: 'owner_and_personal_agent', agent_shared: true,
          revision: revision + 1, content_sha256: 'c'.repeat(64),
          audit_event_key: '00000000-0000-4000-8000-000000000012',
        };
      },
      async unshareProfile(revision) {
        return {
          id: PROFILE_ID,
          job_title: 'Delivery lead', role_summary: 'Ships reviewed sites.',
          expertise: ['handoffs'], working_style: 'Evidence first.',
          current_goals: ['Reduce rework'], boundaries: 'No unapproved production writes.',
          sharing_scope: 'owner_only', agent_shared: false,
          revision: revision + 1, content_sha256: 'c'.repeat(64),
          audit_event_key: '00000000-0000-4000-8000-000000000013',
        };
      },
      async createMemory() { return memoryDocument; },
      async updateMemory(_id, input) {
        return {
          ...memoryDocument,
          current_revision: input.expected_revision + 1,
          revision: input.expected_revision + 1,
        };
      },
      async shareMemory(_id, revision) {
        return {
          id: MEMORY_ID,
          current_revision: revision + 1,
          revision: revision + 1,
          content_sha256: 'e'.repeat(64),
          sharing_scope: 'owner_and_personal_agent',
          agent_shared: true,
          audit_event_key: '00000000-0000-4000-8000-000000000010',
        };
      },
      async unshareMemory(_id, revision) {
        return {
          id: MEMORY_ID,
          current_revision: revision,
          revision,
          sharing_scope: 'owner_only',
          agent_shared: false,
        };
      },
    },
  });
  assert.equal((await service.updateProfile(actor, { expected_revision: 1 })).revision, 2);
  assert.equal((await service.shareProfile(actor, 2)).revision, 3);
  assert.equal((await service.unshareProfile(actor, 3)).agent_shared, false);
  assert.equal((await service.createMemory(actor, {})).agent_shared, false);
  const edited = await service.updateMemory(actor, MEMORY_ID, { expected_revision: 1 });
  assert.equal(edited.revision, 2);
  assert.equal(edited.sharing_scope, 'owner_only');
  assert.equal(edited.agent_shared, false);
  assert.equal((await service.shareMemory(actor, MEMORY_ID, 2)).revision, 3);
  assert.equal((await service.unshareMemory(actor, MEMORY_ID, 3)).revision, 3);

  const noOpService = createEmployeeService({
    repository: {
      async shareProfile(revision) {
        return {
          id: PROFILE_ID,
          job_title: 'Delivery lead', role_summary: 'Ships reviewed sites.',
          expertise: ['handoffs'], working_style: 'Evidence first.',
          current_goals: ['Reduce rework'], boundaries: 'No unapproved production writes.',
          sharing_scope: 'owner_and_personal_agent', agent_shared: true,
          revision, content_sha256: 'c'.repeat(64),
        };
      },
    },
  });
  const noOp = await noOpService.shareProfile(actor, 3);
  assert.equal(noOp.revision, 3);
  assert.equal('audit_event_key' in noOp, false);

  const invalidService = createEmployeeService({
    repository: {
      async updateMemory() {
        return { ...memoryDocument, revision: 2, current_revision: 2, agent_shared: true };
      },
    },
  });
  await assert.rejects(
    invalidService.updateMemory(actor, MEMORY_ID, { expected_revision: 1 }),
    (error) => error.status === 503 && error.code === 'employee_service_unavailable',
  );
});
