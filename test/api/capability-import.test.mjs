import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { validateCapabilityPack } from '../../scripts/demo/import_capability_pack.mjs';

const packDirectory = path.resolve(
  'handoff',
  'aihackathon_public_safe_asset_pack_2026-07-10',
);

async function fixture() {
  const [assets, recommendations, analytics, sourceTurns] = await Promise.all([
    fs.readFile(path.join(packDirectory, 'assets.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(packDirectory, 'recommendations.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(packDirectory, 'analytics.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(packDirectory, 'source_turns.json'), 'utf8').then(JSON.parse),
  ]);
  return { assets, recommendations, analytics, sourceTurns };
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
