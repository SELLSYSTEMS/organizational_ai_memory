import { CODEX_SPARK_MODEL } from './codex-spark-runner.mjs';

function fallbackInteraction(selection, reason = 'unavailable') {
  return {
    status: 'fallback',
    authoritative: false,
    model: CODEX_SPARK_MODEL,
    explanation: null,
    selected_asset_keys: selection.recommendations
      .map((asset) => asset.asset_key)
      .filter(Boolean),
    fallback_reason: reason,
  };
}

export function createCapabilityAssistService({ capabilityService, codexClient }) {
  if (!capabilityService || typeof capabilityService.recommend !== 'function') {
    throw new TypeError('Capability memory service is required.');
  }
  if (!codexClient || typeof codexClient.explain !== 'function') {
    throw new TypeError('Codex assist client is required.');
  }

  return {
    async assist(taskKey, request) {
      const selection = await capabilityService.recommend(taskKey);
      const recommendation = {
        recommendation_reason: selection.task.reason,
        assets: selection.recommendations,
      };
      let interaction;
      try {
        interaction = await codexClient.explain({
          taskKey,
          request,
          recommendation,
        });
      } catch {
        interaction = fallbackInteraction(selection);
      }

      return {
        ...selection,
        interaction,
      };
    },
  };
}
