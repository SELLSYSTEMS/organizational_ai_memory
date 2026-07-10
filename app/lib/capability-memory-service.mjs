import { publicCapabilityScopeResponse } from './config.mjs';
import { HttpError } from './errors.mjs';

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

    async analytics() {
      const raw = await repository.readAnalytics();
      if (!raw) throw capabilityPackUnavailableError();
      return {
        scope: publicCapabilityScopeResponse(),
        generated_at: asIso(raw.generated_at),
        total_assets: Number(raw.total_assets),
        asset_counts_by_type: countRows(raw.asset_counts_by_type, 'asset_type'),
        review_status_counts: countRows(raw.review_status_counts, 'review_status'),
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
      };
    },
  };
}
