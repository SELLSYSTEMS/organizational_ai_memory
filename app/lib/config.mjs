export const SERVICE_NAME = 'organizational-ai-memory';

export const PUBLIC_SCOPE = Object.freeze({
  brandKey: 'sell_systems_hackathon_demo',
  threadKey: 'oam_public_demo_v1',
  corpus: 'public_demo',
  visibility: 'public_safe',
  status: 'active',
});

export const PUBLIC_CAPABILITY_SCOPE = Object.freeze({
  packKey: 'aihackathon_public_safe_asset_pack_2026_07_10',
  evidenceThreadKey: 'oam_public_capability_assets_v1',
  brandKey: 'sell_systems_hackathon_demo',
  corpus: 'public_demo',
  sourceClassification: 'public_safe',
  publicationStatus: 'active',
});

export const HTTP_LIMITS = Object.freeze({
  bodyBytes: 4_096,
  queryCharacters: 500,
  taskKeyCharacters: 80,
  assistCharacters: 500,
  publicReadsPerMinute: 120,
  publicQueriesPerMinute: 30,
  publicGenerationsPerMinute: 6,
});

function boundedInteger(value, fallback, { min, max }) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export function readServerConfig(env = process.env) {
  return {
    host: env.OAM_HOST || '127.0.0.1',
    port: boundedInteger(env.OAM_PORT, 3000, { min: 1, max: 65_535 }),
    bodyBytes: boundedInteger(env.OAM_MAX_BODY_BYTES, HTTP_LIMITS.bodyBytes, {
      min: 512,
      max: 65_536,
    }),
    queryCharacters: boundedInteger(env.OAM_MAX_QUERY_CHARACTERS, HTTP_LIMITS.queryCharacters, {
      min: 32,
      max: 2_000,
    }),
    taskKeyCharacters: boundedInteger(
      env.OAM_MAX_TASK_KEY_CHARACTERS,
      HTTP_LIMITS.taskKeyCharacters,
      { min: 16, max: 128 },
    ),
    assistCharacters: boundedInteger(
      env.OAM_MAX_ASSIST_CHARACTERS,
      HTTP_LIMITS.assistCharacters,
      { min: 32, max: 1_000 },
    ),
    publicReadsPerMinute: boundedInteger(
      env.OAM_PUBLIC_READS_PER_MINUTE,
      HTTP_LIMITS.publicReadsPerMinute,
      { min: 1, max: 10_000 },
    ),
    publicQueriesPerMinute: boundedInteger(
      env.OAM_PUBLIC_QUERIES_PER_MINUTE,
      HTTP_LIMITS.publicQueriesPerMinute,
      { min: 1, max: 1_000 },
    ),
    publicGenerationsPerMinute: boundedInteger(
      env.OAM_PUBLIC_GENERATIONS_PER_MINUTE,
      HTTP_LIMITS.publicGenerationsPerMinute,
      { min: 1, max: 60 },
    ),
    codexAssistEnabled: /^(?:1|true|yes)$/i.test(env.OAM_CODEX_ASSIST_ENABLED || ''),
    codexSocketPath: env.OAM_CODEX_SOCKET_PATH
      || '/run/organizational-ai-memory-codex/assist.sock',
  };
}

export function publicScopeSqlParameters() {
  return [
    PUBLIC_SCOPE.brandKey,
    PUBLIC_SCOPE.threadKey,
    PUBLIC_SCOPE.corpus,
    PUBLIC_SCOPE.visibility,
    PUBLIC_SCOPE.status,
  ];
}

export function publicScopeResponse() {
  return {
    brand_key: PUBLIC_SCOPE.brandKey,
    thread_key: PUBLIC_SCOPE.threadKey,
    corpus: PUBLIC_SCOPE.corpus,
    visibility: PUBLIC_SCOPE.visibility,
  };
}

export function publicCapabilityScopeSqlParameters() {
  return [
    PUBLIC_CAPABILITY_SCOPE.packKey,
    PUBLIC_CAPABILITY_SCOPE.brandKey,
    PUBLIC_CAPABILITY_SCOPE.corpus,
    PUBLIC_CAPABILITY_SCOPE.sourceClassification,
    PUBLIC_CAPABILITY_SCOPE.publicationStatus,
    PUBLIC_CAPABILITY_SCOPE.evidenceThreadKey,
  ];
}

export function publicCapabilityScopeResponse() {
  return {
    pack_key: PUBLIC_CAPABILITY_SCOPE.packKey,
    brand_key: PUBLIC_CAPABILITY_SCOPE.brandKey,
    corpus: PUBLIC_CAPABILITY_SCOPE.corpus,
    source_classification: PUBLIC_CAPABILITY_SCOPE.sourceClassification,
  };
}
