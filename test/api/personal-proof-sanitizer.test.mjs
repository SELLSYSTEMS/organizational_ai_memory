import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { sanitizePersonalAgentRuntimeProof }
  from '../../scripts/evaluation/sanitize_personal_agent_runtime_proof.mjs';

const metadata = Object.freeze({
  capture_run_id: '0711-final-d',
  employee_display_name: 'Mai Nguyen',
  agent_display_name: "Mai Nguyen's Personal Memory Agent",
});

function passingRawProof() {
  return {
    schema_version: 1,
    principal_key: 'agent:229e6cc7-47e9-405e-8e97-f75b1bbf8b5d',
    runtime_user: 'oam-a-02172c6d9c68',
    checked_at: '2026-07-11T13:00:45.760Z',
    passed: true,
    checks: [
      { label: 'repository_read', expected: 'denied', actual: 'denied', passed: true, code: 'EACCES' },
      { label: 'installed_application_read', expected: 'denied', actual: 'denied', passed: true, code: 'EACCES' },
      { label: 'application_environment_read', expected: 'denied', actual: 'denied', passed: true, code: 'EACCES' },
      { label: 'model_authentication_read', expected: 'denied', actual: 'denied', passed: true, code: 'EACCES' },
      { label: 'own_workspace_write', expected: 'allowed', actual: 'allowed', passed: true },
      { label: 'outbound_ip_socket', expected: 'denied', actual: 'denied', passed: true, code: 'EAFNOSUPPORT' },
      { label: 'direct_postgres_connect', expected: 'denied', actual: 'denied', passed: true, code: 'postgres_authority_denied' },
    ],
    broker: {
      passed: true,
      status: 200,
      authorization: 'allowed',
      asset_key: 'prompt:website_handoff_brief_v1',
      source_count: 1,
      policy_hash: '7b58bc138207d79318150c043f472ff99a5a24684007fedac67a5427eef4dc82',
    },
    personal_broker: {
      passed: true,
      status: 200,
      authorization: 'allowed',
      matched_count: 1,
      citation_count: 1,
      audit_event_key: 'aa9a12f5-ccd4-46a5-8350-fbfeff5a1270',
      citation_digests: [{
        source_type: 'memory',
        source_id: '454c3643-7acc-41da-8222-4e8b1fdfa1c3',
        revision: 4,
        content_sha256: '09526e87ed64248e50ca6b25fda11bf04f8d476aa44967cc6396f799b34e888d',
      }],
    },
  };
}

test('personal proof sanitizer preserves the reviewed release artifact bytes', () => {
  const sanitized = sanitizePersonalAgentRuntimeProof(passingRawProof(), metadata);
  const serialized = `${JSON.stringify(sanitized, null, 2)}\n`;
  assert.equal(
    createHash('sha256').update(serialized).digest('hex'),
    '125b17563fc31acfe46149e7921d962cc453e9d0a5531bad876d99302b77c444',
  );
  assert.equal(serialized.includes('principal_key'), false);
  assert.equal(serialized.includes('policy_hash'), false);
});

test('personal proof sanitizer rejects unknown raw fields and invalid boundary enums', () => {
  const extra = passingRawProof();
  extra.personal_broker.citation_digests[0].content = 'must never enter a public proof';
  assert.throws(
    () => sanitizePersonalAgentRuntimeProof(extra, metadata),
    /unexpected schema/,
  );

  const invalidCode = passingRawProof();
  invalidCode.checks[5].code = 'ECONNREFUSED';
  assert.throws(
    () => sanitizePersonalAgentRuntimeProof(invalidCode, metadata),
    /invalid denial code/,
  );
});

test('personal proof sanitizer validates timestamp, UUID, SHA-256 and audit receipt values', () => {
  const invalidTimestamp = passingRawProof();
  invalidTimestamp.checked_at = '2026-07-11 13:00:45Z';
  assert.throws(
    () => sanitizePersonalAgentRuntimeProof(invalidTimestamp, metadata),
    /canonical UTC timestamp/,
  );

  const invalidCitation = passingRawProof();
  invalidCitation.personal_broker.citation_digests[0].content_sha256 = 'not-a-sha';
  assert.throws(
    () => sanitizePersonalAgentRuntimeProof(invalidCitation, metadata),
    /citation projection is invalid/,
  );

  const invalidReceipt = passingRawProof();
  invalidReceipt.personal_broker.audit_event_key = 'not-an-audit-uuid';
  assert.throws(
    () => sanitizePersonalAgentRuntimeProof(invalidReceipt, metadata),
    /personal retrieval proof is invalid/,
  );
});

test('personal proof sanitizer accepts only bounded release metadata', () => {
  assert.throws(
    () => sanitizePersonalAgentRuntimeProof(passingRawProof(), {
      ...metadata,
      capture_run_id: '../release',
    }),
    /capture_run_id/,
  );
  assert.throws(
    () => sanitizePersonalAgentRuntimeProof(passingRawProof(), {
      ...metadata,
      employee_display_name: `Mai ${'A'.repeat(40)}`,
    }),
    /opaque token-like segment/,
  );
});

test('serialized public proof scanner rejects known and opaque secret-like values', () => {
  assert.throws(
    () => sanitizePersonalAgentRuntimeProof(passingRawProof(), {
      ...metadata,
      employee_display_name: 'sk-proj-abcdefghijklmnopqrstuvwxyz123456',
    }),
    /secret-like openai_or_anthropic_key signature/,
  );
  assert.throws(
    () => sanitizePersonalAgentRuntimeProof(passingRawProof(), {
      ...metadata,
      capture_run_id: 'aB3_'.repeat(12),
    }),
    /opaque token-like value/,
  );
});
