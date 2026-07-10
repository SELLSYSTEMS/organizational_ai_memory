import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PUBLIC_CAPABILITY_SCOPE,
  publicCapabilityScopeSqlParameters,
} from '../../app/lib/config.mjs';
import { createCapabilityMemoryRepository } from '../../app/lib/capability-memory-repository.mjs';

function assetRow() {
  return {
    id: '00000000-0000-5000-a000-000000000001',
    asset_key: 'workflow:public_demo_v1',
    asset_type: 'workflow',
    title: 'Public demo workflow',
    summary: 'A governed workflow.',
    capability_area: 'governance',
    problem_solved: 'Keeps demo data bounded.',
    why_it_worked: 'It uses a pinned scope.',
    owner_role: 'operator',
    consumer_roles: ['operator'],
    visibility: 'internal',
    review_status: 'approved',
    version: '1.0',
    supersedes_asset_key: null,
    superseded_by_asset_key: null,
    last_validated_at: '2026-07-10',
    risk_note: null,
    used_successfully_in: [],
  };
}

function fakePool() {
  const calls = [];
  return {
    calls,
    async query(sql, parameters) {
      calls.push({ sql, parameters });
      if (sql.includes('capability:readiness')) {
        return { rows: [{ public_capability_pack_available: true }] };
      }
      if (sql.includes('capability:list-assets') || sql.includes('capability:find-asset')) {
        return { rows: [assetRow()] };
      }
      if (sql.includes('capability:source-evidence')) {
        return { rows: [{
          asset_key: 'workflow:public_demo_v1',
          observation_id: '00000000-0000-4000-8000-000000000031',
          source_turn_id: 'st-001',
          actor_role: 'reviewer',
          context_scope: 'governance',
          occurred_at: '2026-07-10T04:00:00Z',
          text: 'Reviewed public-safe evidence.',
        }] };
      }
      if (sql.includes('capability:related-assets')) return { rows: [] };
      if (sql.includes('capability:recommendations')) {
        return { rows: [{
          task_key: 'public_demo_release',
          task_title: 'Prepare a public demo',
          task_reason: 'Keep scopes separate.',
          task_sort_order: 1,
          recommendation_rank: 1,
          recommendation_reason: 'Keep scopes separate.',
          ...assetRow(),
        }] };
      }
      if (sql.includes('capability:analytics')) {
        return { rows: [{ total_assets: '1', asset_counts_by_type: [] }] };
      }
      return { rows: [] };
    },
  };
}

function assertPinnedScope(call) {
  assert.deepEqual(call.parameters.slice(0, 6), publicCapabilityScopeSqlParameters());
  assert.match(call.sql, /p\.pack_key = \$1/);
  assert.match(call.sql, /p\.brand_key = \$2/);
  assert.match(call.sql, /p\.corpus = \$3/);
  assert.match(call.sql, /p\.source_classification = \$4/);
  assert.match(call.sql, /p\.publication_status = \$5/);
  assert.match(call.sql, /evidence_thread\.thread_key = \$6/);
  assert.match(call.sql, /evidence_thread\.metadata @> jsonb_build_object/);
  assert.match(call.sql, /'review_status', 'approved_for_public_demo'::text/);
}

test('all asset reads are pinned and filters remain SQL parameters', async () => {
  const pool = fakePool();
  const repository = createCapabilityMemoryRepository(pool);
  const injected = "governance' OR p.source_classification = 'internal";

  assert.equal(await repository.readiness(), true);
  const assets = await repository.listAssets({
    type: 'workflow',
    capability_area: injected,
    review_status: 'approved',
  });
  await repository.findAsset('workflow:public_demo_v1');

  assert.equal(assets[0].source_evidence[0].source_turn_id, 'st-001');
  assert.equal(
    assets[0].source_evidence[0].observation_id,
    '00000000-0000-4000-8000-000000000031',
  );
  assert.ok(pool.calls.length >= 7);
  for (const call of pool.calls) assertPinnedScope(call);
  const listCall = pool.calls.find((call) => call.sql.includes('capability:list-assets'));
  assert.deepEqual(listCall.parameters.slice(6), ['workflow', injected, 'approved']);
  assert.equal(listCall.sql.includes(injected), false);
  const findCall = pool.calls.find((call) => call.sql.includes('capability:find-asset'));
  assert.equal(findCall.parameters[6], 'workflow:public_demo_v1');
});

test('recommendations join stored assets in the same eligible pack', async () => {
  const pool = fakePool();
  const repository = createCapabilityMemoryRepository(pool);

  const task = await repository.findRecommendationTask('public_demo_release');

  assert.equal(task.reason, 'Keep scopes separate.');
  assert.equal(task.recommendations[0].asset.asset_key, 'workflow:public_demo_v1');
  assert.equal(task.recommendations[0].asset.source_evidence.length, 1);
  const recommendationCall = pool.calls.find((call) => call.sql.includes('capability:recommendations'));
  assertPinnedScope(recommendationCall);
  assert.equal(recommendationCall.parameters[6], 'public_demo_release');
  assert.match(recommendationCall.sql, /JOIN memory\.capability_assets a/);
  assert.match(recommendationCall.sql, /a\.pack_id = p\.id/);
});

test('analytics derive counts from stored assets while reading persisted gap signals', async () => {
  const pool = fakePool();
  const repository = createCapabilityMemoryRepository(pool);

  await repository.readAnalytics();

  const call = pool.calls.at(-1);
  assertPinnedScope(call);
  assert.match(call.sql, /count\(\*\).*memory\.capability_assets/s);
  assert.match(call.sql, /memory\.capability_analytics_signals/);
  assert.equal(call.sql.includes('internal_demo'), false);
  assert.equal(PUBLIC_CAPABILITY_SCOPE.sourceClassification, 'public_safe');
});
