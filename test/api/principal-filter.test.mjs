import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterPrincipals,
  isOperationalPrincipal,
  principalFilterCounts,
} from '../../app/operator-public/principal-filter.js';

const principals = [
  { id: 'human-active', principal_kind: 'human', status: 'active', display_name: 'Mai Nguyen', principal_key: 'human:mai' },
  { id: 'agent-draft', principal_kind: 'agent', status: 'draft', display_name: 'Mai Personal Memory Agent', principal_key: 'agent:mai' },
  { id: 'human-suspended', principal_kind: 'human', status: 'suspended', display_name: 'Former Employee', principal_key: 'human:former' },
  { id: 'proof-active', principal_kind: 'agent', status: 'active', display_name: 'Identity Proof Agent', principal_key: 'agent:proof' },
  { id: 'proof-suspended', principal_kind: 'agent', status: 'suspended', display_name: 'ProofIsolated Agent', principal_key: 'agent:proofisolated' },
];

test('operational principal filters exclude suspended identities and proof fixtures', () => {
  assert.equal(isOperationalPrincipal(principals[0]), true);
  assert.equal(isOperationalPrincipal(principals[3]), false);
  assert.deepEqual(filterPrincipals(principals).map((item) => item.id), ['human-active', 'agent-draft']);
  assert.deepEqual(filterPrincipals(principals, 'human').map((item) => item.id), ['human-active']);
  assert.deepEqual(filterPrincipals(principals, 'agent').map((item) => item.id), ['agent-draft']);
});

test('audit-history filters retain all, suspended, and proof-fixture records', () => {
  assert.deepEqual(filterPrincipals(principals, 'all').map((item) => item.id), principals.map((item) => item.id));
  assert.deepEqual(filterPrincipals(principals, 'suspended').map((item) => item.id), ['human-suspended', 'proof-suspended']);
  assert.deepEqual(filterPrincipals(principals, 'proof_fixtures').map((item) => item.id), ['proof-active', 'proof-suspended']);
});

test('default counts describe operational principals while history counts remain available', () => {
  assert.deepEqual(principalFilterCounts(principals), {
    operational: 2,
    human: 1,
    agent: 1,
    all: 5,
    suspended: 2,
    proof_fixtures: 2,
  });
});

test('principal search applies inside both operational and audit-history filters', () => {
  assert.deepEqual(filterPrincipals(principals, 'operational', 'personal memory').map((item) => item.id), ['agent-draft']);
  assert.deepEqual(filterPrincipals(principals, 'proof_fixtures', 'isolated').map((item) => item.id), ['proof-suspended']);
});
