import { publicCapabilityScopeResponse } from './config.mjs';
import { HttpError } from './errors.mjs';
import { searchCapabilityCatalog } from './capability-search.mjs';

export const CAPABILITY_ASSET_TYPES = Object.freeze([
  'prompt',
  'workflow',
  'agent',
  'decision_pattern',
  'best_practice',
]);

export const CAPABILITY_REVIEW_STATUSES = Object.freeze([
  'draft',
  'reviewed',
  'approved',
  'deprecated',
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

function asDate(value) {
  const iso = asIso(value);
  return iso ? iso.slice(0, 10) : null;
}

function capabilityPackUnavailableError() {
  return new HttpError(
    503,
    'public_capability_pack_unavailable',
    'The public capability pack is not available.',
  );
}

function assetNotFoundError() {
  return new HttpError(404, 'asset_not_found', 'Capability asset not found.');
}

function taskNotFoundError() {
  return new HttpError(404, 'task_not_found', 'Recommendation task not found.');
}

function buildCapabilityContent(rawAsset) {
  const expectedFamilyKey = String(rawAsset.asset_key || '').replace(/_v\d+$/, '');
  const schemaVersion = Number(rawAsset.content_schema_version);
  const body = rawAsset.content_body;
  if (
    !expectedFamilyKey
    || rawAsset.asset_family_key !== expectedFamilyKey
    || !Number.isInteger(schemaVersion)
    || schemaVersion < 1
    || rawAsset.content_type !== 'application/json'
    || typeof rawAsset.change_summary !== 'string'
    || rawAsset.change_summary.trim().length === 0
    || !/^[0-9a-f]{64}$/.test(rawAsset.content_sha256 || '')
    || !body
    || typeof body !== 'object'
    || Array.isArray(body)
  ) {
    throw new Error(`Capability asset ${rawAsset.asset_key || 'unknown'} has invalid typed content.`);
  }
  return {
    asset_family_key: rawAsset.asset_family_key,
    version: rawAsset.version,
    schema_version: schemaVersion,
    content_type: rawAsset.content_type,
    change_summary: rawAsset.change_summary,
    sha256: rawAsset.content_sha256,
    body,
  };
}

export function buildCapabilityAsset(rawAsset) {
  const sourceTurns = asArray(rawAsset.source_evidence).map((evidence) => ({
    observation_id: evidence.observation_id,
    source_turn_id: evidence.source_turn_id,
    actor_role: evidence.actor_role,
    context_scope: evidence.context_scope,
    occurred_at: asIso(evidence.occurred_at),
    text: evidence.text,
  }));
  if (!sourceTurns.length) {
    throw new Error(`Capability asset ${rawAsset.asset_key || 'unknown'} has no public-safe source evidence.`);
  }

  return {
    asset_key: rawAsset.asset_key,
    asset_type: rawAsset.asset_type,
    title: rawAsset.title,
    summary: rawAsset.summary,
    capability_area: rawAsset.capability_area,
    problem_solved: rawAsset.problem_solved,
    why_it_worked: rawAsset.why_it_worked,
    content: buildCapabilityContent(rawAsset),
    governance: {
      visibility: rawAsset.visibility,
      review_status: rawAsset.review_status,
      version: rawAsset.version,
      owner_role: rawAsset.owner_role,
      consumer_roles: asArray(rawAsset.consumer_roles),
      last_validated_at: asDate(rawAsset.last_validated_at),
      risk_note: rawAsset.risk_note || null,
    },
    lineage: {
      supersedes: rawAsset.supersedes_asset_key || null,
      superseded_by: rawAsset.superseded_by_asset_key || null,
    },
    used_successfully_in: asArray(rawAsset.used_successfully_in),
    evidence: {
      source_turns: sourceTurns,
      related_assets: asArray(rawAsset.related_assets).map((related) => ({
        asset_key: related.asset_key,
        asset_type: related.asset_type,
        title: related.title,
      })),
    },
  };
}

function countRows(value, keyField) {
  return asArray(value).map((row) => ({
    [keyField]: row[keyField],
    count: Number(row.count),
  }));
}

function candidateSummary(candidate, kind) {
  const record = kind === 'task' ? candidate.task : candidate.asset;
  return {
    rank: 0,
    score: candidate.score,
    coverage: Number(candidate.coverage.toFixed(4)),
    matched_terms: candidate.matched_terms,
    matched_fields: candidate.matched_fields,
    role_match: candidate.role_match,
    ...(kind === 'task'
      ? {
          task: {
            task_key: record.task_key,
            task_title: record.task_title,
            reason: record.reason,
            recommended_asset_keys: record.assets.map((asset) => asset.asset_key),
          },
        }
      : { asset: record }),
  };
}

function rankedCandidates(candidates, kind) {
  return candidates.map((candidate, index) => ({
    ...candidateSummary(candidate, kind),
    rank: index + 1,
  }));
}

function percent(numerator, denominator) {
  return denominator > 0 ? Number(((numerator / denominator) * 100).toFixed(1)) : 0;
}

export function createCapabilityMemoryService(repository) {
  if (!repository) throw new TypeError('Capability memory repository is required.');

  return {
    async readiness() {
      return repository.readiness();
    },

    async assets(filters = {}) {
      const items = (await repository.listAssets(filters)).map(buildCapabilityAsset);
      return {
        scope: publicCapabilityScopeResponse(),
        filters: {
          type: filters.type || null,
          capability_area: filters.capability_area || null,
          review_status: filters.review_status || null,
        },
        count: items.length,
        items,
      };
    },

    async asset(assetKey) {
      const rawAsset = await repository.findAsset(assetKey);
      if (!rawAsset) throw assetNotFoundError();
      return {
        scope: publicCapabilityScopeResponse(),
        asset: buildCapabilityAsset(rawAsset),
      };
    },

    async recommendations() {
      const tasks = (await repository.listRecommendations()).map((task) => ({
        task_key: task.task_key,
        task_title: task.task_title,
        reason: task.reason,
        assets: task.recommendations.map((item) => buildCapabilityAsset(item.asset)),
      }));
      return {
        scope: publicCapabilityScopeResponse(),
        count: tasks.length,
        tasks,
      };
    },

    async recommend(taskKey) {
      const task = await repository.findRecommendationTask(taskKey);
      if (!task) throw taskNotFoundError();
      const recommendations = task.recommendations.map((item) => buildCapabilityAsset(item.asset));
      return {
        scope: publicCapabilityScopeResponse(),
        task: {
          task_key: task.task_key,
          task_title: task.task_title,
          reason: task.reason,
        },
        count: recommendations.length,
        recommendations,
      };
    },

    async search(query) {
      if (typeof repository.searchCatalog !== 'function') {
        throw new TypeError('Capability repository search catalog is required.');
      }
      const catalog = await repository.searchCatalog();
      const assets = catalog.assets.map(buildCapabilityAsset);
      const tasks = catalog.tasks.map((task) => ({
        task_key: task.task_key,
        task_title: task.task_title,
        reason: task.reason,
        assets: task.recommendations.map((item) => buildCapabilityAsset(item.asset)),
      }));
      const search = searchCapabilityCatalog({ query, assets, tasks });
      const selectedTask = search.resolution.selected_task_key
        ? tasks.find((task) => task.task_key === search.resolution.selected_task_key)
        : null;
      return {
        scope: publicCapabilityScopeResponse(),
        query: {
          text: query,
          normalized: search.normalized,
        },
        status: search.status,
        resolution: search.resolution,
        task_matches: rankedCandidates(search.task_candidates, 'task'),
        asset_matches: rankedCandidates(search.asset_candidates, 'asset'),
        recommendation: selectedTask
          ? {
              task: {
                task_key: selectedTask.task_key,
                task_title: selectedTask.task_title,
                reason: selectedTask.reason,
              },
              count: selectedTask.assets.length,
              recommendations: selectedTask.assets,
            }
          : null,
        retrieval: {
          strategy: 'bounded_catalog_deterministic_lexical_v1',
          semantic: { status: 'not_used' },
          applied_aliases: search.applied_aliases,
          result_limit: 5,
        },
      };
    },

    async analytics() {
      const raw = await repository.readAnalytics();
      if (!raw) throw capabilityPackUnavailableError();
      const totalAssets = Number(raw.total_assets);
      const assetsWithContent = Number(raw.assets_with_content || 0);
      const assetsWithoutEvidence = Number(raw.assets_without_evidence || 0);
      const totalTasks = Number(raw.total_tasks || 0);
      const tasksWithoutRecommendations = Number(raw.tasks_without_recommendations || 0);
      const recommendedAssets = Number(raw.recommended_assets || 0);
      const reviewCounts = countRows(raw.review_status_counts, 'review_status');
      const approvedAssets = reviewCounts.find((row) => row.review_status === 'approved')?.count || 0;
      const computedGaps = [];
      if (assetsWithContent < totalAssets) {
        computedGaps.push({
          gap_key: 'missing_reusable_content',
          count: totalAssets - assetsWithContent,
          signal: 'One or more governed assets do not have a stored reusable content body.',
        });
      }
      if (assetsWithoutEvidence > 0) {
        computedGaps.push({
          gap_key: 'missing_provenance',
          count: assetsWithoutEvidence,
          signal: 'One or more governed assets do not have source evidence.',
        });
      }
      if (tasksWithoutRecommendations > 0) {
        computedGaps.push({
          gap_key: 'unmapped_tasks',
          count: tasksWithoutRecommendations,
          signal: 'One or more stored tasks do not have a deterministic asset mapping.',
        });
      }
      if (approvedAssets < totalAssets) {
        computedGaps.push({
          gap_key: 'approval_queue',
          count: totalAssets - approvedAssets,
          signal: 'Reviewed assets remain visible with their status but have not reached approved state.',
        });
      }
      if (recommendedAssets < totalAssets) {
        computedGaps.push({
          gap_key: 'unmapped_assets',
          count: totalAssets - recommendedAssets,
          signal: 'One or more governed assets are not yet mapped to a deterministic task-start recommendation.',
        });
      }
      return {
        scope: publicCapabilityScopeResponse(),
        generated_at: asIso(raw.generated_at),
        total_assets: totalAssets,
        asset_counts_by_type: countRows(raw.asset_counts_by_type, 'asset_type'),
        review_status_counts: reviewCounts,
        capability_area_counts: countRows(raw.capability_area_counts, 'capability_area'),
        duplicated_patterns: asArray(raw.duplicated_patterns).map((signal) => ({
          pattern_key: signal.pattern_key,
          asset_keys: asArray(signal.asset_keys),
          signal: signal.signal,
        })),
        missing_capabilities: asArray(raw.missing_capabilities).map((signal) => ({
          gap_key: signal.gap_key,
          title: signal.title,
          signal: signal.signal,
        })),
        measurement_basis: {
          inventory: 'computed_postgres_records_at_request_time',
          authored_signals: 'reviewed_public_safe_pack',
          outcome_claims: 'not_measured',
        },
        coverage: {
          current_content_versions: Number(raw.current_content_versions || 0),
          assets_with_content: assetsWithContent,
          content_coverage_percent: percent(assetsWithContent, totalAssets),
          assets_with_evidence: totalAssets - assetsWithoutEvidence,
          evidence_coverage_percent: percent(totalAssets - assetsWithoutEvidence, totalAssets),
          total_tasks: totalTasks,
          tasks_with_recommendations: totalTasks - tasksWithoutRecommendations,
          task_coverage_percent: percent(totalTasks - tasksWithoutRecommendations, totalTasks),
        },
        reuse: {
          recommended_assets: recommendedAssets,
          recommendation_coverage_percent: percent(recommendedAssets, totalAssets),
          reused_across_tasks: asArray(raw.reused_across_tasks).map((item) => ({
            asset_key: item.asset_key,
            task_count: Number(item.task_count),
            task_keys: asArray(item.task_keys),
          })),
        },
        duplication: {
          exact_content_groups: asArray(raw.duplicate_content_groups).map((group) => ({
            sha256: group.content_sha256,
            asset_keys: asArray(group.asset_keys),
            count: Number(group.count),
          })),
          method: 'exact_current_content_sha256',
        },
        computed_gaps: computedGaps,
      };
    },
  };
}
