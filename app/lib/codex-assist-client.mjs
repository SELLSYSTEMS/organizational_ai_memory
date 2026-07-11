import http from 'node:http';
import { CODEX_SPARK_MODEL } from './codex-spark-runner.mjs';
import { formatStructuredPlan, validateStructuredPlan } from './structured-capability-plan.mjs';

const DEFAULT_SOCKET_PATH = '/run/organizational-ai-memory-codex/assist.sock';
const MAX_RESPONSE_BYTES = 16_384;

function fallback(selectedAssetKeys, reason) {
  return {
    status: 'fallback',
    authoritative: false,
    model: CODEX_SPARK_MODEL,
    plan: null,
    explanation: null,
    selected_asset_keys: selectedAssetKeys,
    fallback_reason: reason,
  };
}

function selectedAssetKeys(recommendation) {
  return Array.isArray(recommendation?.assets)
    ? recommendation.assets.map((asset) => asset?.asset_key).filter(Boolean).slice(0, 9)
    : [];
}

export function createCodexAssistClient({
  enabled = false,
  socketPath = DEFAULT_SOCKET_PATH,
  timeoutMs = 8_000,
} = {}) {
  return {
    async explain({ taskKey, request, recommendation }) {
      const assetKeys = selectedAssetKeys(recommendation);
      if (!enabled) return fallback(assetKeys, 'disabled');

      const body = JSON.stringify({
        task_key: taskKey,
        request,
        recommendation,
      });

      try {
        const result = await new Promise((resolve, reject) => {
          const req = http.request({
            socketPath,
            path: '/v1/explain',
            method: 'POST',
            headers: {
              'content-length': Buffer.byteLength(body),
              'content-type': 'application/json',
            },
            timeout: timeoutMs,
          });
          const chunks = [];
          let bytes = 0;
          req.on('response', (res) => {
            res.on('data', (chunk) => {
              bytes += chunk.length;
              if (bytes > MAX_RESPONSE_BYTES) {
                req.destroy(new Error('oversize_response'));
                return;
              }
              chunks.push(chunk);
            });
            res.on('end', () => {
              if (res.statusCode !== 200) {
                reject(new Error('sidecar_unavailable'));
                return;
              }
              try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
              } catch {
                reject(new Error('invalid_response'));
              }
            });
          });
          req.once('timeout', () => req.destroy(new Error('sidecar_timeout')));
          req.once('error', reject);
          req.end(body);
        });

        if (result?.status !== 'generated' || result?.model !== CODEX_SPARK_MODEL) {
          return fallback(assetKeys, 'invalid_response');
        }
        let plan;
        try {
          plan = validateStructuredPlan(result.plan, recommendation);
        } catch {
          return fallback(assetKeys, 'invalid_response');
        }

        return {
          status: 'generated',
          authoritative: false,
          model: CODEX_SPARK_MODEL,
          plan,
          explanation: formatStructuredPlan(plan),
          selected_asset_keys: assetKeys,
          fallback_reason: null,
        };
      } catch {
        return fallback(assetKeys, 'unavailable');
      }
    },
  };
}
