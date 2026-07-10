import { publicCapabilityScopeSqlParameters } from './config.mjs';

const ELIGIBLE_PACK_CTE = `
  SELECT
    p.id,
    p.evidence_thread_id,
    p.generated_at
  FROM memory.capability_packs p
  JOIN memory.threads evidence_thread
    ON evidence_thread.id = p.evidence_thread_id
   AND evidence_thread.thread_key = $6
   AND evidence_thread.brand_key = $2
   AND evidence_thread.status = $5
   AND evidence_thread.metadata @> jsonb_build_object(
     'corpus', $3::text,
     'visibility', $4::text,
     'source_classification', $4::text,
     'review_status', 'approved_for_public_demo'::text
   )
  WHERE p.pack_key = $1
    AND p.brand_key = $2
    AND p.corpus = $3
    AND p.source_classification = $4
    AND p.publication_status = $5
`;

const ASSET_COLUMNS = `
  a.id,
  a.asset_key,
  a.asset_type,
  a.title,
  a.summary,
  a.capability_area,
  a.problem_solved,
  a.why_it_worked,
  a.owner_role,
  a.consumer_roles,
  a.visibility,
  a.review_status,
  a.version,
  a.supersedes_asset_key,
  a.superseded_by_asset_key,
  a.last_validated_at,
  a.risk_note,
  a.used_successfully_in
`;

const READINESS_SQL = `
  /* capability:readiness */
  SELECT EXISTS (
    ${ELIGIBLE_PACK_CTE}
  ) AS public_capability_pack_available
`;

const LIST_ASSETS_SQL = `
  /* capability:list-assets */
  WITH eligible_pack AS (${ELIGIBLE_PACK_CTE})
  SELECT ${ASSET_COLUMNS}
  FROM eligible_pack p
  JOIN memory.capability_assets a ON a.pack_id = p.id
  WHERE ($7::text IS NULL OR a.asset_type = $7)
    AND ($8::text IS NULL OR a.capability_area = $8)
    AND ($9::text IS NULL OR a.review_status = $9)
  ORDER BY
    CASE a.asset_type
      WHEN 'prompt' THEN 1
      WHEN 'workflow' THEN 2
      WHEN 'agent' THEN 3
      WHEN 'decision_pattern' THEN 4
      WHEN 'best_practice' THEN 5
      ELSE 6
    END,
    a.title,
    a.asset_key
  LIMIT 50
`;

const FIND_ASSET_SQL = `
  /* capability:find-asset */
  WITH eligible_pack AS (${ELIGIBLE_PACK_CTE})
  SELECT ${ASSET_COLUMNS}
  FROM eligible_pack p
  JOIN memory.capability_assets a ON a.pack_id = p.id
  WHERE a.asset_key = $7
  LIMIT 1
`;

const SOURCE_EVIDENCE_SQL = `
  /* capability:source-evidence */
  WITH eligible_pack AS (${ELIGIBLE_PACK_CTE})
  SELECT
    a.asset_key,
    o.id AS observation_id,
    tt.source_turn_id,
    tt.actor_role,
    COALESCE(o.metadata->>'context_scope', o.subject_key) AS context_scope,
    COALESCE(tt.sent_at, o.observed_at) AS occurred_at,
    left(o.observation_text, 1600) AS text
  FROM eligible_pack p
  JOIN memory.capability_assets a ON a.pack_id = p.id
  JOIN memory.capability_asset_evidence ae
    ON ae.pack_id = p.id
   AND ae.asset_id = a.id
  JOIN memory.observations o
    ON o.id = ae.observation_id
   AND o.thread_id = p.evidence_thread_id
   AND o.observation_kind = 'capability_source_narrative'
   AND o.is_active = true
  JOIN memory.thread_turns tt
    ON tt.id = ae.turn_id
   AND tt.id = o.turn_id
   AND tt.thread_id = p.evidence_thread_id
  WHERE a.asset_key = ANY($7::text[])
  ORDER BY a.asset_key, COALESCE(tt.sent_at, o.observed_at), tt.source_turn_id
  LIMIT 500
`;

const RELATED_ASSETS_SQL = `
  /* capability:related-assets */
  WITH eligible_pack AS (${ELIGIBLE_PACK_CTE})
  SELECT
    source_asset.asset_key AS source_asset_key,
    target_asset.asset_key,
    target_asset.asset_type,
    target_asset.title
  FROM eligible_pack p
  JOIN memory.capability_asset_relations relation
    ON relation.pack_id = p.id
   AND relation.relation_kind = 'linked_evidence'
  JOIN memory.capability_assets source_asset
    ON source_asset.id = relation.source_asset_id
   AND source_asset.pack_id = p.id
  JOIN memory.capability_assets target_asset
    ON target_asset.id = relation.target_asset_id
   AND target_asset.pack_id = p.id
  WHERE source_asset.asset_key = ANY($7::text[])
  ORDER BY source_asset.asset_key, target_asset.asset_type, target_asset.title, target_asset.asset_key
  LIMIT 500
`;

const RECOMMENDATIONS_SQL = `
  /* capability:recommendations */
  WITH eligible_pack AS (${ELIGIBLE_PACK_CTE})
  SELECT
    task.task_key,
    task.task_title,
    task.reason AS task_reason,
    task.sort_order AS task_sort_order,
    recommendation.recommendation_rank,
    recommendation.recommendation_reason,
    ${ASSET_COLUMNS}
  FROM eligible_pack p
  JOIN memory.capability_tasks task ON task.pack_id = p.id
  JOIN memory.capability_task_recommendations recommendation
    ON recommendation.pack_id = p.id
   AND recommendation.task_id = task.id
  JOIN memory.capability_assets a
    ON a.pack_id = p.id
   AND a.id = recommendation.asset_id
  WHERE ($7::text IS NULL OR task.task_key = $7)
  ORDER BY task.sort_order, task.task_key, recommendation.recommendation_rank
  LIMIT 200
`;

const ANALYTICS_SQL = `
  /* capability:analytics */
  WITH eligible_pack AS (${ELIGIBLE_PACK_CTE})
  SELECT
    p.generated_at,
    (SELECT count(*) FROM memory.capability_assets a WHERE a.pack_id = p.id) AS total_assets,
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object('asset_type', grouped.asset_type, 'count', grouped.asset_count)
        ORDER BY grouped.sort_order, grouped.asset_type
      )
      FROM (
        SELECT
          a.asset_type,
          count(*) AS asset_count,
          CASE a.asset_type
            WHEN 'prompt' THEN 1
            WHEN 'workflow' THEN 2
            WHEN 'agent' THEN 3
            WHEN 'decision_pattern' THEN 4
            WHEN 'best_practice' THEN 5
            ELSE 6
          END AS sort_order
        FROM memory.capability_assets a
        WHERE a.pack_id = p.id
        GROUP BY a.asset_type
      ) grouped
    ), '[]'::jsonb) AS asset_counts_by_type,
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object('review_status', grouped.review_status, 'count', grouped.asset_count)
        ORDER BY grouped.sort_order, grouped.review_status
      )
      FROM (
        SELECT
          a.review_status,
          count(*) AS asset_count,
          CASE a.review_status
            WHEN 'approved' THEN 1
            WHEN 'reviewed' THEN 2
            WHEN 'draft' THEN 3
            WHEN 'deprecated' THEN 4
            ELSE 5
          END AS sort_order
        FROM memory.capability_assets a
        WHERE a.pack_id = p.id
        GROUP BY a.review_status
      ) grouped
    ), '[]'::jsonb) AS review_status_counts,
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object('capability_area', grouped.capability_area, 'count', grouped.asset_count)
        ORDER BY grouped.capability_area
      )
      FROM (
        SELECT a.capability_area, count(*) AS asset_count
        FROM memory.capability_assets a
        WHERE a.pack_id = p.id
        GROUP BY a.capability_area
      ) grouped
    ), '[]'::jsonb) AS capability_area_counts,
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'pattern_key', signal.signal_key,
          'asset_keys', signal.asset_keys,
          'signal', signal.signal
        )
        ORDER BY signal.sort_order, signal.signal_key
      )
      FROM memory.capability_analytics_signals signal
      WHERE signal.pack_id = p.id
        AND signal.signal_type = 'duplicated_pattern'
    ), '[]'::jsonb) AS duplicated_patterns,
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'gap_key', signal.signal_key,
          'title', signal.title,
          'signal', signal.signal
        )
        ORDER BY signal.sort_order, signal.signal_key
      )
      FROM memory.capability_analytics_signals signal
      WHERE signal.pack_id = p.id
        AND signal.signal_type = 'missing_capability'
    ), '[]'::jsonb) AS missing_capabilities
  FROM eligible_pack p
  LIMIT 1
`;

const ASSET_FIELD_NAMES = Object.freeze([
  'id',
  'asset_key',
  'asset_type',
  'title',
  'summary',
  'capability_area',
  'problem_solved',
  'why_it_worked',
  'owner_role',
  'consumer_roles',
  'visibility',
  'review_status',
  'version',
  'supersedes_asset_key',
  'superseded_by_asset_key',
  'last_validated_at',
  'risk_note',
  'used_successfully_in',
]);

function rows(result) {
  return Array.isArray(result?.rows) ? result.rows : [];
}

function assetFields(row) {
  return Object.fromEntries(ASSET_FIELD_NAMES.map((field) => [field, row[field]]));
}

export function createCapabilityMemoryRepository(pool) {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('A PostgreSQL pool with a query method is required.');
  }

  const scopeParameters = () => publicCapabilityScopeSqlParameters();

  async function hydrateAssets(assetRows) {
    if (!assetRows.length) return [];
    const assetKeys = assetRows.map((asset) => asset.asset_key);
    const parameters = [...scopeParameters(), assetKeys];
    const [evidenceResult, relatedResult] = await Promise.all([
      pool.query(SOURCE_EVIDENCE_SQL, parameters),
      pool.query(RELATED_ASSETS_SQL, parameters),
    ]);
    const evidenceByAsset = Map.groupBy(rows(evidenceResult), (row) => row.asset_key);
    const relatedByAsset = Map.groupBy(rows(relatedResult), (row) => row.source_asset_key);

    return assetRows.map((asset) => ({
      ...asset,
      source_evidence: evidenceByAsset.get(asset.asset_key) || [],
      related_assets: relatedByAsset.get(asset.asset_key) || [],
    }));
  }

  async function readRecommendations(taskKey) {
    const result = await pool.query(RECOMMENDATIONS_SQL, [...scopeParameters(), taskKey]);
    const recommendationRows = rows(result);
    if (!recommendationRows.length) return [];

    const uniqueAssets = [
      ...new Map(recommendationRows.map((row) => [row.asset_key, assetFields(row)])).values(),
    ];
    const hydratedAssets = await hydrateAssets(uniqueAssets);
    const assetsByKey = new Map(hydratedAssets.map((asset) => [asset.asset_key, asset]));
    const tasks = new Map();

    for (const row of recommendationRows) {
      if (!tasks.has(row.task_key)) {
        tasks.set(row.task_key, {
          task_key: row.task_key,
          task_title: row.task_title,
          reason: row.task_reason,
          sort_order: row.task_sort_order,
          recommendations: [],
        });
      }
      tasks.get(row.task_key).recommendations.push({
        rank: Number(row.recommendation_rank),
        reason: row.recommendation_reason,
        asset: assetsByKey.get(row.asset_key),
      });
    }

    return [...tasks.values()];
  }

  return {
    async readiness() {
      const result = await pool.query(READINESS_SQL, scopeParameters());
      return Boolean(result.rows[0]?.public_capability_pack_available);
    },

    async listAssets(filters = {}) {
      const result = await pool.query(LIST_ASSETS_SQL, [
        ...scopeParameters(),
        filters.type || null,
        filters.capability_area || null,
        filters.review_status || null,
      ]);
      return hydrateAssets(rows(result));
    },

    async findAsset(assetKey) {
      const result = await pool.query(FIND_ASSET_SQL, [...scopeParameters(), assetKey]);
      const asset = result.rows[0];
      if (!asset) return null;
      return (await hydrateAssets([asset]))[0];
    },

    async listRecommendations() {
      return readRecommendations(null);
    },

    async findRecommendationTask(taskKey) {
      return (await readRecommendations(taskKey))[0] || null;
    },

    async readAnalytics() {
      const result = await pool.query(ANALYTICS_SQL, scopeParameters());
      return result.rows[0] || null;
    },
  };
}
