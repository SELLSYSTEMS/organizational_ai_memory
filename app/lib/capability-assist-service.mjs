import { CODEX_SPARK_MODEL } from './codex-spark-runner.mjs';
import {
  buildDeterministicFallbackPlan,
  formatStructuredPlan,
  validateStructuredPlan,
} from './structured-capability-plan.mjs';

function fallbackInteraction(selection, reason = 'unavailable') {
  const fallback = buildDeterministicFallbackPlan(selection, reason);
  return {
    status: 'fallback',
    authoritative: false,
    model: CODEX_SPARK_MODEL,
    plan: {
      summary: fallback.summary,
      steps: fallback.steps,
      missing_context: fallback.missing_context,
      limitations: fallback.limitations,
    },
    explanation: fallback.explanation,
    selected_asset_keys: selection.recommendations
      .map((asset) => asset.asset_key)
      .filter(Boolean),
    fallback_reason: fallback.fallback_reason,
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
        if (interaction?.status === 'generated') {
          if (interaction.model !== CODEX_SPARK_MODEL) {
            interaction = fallbackInteraction(selection, 'invalid_response');
          } else {
            try {
              const plan = validateStructuredPlan(interaction.plan, recommendation);
              interaction = {
                status: 'generated',
                authoritative: false,
                model: CODEX_SPARK_MODEL,
                plan,
                explanation: formatStructuredPlan(plan),
                selected_asset_keys: selection.recommendations.map((asset) => asset.asset_key),
                fallback_reason: null,
              };
            } catch {
              interaction = fallbackInteraction(selection, 'invalid_response');
            }
          }
        } else {
          interaction = fallbackInteraction(selection, interaction?.fallback_reason || 'unavailable');
        }
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
