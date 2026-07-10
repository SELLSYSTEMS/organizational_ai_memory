import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PUBLIC_CAPABILITY_SCOPE } from '../../app/lib/config.mjs';
import {
  compactText,
  createPgClient,
  repoRoot,
} from '../memory/_memory_runtime.mjs';

const PACK_DIRECTORY = path.join(
  repoRoot,
  'handoff',
  'aihackathon_public_safe_asset_pack_2026-07-10',
);
const ASSET_TYPES = new Set(['prompt', 'workflow', 'agent', 'decision_pattern', 'best_practice']);
const REVIEW_STATUSES = new Set(['draft', 'reviewed', 'approved', 'deprecated']);
const ASSET_KEY_PATTERN = /^(?:prompt|workflow|agent|decision|practice):[a-z0-9][a-z0-9_]*$/;
const SLUG_PATTERN = /^[a-z][a-z0-9_]*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function fail(message) {
  throw new Error(`Invalid public-safe capability pack: ${message}`);
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  return value;
}

function assertArray(value, label, { min = 0, max = 100 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    fail(`${label} must contain between ${min} and ${max} items.`);
  }
  return value;
}

function assertString(value, label, { min = 1, max = 2_000, pattern } = {}) {
  if (typeof value !== 'string') fail(`${label} must be a string.`);
  const normalized = compactText(value);
  if (normalized.length < min || normalized.length > max || (pattern && !pattern.test(normalized))) {
    fail(`${label} is invalid.`);
  }
  return normalized;
}

function assertNullableString(value, label, options) {
  if (value === null || value === undefined) return null;
  return assertString(value, label, options);
}

function assertExactKeys(record, label, required, optional = []) {
  const keys = Object.keys(record).sort();
  const allowed = new Set([...required, ...optional]);
  const missing = required.filter((key) => !(key in record));
  const unexpected = keys.filter((key) => !allowed.has(key));
  if (missing.length || unexpected.length) {
    fail(`${label} has missing keys [${missing.join(', ')}] or unexpected keys [${unexpected.join(', ')}].`);
  }
}

function uniqueStrings(value, label, options = {}) {
  const items = assertArray(value, label, options).map((item, index) =>
    assertString(item, `${label}[${index}]`, { max: options.stringMax || 160, pattern: options.pattern }),
  );
  if (new Set(items).size !== items.length) fail(`${label} contains duplicate values.`);
  return items;
}

function countBy(items, field) {
  const counts = new Map();
  for (const item of items) counts.set(item[field], (counts.get(item[field]) || 0) + 1);
  return counts;
}

function validateDeclaredCounts(label, declaredRows, actualCounts, keyField) {
  const declared = new Map();
  for (const [index, rowValue] of assertArray(declaredRows, label, { max: 100 }).entries()) {
    const row = assertObject(rowValue, `${label}[${index}]`);
    assertExactKeys(row, `${label}[${index}]`, [keyField, 'count']);
    const key = assertString(row[keyField], `${label}[${index}].${keyField}`, {
      max: 80,
      pattern: SLUG_PATTERN,
    });
    if (!Number.isInteger(row.count) || row.count < 0 || row.count > 10_000) {
      fail(`${label}[${index}].count is invalid.`);
    }
    if (declared.has(key)) fail(`${label} contains duplicate key ${key}.`);
    declared.set(key, row.count);
  }

  for (const [key, count] of actualCounts) {
    if (declared.get(key) !== count) fail(`${label} does not match assets for ${key}.`);
  }
  for (const [key, count] of declared) {
    if ((actualCounts.get(key) || 0) !== count) fail(`${label} has an invalid count for ${key}.`);
  }
}

export function validateCapabilityPack({ assets, recommendations, analytics, sourceTurns }) {
  const normalizedAssets = assertArray(assets, 'assets', { min: 1, max: 50 }).map((value, index) => {
    const asset = assertObject(value, `assets[${index}]`);
    const required = [
      'asset_key',
      'asset_type',
      'title',
      'summary',
      'capability_area',
      'owner_role',
      'consumer_roles',
      'visibility',
      'review_status',
      'version',
      'supersedes',
      'last_validated_at',
      'problem_solved',
      'why_it_worked',
      'used_successfully_in',
      'linked_evidence_keys',
      'source_turn_ids',
    ];
    assertExactKeys(asset, `assets[${index}]`, required, ['risk_note']);
    const assetType = assertString(asset.asset_type, `assets[${index}].asset_type`, { max: 32 });
    if (!ASSET_TYPES.has(assetType)) fail(`assets[${index}].asset_type is unsupported.`);
    const reviewStatus = assertString(asset.review_status, `assets[${index}].review_status`, { max: 32 });
    if (!REVIEW_STATUSES.has(reviewStatus)) fail(`assets[${index}].review_status is unsupported.`);
    const date = assertString(asset.last_validated_at, `assets[${index}].last_validated_at`, {
      max: 10,
      pattern: DATE_PATTERN,
    });
    if (Number.isNaN(new Date(`${date}T00:00:00Z`).valueOf())) {
      fail(`assets[${index}].last_validated_at is not a valid date.`);
    }

    return {
      asset_key: assertString(asset.asset_key, `assets[${index}].asset_key`, {
        max: 160,
        pattern: ASSET_KEY_PATTERN,
      }),
      asset_type: assetType,
      title: assertString(asset.title, `assets[${index}].title`, { max: 200 }),
      summary: assertString(asset.summary, `assets[${index}].summary`, { max: 1_000 }),
      capability_area: assertString(asset.capability_area, `assets[${index}].capability_area`, {
        max: 80,
        pattern: SLUG_PATTERN,
      }),
      owner_role: assertString(asset.owner_role, `assets[${index}].owner_role`, {
        max: 80,
        pattern: SLUG_PATTERN,
      }),
      consumer_roles: uniqueStrings(asset.consumer_roles, `assets[${index}].consumer_roles`, {
        min: 1,
        max: 32,
        stringMax: 80,
        pattern: SLUG_PATTERN,
      }),
      visibility: assertString(asset.visibility, `assets[${index}].visibility`, {
        max: 80,
        pattern: SLUG_PATTERN,
      }),
      review_status: reviewStatus,
      version: assertString(asset.version, `assets[${index}].version`, {
        max: 32,
        pattern: /^\d+\.\d+(?:\.\d+)?$/,
      }),
      supersedes: assertNullableString(asset.supersedes, `assets[${index}].supersedes`, {
        max: 160,
        pattern: ASSET_KEY_PATTERN,
      }),
      last_validated_at: date,
      risk_note: assertNullableString(asset.risk_note, `assets[${index}].risk_note`, { max: 1_000 }),
      problem_solved: assertString(asset.problem_solved, `assets[${index}].problem_solved`, { max: 2_000 }),
      why_it_worked: assertString(asset.why_it_worked, `assets[${index}].why_it_worked`, { max: 2_000 }),
      used_successfully_in: uniqueStrings(
        asset.used_successfully_in,
        `assets[${index}].used_successfully_in`,
        { max: 64, stringMax: 160, pattern: ASSET_KEY_PATTERN },
      ),
      linked_evidence_keys: uniqueStrings(
        asset.linked_evidence_keys,
        `assets[${index}].linked_evidence_keys`,
        { max: 64, stringMax: 160, pattern: ASSET_KEY_PATTERN },
      ),
      source_turn_ids: uniqueStrings(asset.source_turn_ids, `assets[${index}].source_turn_ids`, {
        min: 1,
        max: 64,
        stringMax: 80,
        pattern: /^st-[a-z0-9][a-z0-9-]*$/,
      }),
    };
  });

  const assetKeys = new Set(normalizedAssets.map((asset) => asset.asset_key));
  if (assetKeys.size !== normalizedAssets.length) fail('assets contains duplicate asset_key values.');
  for (const asset of normalizedAssets) {
    for (const linkedKey of asset.linked_evidence_keys) {
      if (!assetKeys.has(linkedKey)) fail(`${asset.asset_key} links unresolved asset ${linkedKey}.`);
      if (linkedKey === asset.asset_key) fail(`${asset.asset_key} cannot link itself as evidence.`);
    }
  }

  const normalizedSourceTurns = assertArray(sourceTurns, 'source_turns', { min: 1, max: 100 })
    .map((value, index) => {
      const turn = assertObject(value, `source_turns[${index}]`);
      assertExactKeys(turn, `source_turns[${index}]`, [
        'source_turn_id',
        'actor_role',
        'context_scope',
        'timestamp',
        'text',
        'derived_asset_keys',
      ]);
      const timestamp = assertString(turn.timestamp, `source_turns[${index}].timestamp`, { max: 40 });
      if (Number.isNaN(new Date(timestamp).valueOf())) fail(`source_turns[${index}].timestamp is invalid.`);
      const derivedAssetKeys = uniqueStrings(
        turn.derived_asset_keys,
        `source_turns[${index}].derived_asset_keys`,
        { min: 1, max: 50, stringMax: 160, pattern: ASSET_KEY_PATTERN },
      );
      for (const assetKey of derivedAssetKeys) {
        if (!assetKeys.has(assetKey)) fail(`source turn derives unresolved asset ${assetKey}.`);
      }
      return {
        source_turn_id: assertString(turn.source_turn_id, `source_turns[${index}].source_turn_id`, {
          max: 80,
          pattern: /^st-[a-z0-9][a-z0-9-]*$/,
        }),
        actor_role: assertString(turn.actor_role, `source_turns[${index}].actor_role`, {
          max: 80,
          pattern: SLUG_PATTERN,
        }),
        context_scope: assertString(turn.context_scope, `source_turns[${index}].context_scope`, {
          max: 80,
          pattern: SLUG_PATTERN,
        }),
        timestamp: new Date(timestamp).toISOString(),
        text: assertString(turn.text, `source_turns[${index}].text`, { max: 2_000 }),
        derived_asset_keys: derivedAssetKeys,
      };
    });
  const sourceTurnIds = new Set(normalizedSourceTurns.map((turn) => turn.source_turn_id));
  if (sourceTurnIds.size !== normalizedSourceTurns.length) fail('source_turns contains duplicate source_turn_id values.');

  const evidenceEdges = new Map(normalizedAssets.map((asset) => [asset.asset_key, new Set()]));
  for (const asset of normalizedAssets) {
    for (const sourceTurnId of asset.source_turn_ids) {
      if (!sourceTurnIds.has(sourceTurnId)) fail(`${asset.asset_key} references unresolved turn ${sourceTurnId}.`);
      evidenceEdges.get(asset.asset_key).add(sourceTurnId);
    }
  }
  for (const turn of normalizedSourceTurns) {
    for (const assetKey of turn.derived_asset_keys) evidenceEdges.get(assetKey).add(turn.source_turn_id);
  }
  for (const [assetKey, turnIds] of evidenceEdges) {
    if (!turnIds.size) fail(`${assetKey} has no source evidence.`);
  }

  const normalizedRecommendations = assertArray(recommendations, 'recommendations', { min: 1, max: 50 })
    .map((value, index) => {
      const recommendation = assertObject(value, `recommendations[${index}]`);
      assertExactKeys(recommendation, `recommendations[${index}]`, [
        'task_key',
        'task_title',
        'recommended_asset_keys',
        'reason',
      ]);
      const recommendedAssetKeys = uniqueStrings(
        recommendation.recommended_asset_keys,
        `recommendations[${index}].recommended_asset_keys`,
        { min: 1, max: 20, stringMax: 160, pattern: ASSET_KEY_PATTERN },
      );
      for (const assetKey of recommendedAssetKeys) {
        if (!assetKeys.has(assetKey)) fail(`recommendation references unresolved asset ${assetKey}.`);
      }
      return {
        task_key: assertString(recommendation.task_key, `recommendations[${index}].task_key`, {
          max: 80,
          pattern: SLUG_PATTERN,
        }),
        task_title: assertString(recommendation.task_title, `recommendations[${index}].task_title`, { max: 240 }),
        recommended_asset_keys: recommendedAssetKeys,
        reason: assertString(recommendation.reason, `recommendations[${index}].reason`, { max: 1_000 }),
      };
    });
  if (new Set(normalizedRecommendations.map((item) => item.task_key)).size !== normalizedRecommendations.length) {
    fail('recommendations contains duplicate task_key values.');
  }

  const analyticsObject = assertObject(analytics, 'analytics');
  assertExactKeys(analyticsObject, 'analytics', [
    'generated_at',
    'asset_counts_by_type',
    'review_status_counts',
    'capability_area_counts',
    'duplicated_patterns',
    'missing_capabilities',
  ]);
  const generatedAt = assertString(analyticsObject.generated_at, 'analytics.generated_at', { max: 40 });
  if (Number.isNaN(new Date(generatedAt).valueOf())) fail('analytics.generated_at is invalid.');
  validateDeclaredCounts(
    'analytics.asset_counts_by_type',
    analyticsObject.asset_counts_by_type,
    countBy(normalizedAssets, 'asset_type'),
    'asset_type',
  );
  validateDeclaredCounts(
    'analytics.review_status_counts',
    analyticsObject.review_status_counts,
    countBy(normalizedAssets, 'review_status'),
    'review_status',
  );
  validateDeclaredCounts(
    'analytics.capability_area_counts',
    analyticsObject.capability_area_counts,
    countBy(normalizedAssets, 'capability_area'),
    'capability_area',
  );

  const duplicatedPatterns = assertArray(
    analyticsObject.duplicated_patterns,
    'analytics.duplicated_patterns',
    { max: 100 },
  ).map((value, index) => {
    const signal = assertObject(value, `analytics.duplicated_patterns[${index}]`);
    assertExactKeys(signal, `analytics.duplicated_patterns[${index}]`, ['pattern_key', 'asset_keys', 'signal']);
    const signalAssetKeys = uniqueStrings(
      signal.asset_keys,
      `analytics.duplicated_patterns[${index}].asset_keys`,
      { min: 2, max: 50, stringMax: 160, pattern: ASSET_KEY_PATTERN },
    );
    for (const assetKey of signalAssetKeys) {
      if (!assetKeys.has(assetKey)) fail(`duplicated pattern references unresolved asset ${assetKey}.`);
    }
    return {
      pattern_key: assertString(signal.pattern_key, `analytics.duplicated_patterns[${index}].pattern_key`, {
        max: 80,
        pattern: SLUG_PATTERN,
      }),
      asset_keys: signalAssetKeys,
      signal: assertString(signal.signal, `analytics.duplicated_patterns[${index}].signal`, { max: 1_000 }),
    };
  });
  const missingCapabilities = assertArray(
    analyticsObject.missing_capabilities,
    'analytics.missing_capabilities',
    { max: 100 },
  ).map((value, index) => {
    const signal = assertObject(value, `analytics.missing_capabilities[${index}]`);
    assertExactKeys(signal, `analytics.missing_capabilities[${index}]`, ['gap_key', 'title', 'signal']);
    return {
      gap_key: assertString(signal.gap_key, `analytics.missing_capabilities[${index}].gap_key`, {
        max: 80,
        pattern: SLUG_PATTERN,
      }),
      title: assertString(signal.title, `analytics.missing_capabilities[${index}].title`, { max: 240 }),
      signal: assertString(signal.signal, `analytics.missing_capabilities[${index}].signal`, { max: 1_000 }),
    };
  });

  return {
    assets: normalizedAssets,
    recommendations: normalizedRecommendations,
    sourceTurns: normalizedSourceTurns,
    evidenceEdges,
    analytics: {
      generated_at: new Date(generatedAt).toISOString(),
      duplicated_patterns: duplicatedPatterns,
      missing_capabilities: missingCapabilities,
    },
  };
}

async function readPackFiles() {
  const [assets, recommendations, analytics, sourceTurns] = await Promise.all([
    fs.readFile(path.join(PACK_DIRECTORY, 'assets.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(PACK_DIRECTORY, 'recommendations.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(PACK_DIRECTORY, 'analytics.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(PACK_DIRECTORY, 'source_turns.json'), 'utf8').then(JSON.parse),
  ]);
  return validateCapabilityPack({ assets, recommendations, analytics, sourceTurns });
}

export async function importCapabilityPack() {
  if (process.argv.length > 2) fail('this importer does not accept an alternate source path.');
  const pack = await readPackFiles();
  const client = await createPgClient();
  const threadMetadata = {
    corpus: PUBLIC_CAPABILITY_SCOPE.corpus,
    visibility: PUBLIC_CAPABILITY_SCOPE.sourceClassification,
    source_classification: PUBLIC_CAPABILITY_SCOPE.sourceClassification,
    review_status: 'approved_for_public_demo',
    description: 'Sanitized source narratives for the public capability asset pack.',
    capability_pack_key: PUBLIC_CAPABILITY_SCOPE.packKey,
  };

  try {
    await client.query('BEGIN');
    const threadResult = await client.query(
      `
        INSERT INTO memory.threads (
          thread_key,
          brand_key,
          scope_kind,
          scope_key,
          source_system,
          title,
          language_code,
          status,
          metadata
        )
        VALUES ($1, $2, 'capability_pack', $3, 'public_safe_synthetic_demo', $4, 'en', $5, $6::jsonb)
        ON CONFLICT (thread_key) DO UPDATE SET
          brand_key = EXCLUDED.brand_key,
          scope_kind = EXCLUDED.scope_kind,
          scope_key = EXCLUDED.scope_key,
          source_system = EXCLUDED.source_system,
          title = EXCLUDED.title,
          language_code = EXCLUDED.language_code,
          status = EXCLUDED.status,
          metadata = EXCLUDED.metadata,
          updated_at = now()
        RETURNING id
      `,
      [
        PUBLIC_CAPABILITY_SCOPE.evidenceThreadKey,
        PUBLIC_CAPABILITY_SCOPE.brandKey,
        PUBLIC_CAPABILITY_SCOPE.packKey,
        'Public capability asset evidence',
        PUBLIC_CAPABILITY_SCOPE.publicationStatus,
        JSON.stringify(threadMetadata),
      ],
    );
    const evidenceThreadId = threadResult.rows[0].id;

    const packResult = await client.query(
      `
        INSERT INTO memory.capability_packs (
          evidence_thread_id,
          pack_key,
          brand_key,
          corpus,
          source_classification,
          publication_status,
          generated_at,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
        ON CONFLICT (pack_key) DO UPDATE SET
          evidence_thread_id = EXCLUDED.evidence_thread_id,
          brand_key = EXCLUDED.brand_key,
          corpus = EXCLUDED.corpus,
          source_classification = EXCLUDED.source_classification,
          publication_status = EXCLUDED.publication_status,
          generated_at = EXCLUDED.generated_at,
          metadata = EXCLUDED.metadata,
          updated_at = now()
        RETURNING id
      `,
      [
        evidenceThreadId,
        PUBLIC_CAPABILITY_SCOPE.packKey,
        PUBLIC_CAPABILITY_SCOPE.brandKey,
        PUBLIC_CAPABILITY_SCOPE.corpus,
        PUBLIC_CAPABILITY_SCOPE.sourceClassification,
        PUBLIC_CAPABILITY_SCOPE.publicationStatus,
        pack.analytics.generated_at,
        JSON.stringify({ source_kind: 'sanitized_public_safe_demo', schema_version: 1 }),
      ],
    );
    const packId = packResult.rows[0].id;

    await client.query('DELETE FROM memory.capability_tasks WHERE pack_id = $1', [packId]);
    await client.query('DELETE FROM memory.capability_assets WHERE pack_id = $1', [packId]);
    await client.query('DELETE FROM memory.capability_analytics_signals WHERE pack_id = $1', [packId]);
    await client.query(
      `DELETE FROM memory.observations
       WHERE thread_id = $1 AND metadata->>'capability_pack_key' = $2`,
      [evidenceThreadId, PUBLIC_CAPABILITY_SCOPE.packKey],
    );
    await client.query(
      `DELETE FROM memory.thread_turns
       WHERE thread_id = $1 AND metadata->>'capability_pack_key' = $2`,
      [evidenceThreadId, PUBLIC_CAPABILITY_SCOPE.packKey],
    );

    const assetIds = new Map();
    const supersededBy = new Map();
    for (const asset of pack.assets) {
      if (asset.supersedes && pack.assets.some((candidate) => candidate.asset_key === asset.supersedes)) {
        if (supersededBy.has(asset.supersedes)) fail(`${asset.supersedes} is superseded by multiple assets.`);
        supersededBy.set(asset.supersedes, asset.asset_key);
      }
    }
    for (const asset of pack.assets) {
      const result = await client.query(
        `
          INSERT INTO memory.capability_assets (
            pack_id,
            asset_key,
            asset_type,
            title,
            summary,
            capability_area,
            problem_solved,
            why_it_worked,
            owner_role,
            consumer_roles,
            visibility,
            review_status,
            version,
            supersedes_asset_key,
            superseded_by_asset_key,
            last_validated_at,
            risk_note,
            used_successfully_in
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::text[], $11, $12, $13,
            $14, $15, $16::date, $17, $18::text[]
          )
          RETURNING id
        `,
        [
          packId,
          asset.asset_key,
          asset.asset_type,
          asset.title,
          asset.summary,
          asset.capability_area,
          asset.problem_solved,
          asset.why_it_worked,
          asset.owner_role,
          asset.consumer_roles,
          asset.visibility,
          asset.review_status,
          asset.version,
          asset.supersedes,
          supersededBy.get(asset.asset_key) || null,
          asset.last_validated_at,
          asset.risk_note,
          asset.used_successfully_in,
        ],
      );
      assetIds.set(asset.asset_key, result.rows[0].id);
    }

    const turns = new Map();
    const observations = new Map();
    for (const turn of pack.sourceTurns) {
      const turnResult = await client.query(
        `
          INSERT INTO memory.thread_turns (
            thread_id,
            source_turn_id,
            actor_role,
            actor_key,
            turn_kind,
            sent_at,
            text_raw,
            text_normalized,
            payload,
            artifact_refs,
            metadata
          )
          VALUES ($1, $2, $3, $4, 'capability_source', $5, $6, $7, '{}'::jsonb, '{}'::jsonb, $8::jsonb)
          RETURNING id
        `,
        [
          evidenceThreadId,
          turn.source_turn_id,
          turn.actor_role,
          `role:${turn.actor_role}`,
          turn.timestamp,
          turn.text,
          turn.text.toLowerCase(),
          JSON.stringify({
            capability_pack_key: PUBLIC_CAPABILITY_SCOPE.packKey,
            context_scope: turn.context_scope,
            source_classification: PUBLIC_CAPABILITY_SCOPE.sourceClassification,
          }),
        ],
      );
      const turnId = turnResult.rows[0].id;
      turns.set(turn.source_turn_id, turnId);

      const observationResult = await client.query(
        `
          INSERT INTO memory.observations (
            observation_key,
            thread_id,
            turn_id,
            observation_kind,
            subject_key,
            actor_key,
            observed_at,
            salience,
            confidence,
            observation_text,
            source_turn_ids,
            source_refs,
            review_status,
            is_active,
            metadata
          )
          VALUES (
            $1, $2, $3, 'capability_source_narrative', $4, $5, $6, 0.9000, 0.9500,
            $7, $8::jsonb, $9::jsonb, 'approved_for_public_demo', true, $10::jsonb
          )
          RETURNING id
        `,
        [
          `obs:${PUBLIC_CAPABILITY_SCOPE.evidenceThreadKey}:${turn.source_turn_id}:capability_source_narrative`,
          evidenceThreadId,
          turnId,
          turn.context_scope,
          `role:${turn.actor_role}`,
          turn.timestamp,
          turn.text,
          JSON.stringify([turn.source_turn_id]),
          JSON.stringify([{ source_turn_id: turn.source_turn_id, actor_role: turn.actor_role }]),
          JSON.stringify({
            capability_pack_key: PUBLIC_CAPABILITY_SCOPE.packKey,
            context_scope: turn.context_scope,
            source_classification: PUBLIC_CAPABILITY_SCOPE.sourceClassification,
            extraction_method: 'provided_public_safe_capability_pack',
          }),
        ],
      );
      observations.set(turn.source_turn_id, observationResult.rows[0].id);
    }

    let evidenceCount = 0;
    for (const [assetKey, sourceTurnIds] of pack.evidenceEdges) {
      for (const sourceTurnId of sourceTurnIds) {
        await client.query(
          `
            INSERT INTO memory.capability_asset_evidence (
              pack_id,
              asset_id,
              observation_id,
              turn_id,
              evidence_role
            )
            VALUES ($1, $2, $3, $4, 'source_narrative')
          `,
          [packId, assetIds.get(assetKey), observations.get(sourceTurnId), turns.get(sourceTurnId)],
        );
        evidenceCount += 1;
      }
    }

    let relationCount = 0;
    for (const asset of pack.assets) {
      for (const linkedKey of asset.linked_evidence_keys) {
        await client.query(
          `
            INSERT INTO memory.capability_asset_relations (
              pack_id,
              source_asset_id,
              target_asset_id,
              relation_kind
            )
            VALUES ($1, $2, $3, 'linked_evidence')
          `,
          [packId, assetIds.get(asset.asset_key), assetIds.get(linkedKey)],
        );
        relationCount += 1;
      }
    }

    let recommendationCount = 0;
    for (const [taskIndex, task] of pack.recommendations.entries()) {
      const taskResult = await client.query(
        `
          INSERT INTO memory.capability_tasks (pack_id, task_key, task_title, reason, sort_order)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING id
        `,
        [packId, task.task_key, task.task_title, task.reason, taskIndex + 1],
      );
      for (const [assetIndex, assetKey] of task.recommended_asset_keys.entries()) {
        await client.query(
          `
            INSERT INTO memory.capability_task_recommendations (
              pack_id,
              task_id,
              asset_id,
              recommendation_rank,
              recommendation_reason
            )
            VALUES ($1, $2, $3, $4, $5)
          `,
          [packId, taskResult.rows[0].id, assetIds.get(assetKey), assetIndex + 1, task.reason],
        );
        recommendationCount += 1;
      }
    }

    for (const [index, signal] of pack.analytics.duplicated_patterns.entries()) {
      await client.query(
        `
          INSERT INTO memory.capability_analytics_signals (
            pack_id, signal_type, signal_key, signal, asset_keys, sort_order
          )
          VALUES ($1, 'duplicated_pattern', $2, $3, $4::text[], $5)
        `,
        [packId, signal.pattern_key, signal.signal, signal.asset_keys, index + 1],
      );
    }
    for (const [index, signal] of pack.analytics.missing_capabilities.entries()) {
      await client.query(
        `
          INSERT INTO memory.capability_analytics_signals (
            pack_id, signal_type, signal_key, title, signal, asset_keys, sort_order
          )
          VALUES ($1, 'missing_capability', $2, $3, $4, ARRAY[]::text[], $5)
        `,
        [packId, signal.gap_key, signal.title, signal.signal, index + 1],
      );
    }

    await client.query('COMMIT');
    return {
      scope: {
        pack_key: PUBLIC_CAPABILITY_SCOPE.packKey,
        evidence_thread_key: PUBLIC_CAPABILITY_SCOPE.evidenceThreadKey,
        brand_key: PUBLIC_CAPABILITY_SCOPE.brandKey,
        corpus: PUBLIC_CAPABILITY_SCOPE.corpus,
        source_classification: PUBLIC_CAPABILITY_SCOPE.sourceClassification,
      },
      imported: {
        assets: pack.assets.length,
        source_turns: pack.sourceTurns.length,
        evidence_edges: evidenceCount,
        asset_relations: relationCount,
        tasks: pack.recommendations.length,
        task_recommendations: recommendationCount,
        duplicated_patterns: pack.analytics.duplicated_patterns.length,
        missing_capabilities: pack.analytics.missing_capabilities.length,
      },
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

const invokedUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedUrl === import.meta.url) {
  importCapabilityPack()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error?.stack || error);
      process.exitCode = 1;
    });
}
