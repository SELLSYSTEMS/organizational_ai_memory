import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  capabilityAssetSearchText,
  capabilityContentDigest,
  currentCapabilityAssetKeys,
  publicAssetPublicationMetadata,
  validateCapabilityPack,
} from '../../scripts/demo/import_capability_pack.mjs';

const packDirectory = path.resolve(
  'handoff',
  'aihackathon_public_safe_asset_pack_2026-07-10',
);

async function fixture() {
  const [assets, assetBodies, recommendations, analytics, sourceTurns] = await Promise.all([
    fs.readFile(path.join(packDirectory, 'assets.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(packDirectory, 'asset_bodies_v2.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(packDirectory, 'recommendations.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(packDirectory, 'analytics.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(packDirectory, 'source_turns.json'), 'utf8').then(JSON.parse),
  ]);
  return { assets, assetBodies, recommendations, analytics, sourceTurns };
}

test('checked-in public-safe pack resolves every recommendation and evidence edge', async () => {
  const pack = validateCapabilityPack(await fixture());
  const edgeCount = [...pack.evidenceEdges.values()].reduce((total, turns) => total + turns.size, 0);
  const leadBrief = pack.assets.find((asset) => asset.asset_key === 'prompt:lead_research_brief_v2');

  assert.equal(pack.assets.length, 9);
  assert.equal(pack.recommendations.length, 5);
  assert.equal(pack.sourceTurns.length, 9);
  assert.equal(edgeCount, 10);
  assert.equal(leadBrief.supersedes, 'prompt:lead_research_brief_v1');
  assert.ok(leadBrief.used_successfully_in.includes('workflow:b2b_outreach_triage_v1'));
  assert.equal(leadBrief.content.asset_family_key, 'prompt:lead_research_brief');
  assert.equal(leadBrief.content.content_type, 'application/json');
  assert.equal(leadBrief.content.content_schema_version, 1);
  assert.equal(
    leadBrief.content.content_sha256,
    capabilityContentDigest(leadBrief.content.body),
  );
  assert.match(leadBrief.content.body.template, /\{\{lead_name\}\}/);
});

test('import validation rejects unresolved assets before opening PostgreSQL', async () => {
  const input = await fixture();
  input.recommendations[0].recommended_asset_keys.push('workflow:not_in_pack_v1');

  assert.throws(
    () => validateCapabilityPack(input),
    /recommendation references unresolved asset workflow:not_in_pack_v1/,
  );
});

test('import validation reconciles reciprocal evidence declarations', async () => {
  const pack = validateCapabilityPack(await fixture());

  assert.deepEqual(
    [...pack.evidenceEdges.get('decision:source_first_before_generation_v1')].sort(),
    ['st-001', 'st-007'],
  );
});

test('all nine assets have exact typed bodies and stable content digests', async () => {
  const pack = validateCapabilityPack(await fixture());
  const expectedBodyKeys = {
    prompt: ['expected_output', 'guardrails', 'template', 'variables'],
    workflow: ['completion_criteria', 'failure_handling', 'inputs', 'steps', 'trigger'],
    agent: [
      'allowed_actions', 'handoff_conditions', 'inputs', 'operating_instructions',
      'output_contract', 'prohibited_actions', 'purpose', 'runtime', 'tools',
    ],
    decision_pattern: ['branches', 'context', 'decision_rule', 'escalate_when', 'exceptions', 'required_evidence'],
    best_practice: ['applies_when', 'avoid', 'checklist', 'do', 'principle', 'success_signals'],
  };

  assert.equal(pack.assets.length, 9);
  for (const asset of pack.assets) {
    assert.deepEqual(Object.keys(asset.content.body).sort(), expectedBodyKeys[asset.asset_type].sort());
    assert.equal(asset.content.content_sha256.length, 64);
    assert.equal(asset.content.content_sha256, capabilityContentDigest(asset.content.body));
    assert.ok(asset.content.body_text.length > 100);
    assert.match(capabilityAssetSearchText(asset), new RegExp(asset.title.split(' ')[0], 'i'));
  }
});

test('typed-body validation rejects schema drift, family drift, and unresolved workflow references', async () => {
  const unexpected = await fixture();
  unexpected.assetBodies[0].body.unexpected = 'not allowed';
  assert.throws(() => validateCapabilityPack(unexpected), /unexpected keys \[unexpected\]/);

  const wrongFamily = await fixture();
  wrongFamily.assetBodies[0].asset_family_key = 'prompt:wrong_family';
  assert.throws(() => validateCapabilityPack(wrongFamily), /asset_family_key must match/);

  const unresolved = await fixture();
  const workflow = unresolved.assetBodies.find((body) => body.asset_key === 'workflow:portfolio_site_delivery_v1');
  workflow.body.steps[0].uses_asset_keys.push('workflow:not_in_pack_v1');
  assert.throws(() => validateCapabilityPack(unresolved), /references unresolved asset/);
});

test('current version selection is semantic and independent of input order', () => {
  const versions = [
    { asset_key: 'prompt:brief_v2', version: '2.0', content: { asset_family_key: 'prompt:brief' } },
    { asset_key: 'prompt:brief_v10', version: '10.0', content: { asset_family_key: 'prompt:brief' } },
    { asset_key: 'workflow:handoff_v1', version: '1.0', content: { asset_family_key: 'workflow:handoff' } },
  ];

  assert.deepEqual(
    [...currentCapabilityAssetKeys(versions)].sort(),
    ['prompt:brief_v10', 'workflow:handoff_v1'],
  );
  assert.deepEqual(
    [...currentCapabilityAssetKeys([...versions].reverse())].sort(),
    ['prompt:brief_v10', 'workflow:handoff_v1'],
  );
});

test('analytics declarations are checked against the governed asset inventory', async () => {
  const input = await fixture();
  input.analytics.asset_counts_by_type[0].count += 1;
  assert.throws(
    () => validateCapabilityPack(input),
    /analytics\.asset_counts_by_type does not match assets/,
  );
});

test('public eligibility is explicit, review-gated, and preserves source visibility', () => {
  assert.deepEqual(publicAssetPublicationMetadata({ review_status: 'approved', visibility: 'internal' }), {
    public_demo_eligible: true,
    publication_decision: 'approved_for_public_demo',
    source_classification: 'public_safe',
    source_visibility: 'internal',
  });
  assert.equal(publicAssetPublicationMetadata({ review_status: 'reviewed', visibility: 'internal' }).public_demo_eligible, false);
  assert.equal(publicAssetPublicationMetadata({ review_status: 'draft', visibility: 'internal' }).public_demo_eligible, false);
  assert.equal(publicAssetPublicationMetadata({ review_status: 'deprecated', visibility: 'internal' }).public_demo_eligible, false);
});

test('import retires prior manifest eligibility before current rows are upserted', async () => {
  const source = await fs.readFile(new URL('../../scripts/demo/import_capability_pack.mjs', import.meta.url), 'utf8');
  assert.match(source, /'public_demo_eligible', false/);
  assert.match(source, /'publication_decision', 'absent_from_current_manifest'/);
  assert.match(source, /metadata = EXCLUDED\.metadata/);
});
