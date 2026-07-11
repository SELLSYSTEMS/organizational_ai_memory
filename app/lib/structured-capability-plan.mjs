const ASSET_KEY_PATTERN = /^(?:prompt|workflow|agent|decision|practice):[a-z0-9][a-z0-9_]*$/;
const SOURCE_TURN_PATTERN = /^st-[a-z0-9][a-z0-9-]*$/;
const ASSET_KEY_TOKEN_PATTERN = /\b(?:prompt|workflow|agent|decision|practice):[a-z0-9][a-z0-9_]*/gi;
const SOURCE_TURN_TOKEN_PATTERN = /\bst-[a-z0-9][a-z0-9-]*/gi;
const FALLBACK_REASONS = new Set([
  'busy',
  'budget_exhausted',
  'disabled',
  'invalid_response',
  'timeout',
  'unavailable',
]);

function compact(value, maxCharacters) {
  if (typeof value !== 'string') throw new Error('invalid_model_output');
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized || [...normalized].length > maxCharacters) throw new Error('invalid_model_output');
  return normalized;
}

function stringList(value, {
  maxItems,
  maxCharacters,
  pattern = null,
  allowEmpty = true,
} = {}) {
  if (!Array.isArray(value) || value.length > maxItems || (!allowEmpty && value.length === 0)) {
    throw new Error('invalid_model_output');
  }
  const items = value.map((item) => {
    const normalized = compact(item, maxCharacters);
    if (pattern && !pattern.test(normalized)) throw new Error('invalid_model_output');
    return normalized;
  });
  if (new Set(items).size !== items.length) throw new Error('invalid_model_output');
  return items;
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_model_output');
  const keys = Object.keys(value).sort();
  if (keys.join(',') !== [...expected].sort().join(',')) throw new Error('invalid_model_output');
}

function assertSupportedCitationTokens(value, allowedAssetKeys, allowedSourceTurnIds) {
  for (const assetKey of value.match(ASSET_KEY_TOKEN_PATTERN) || []) {
    if (!allowedAssetKeys.has(assetKey.toLowerCase())) throw new Error('invalid_model_output');
  }
  for (const sourceTurnId of value.match(SOURCE_TURN_TOKEN_PATTERN) || []) {
    if (!allowedSourceTurnIds.has(sourceTurnId.toLowerCase())) throw new Error('invalid_model_output');
  }
}

export function recommendationCitationIndex(recommendation) {
  const assets = Array.isArray(recommendation?.assets) ? recommendation.assets.slice(0, 9) : [];
  const sourceTurnsByAsset = new Map();
  for (const asset of assets) {
    const assetKey = typeof asset?.asset_key === 'string' ? asset.asset_key : '';
    if (!ASSET_KEY_PATTERN.test(assetKey)) continue;
    const sourceTurnIds = Array.isArray(asset?.evidence?.source_turns)
      ? asset.evidence.source_turns
          .map((turn) => turn?.source_turn_id)
          .filter((sourceTurnId) => typeof sourceTurnId === 'string' && SOURCE_TURN_PATTERN.test(sourceTurnId))
      : [];
    sourceTurnsByAsset.set(assetKey, new Set(sourceTurnIds));
  }
  return sourceTurnsByAsset;
}

export function validateStructuredPlan(payload, recommendation) {
  exactKeys(payload, ['summary', 'steps', 'missing_context', 'limitations']);
  if (!Array.isArray(payload.steps) || payload.steps.length < 1 || payload.steps.length > 6) {
    throw new Error('invalid_model_output');
  }
  const citations = recommendationCitationIndex(recommendation);
  const selectedAssetKeys = new Set(citations.keys());
  if (selectedAssetKeys.size === 0) throw new Error('invalid_model_output');
  const selectedSourceTurnIds = new Set(
    [...citations.values()].flatMap((sourceTurnIds) => [...sourceTurnIds]),
  );
  const summary = compact(payload.summary, 400);
  assertSupportedCitationTokens(summary, selectedAssetKeys, selectedSourceTurnIds);
  const usedAssetKeys = new Set();
  const steps = payload.steps.map((step) => {
    exactKeys(step, ['title', 'action', 'asset_keys', 'source_turn_ids', 'requires_human_review']);
    if (typeof step.requires_human_review !== 'boolean') throw new Error('invalid_model_output');
    const assetKeys = stringList(step.asset_keys, {
      maxItems: 9,
      maxCharacters: 160,
      pattern: ASSET_KEY_PATTERN,
      allowEmpty: false,
    });
    const sourceTurnIds = stringList(step.source_turn_ids, {
      maxItems: 12,
      maxCharacters: 80,
      pattern: SOURCE_TURN_PATTERN,
    });
    for (const assetKey of assetKeys) {
      if (!selectedAssetKeys.has(assetKey)) throw new Error('invalid_model_output');
      usedAssetKeys.add(assetKey);
    }
    const allowedSourceTurns = new Set(assetKeys.flatMap((assetKey) => [...citations.get(assetKey)]));
    if (allowedSourceTurns.size > 0 && sourceTurnIds.length === 0) throw new Error('invalid_model_output');
    for (const sourceTurnId of sourceTurnIds) {
      if (!allowedSourceTurns.has(sourceTurnId)) throw new Error('invalid_model_output');
    }
    const title = compact(step.title, 120);
    const action = compact(step.action, 400);
    assertSupportedCitationTokens(title, new Set(assetKeys), allowedSourceTurns);
    assertSupportedCitationTokens(action, new Set(assetKeys), allowedSourceTurns);
    return {
      title,
      action,
      asset_keys: assetKeys,
      source_turn_ids: sourceTurnIds,
      requires_human_review: step.requires_human_review,
    };
  });
  if ([...selectedAssetKeys].some((assetKey) => !usedAssetKeys.has(assetKey))) {
    throw new Error('invalid_model_output');
  }
  const missingContext = stringList(payload.missing_context, { maxItems: 4, maxCharacters: 400 });
  const limitations = stringList(payload.limitations, { maxItems: 4, maxCharacters: 400 });
  for (const value of [...missingContext, ...limitations]) {
    assertSupportedCitationTokens(value, selectedAssetKeys, selectedSourceTurnIds);
  }
  return {
    summary,
    steps,
    missing_context: missingContext,
    limitations,
  };
}

export function formatStructuredPlan(plan) {
  const lines = [plan.summary];
  plan.steps.forEach((step, index) => {
    const citations = [
      step.asset_keys.length ? `assets: ${step.asset_keys.join(', ')}` : '',
      step.source_turn_ids.length ? `sources: ${step.source_turn_ids.join(', ')}` : '',
    ].filter(Boolean).join('; ');
    lines.push(`${index + 1}. ${step.title}: ${step.action}${citations ? ` [${citations}]` : ''}`);
  });
  if (plan.missing_context.length) lines.push(`Missing context: ${plan.missing_context.join(' ')}`);
  if (plan.limitations.length) lines.push(`Limitations: ${plan.limitations.join(' ')}`);
  return [...lines.join('\n')].slice(0, 1_800).join('').trim();
}

export function buildDeterministicFallbackPlan(selection, reason = 'unavailable') {
  const fallbackReason = FALLBACK_REASONS.has(reason) ? reason : 'unavailable';
  const assets = Array.isArray(selection?.recommendations)
    ? selection.recommendations
        .filter((asset) => ASSET_KEY_PATTERN.test(asset?.asset_key || ''))
        .slice(0, 6)
    : [];
  const steps = assets.map((asset) => {
    const sourceTurnId = asset?.evidence?.source_turns?.[0]?.source_turn_id;
    const action = [asset.summary, asset.why_it_worked ? `Why it worked: ${asset.why_it_worked}` : '']
      .filter(Boolean)
      .join(' ');
    return {
      title: `Use ${asset.title || asset.asset_key}`.slice(0, 120),
      action: (action || 'Inspect the stored capability body and adapt it to the task.').slice(0, 400),
      asset_keys: [asset.asset_key],
      source_turn_ids: sourceTurnId ? [sourceTurnId] : [],
      requires_human_review: true,
    };
  });
  const plan = {
    summary: `Start from the ${assets.length} authoritative stored capability asset${assets.length === 1 ? '' : 's'} selected for ${selection?.task?.task_title || 'this task'}.`,
    steps,
    missing_context: [],
    limitations: [`Spark adaptation was not used (${fallbackReason}); this deterministic plan does not claim task completion.`],
  };
  return {
    ...plan,
    explanation: formatStructuredPlan(plan),
    fallback_reason: fallbackReason,
  };
}
