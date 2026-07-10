import assert from 'node:assert/strict';
import test from 'node:test';
import { PUBLIC_CAPABILITY_SCOPE } from '../../app/lib/config.mjs';
import {
  buildCapabilityAsset,
  createCapabilityMemoryService,
} from '../../app/lib/capability-memory-service.mjs';

function rawAsset() {
  return {
    id: 'private-database-id',
    asset_key: 'workflow:public_demo_v1',
    asset_type: 'workflow',
    title: 'Public demo workflow',
    summary: 'A governed workflow.',
    capability_area: 'governance',
    problem_solved: 'Keeps demo data bounded.',
    why_it_worked: 'It uses a pinned public-safe scope.',
    owner_role: 'operator',
    consumer_roles: ['operator', 'reviewer'],
    visibility: 'internal',
    review_status: 'approved',
    version: '1.0',
    supersedes_asset_key: 'workflow:public_demo_v0',
    superseded_by_asset_key: null,
    last_validated_at: '2026-07-10',
    risk_note: null,
    used_successfully_in: ['workflow:external_reference_v1'],
    source_evidence: [{
      asset_key: 'workflow:public_demo_v1',
      observation_id: '00000000-0000-4000-8000-000000000031',
      source_turn_id: 'st-001',
      actor_role: 'reviewer',
      context_scope: 'governance',
      occurred_at: '2026-07-10T04:00:00Z',
      text: 'Only reviewed synthetic data belongs on public routes.',
    }],
    related_assets: [{
      source_asset_key: 'workflow:public_demo_v1',
      asset_key: 'practice:public_boundary_v1',
      asset_type: 'best_practice',
      title: 'Public boundary',
    }],
  };
}

test('capability asset exposes governance, lineage, roles, and canonical source evidence', () => {
  const asset = buildCapabilityAsset(rawAsset());

  assert.equal(asset.asset_key, 'workflow:public_demo_v1');
  assert.equal(asset.governance.visibility, 'internal');
  assert.equal(asset.governance.review_status, 'approved');
  assert.deepEqual(asset.governance.consumer_roles, ['operator', 'reviewer']);
  assert.equal(asset.lineage.supersedes, 'workflow:public_demo_v0');
  assert.deepEqual(asset.used_successfully_in, ['workflow:external_reference_v1']);
  assert.equal(asset.evidence.source_turns[0].source_turn_id, 'st-001');
  assert.equal(
    asset.evidence.source_turns[0].observation_id,
    '00000000-0000-4000-8000-000000000031',
  );
  assert.equal(asset.evidence.related_assets[0].asset_key, 'practice:public_boundary_v1');
  assert.equal('id' in asset, false);
});

test('asset listing keeps the public-safe pack scope and forwards only normalized filters', async () => {
  let receivedFilters;
  const service = createCapabilityMemoryService({
    async listAssets(filters) {
      receivedFilters = filters;
      return [rawAsset()];
    },
  });
  const filters = { type: 'workflow', capability_area: 'governance', review_status: 'approved' };

  const result = await service.assets(filters);

  assert.deepEqual(receivedFilters, filters);
  assert.equal(result.scope.pack_key, PUBLIC_CAPABILITY_SCOPE.packKey);
  assert.equal(result.scope.corpus, 'public_demo');
  assert.equal(result.scope.source_classification, 'public_safe');
  assert.equal(result.count, 1);
});

test('task recommendations contain real hydrated assets and a deterministic reason', async () => {
  const task = {
    task_key: 'public_demo_release',
    task_title: 'Prepare a public demo',
    reason: 'Keep public and internal scopes separated.',
    recommendations: [{ rank: 1, reason: 'Pinned mapping.', asset: rawAsset() }],
  };
  const service = createCapabilityMemoryService({
    async listRecommendations() {
      return [task];
    },
    async findRecommendationTask(taskKey) {
      return taskKey === task.task_key ? task : null;
    },
  });

  const catalog = await service.recommendations();
  const selected = await service.recommend('public_demo_release');

  assert.equal(catalog.tasks[0].reason, task.reason);
  assert.equal(catalog.tasks[0].assets[0].asset_key, 'workflow:public_demo_v1');
  assert.equal(selected.task.reason, task.reason);
  assert.equal(selected.recommendations[0].evidence.source_turns.length, 1);
  await assert.rejects(service.recommend('internal_task'), (error) => {
    assert.equal(error.status, 404);
    assert.equal(error.code, 'task_not_found');
    return true;
  });
});

test('analytics converts stored aggregate counts without manufacturing signals', async () => {
  const service = createCapabilityMemoryService({
    async readAnalytics() {
      return {
        generated_at: '2026-07-10T04:00:00Z',
        total_assets: '9',
        asset_counts_by_type: [{ asset_type: 'workflow', count: '4' }],
        review_status_counts: [{ review_status: 'approved', count: '7' }],
        capability_area_counts: [{ capability_area: 'governance', count: '1' }],
        duplicated_patterns: [{
          pattern_key: 'source_first',
          asset_keys: ['workflow:public_demo_v1'],
          signal: 'Repeated pattern.',
        }],
        missing_capabilities: [{
          gap_key: 'feedback_loop',
          title: 'Feedback loop',
          signal: 'No outcome feedback yet.',
        }],
      };
    },
  });

  const result = await service.analytics();

  assert.equal(result.total_assets, 9);
  assert.equal(result.asset_counts_by_type[0].count, 4);
  assert.equal(result.duplicated_patterns[0].pattern_key, 'source_first');
  assert.equal(result.missing_capabilities[0].gap_key, 'feedback_loop');
});

test('an asset without canonical source evidence is not exposed', () => {
  assert.throws(
    () => buildCapabilityAsset({ ...rawAsset(), source_evidence: [] }),
    /has no public-safe source evidence/,
  );
});
