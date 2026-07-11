import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(scriptDir, '..', '..');

let platformEnvLoaded = false;

function parseEnvText(text) {
  const parsed = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const normalized = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const match = normalized.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    parsed[key] = value;
  }

  return parsed;
}

export async function ensurePlatformEnvLoaded() {
  if (platformEnvLoaded) return;
  platformEnvLoaded = true;

  const envPath = process.env.PLATFORM_ENV_PATH || path.join(process.env.APP_ETC_ROOT || '/etc/tg_ops', 'platform.env');
  const content = await fs.readFile(envPath, 'utf8').catch(() => null);
  if (!content) return;

  const parsed = parseEnvText(content);
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function compactText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function normalizeText(value) {
  return compactText(value).toLowerCase();
}

export function hashString(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function stableUuidFromKey(key) {
  const hex = hashString(key);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `a${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

export function uniqueStrings(values) {
  return [...new Set((values || []).map((value) => String(value)).filter(Boolean))];
}

export function parseJsonArgFile(filePath) {
  return fs.readFile(filePath, 'utf8').then((text) => JSON.parse(text));
}

export async function writeJson(outputPath, payload) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(payload, null, 2));
}

export async function loadPg() {
  await ensurePlatformEnvLoaded();
  try {
    const mod = await import('pg');
    return mod.default ?? mod;
  } catch (err) {
    throw new Error('The `pg` package is required. Run `npm install` in the repo root before using the memory scripts.', { cause: err });
  }
}

export async function createPgClient() {
  const { Client } = await loadPg();
  const client = new Client(
    process.env.DATABASE_URL
      ? { connectionString: process.env.DATABASE_URL }
      : {
          host: process.env.PGHOST || '127.0.0.1',
          port: parseInt(process.env.PGPORT || '5432', 10),
          database: process.env.PGDATABASE || 'tg_ops',
          user: process.env.PGUSER || 'tg_ops',
          password: process.env.PGPASSWORD || '',
        },
  );
  await client.connect();
  return client;
}

export function qdrantHeaders() {
  const headers = { 'content-type': 'application/json' };
  if (process.env.QDRANT_API_KEY) {
    headers['api-key'] = process.env.QDRANT_API_KEY;
  }
  return headers;
}

export function qdrantBaseUrl() {
  return (process.env.QDRANT_URL || 'http://127.0.0.1:6333').replace(/\/+$/, '');
}

export function embedBaseUrl() {
  return process.env.EMBED_BASE_URL || 'http://127.0.0.1:8080';
}

export async function embedText(inputText) {
  await ensurePlatformEnvLoaded();
  const endpoint = process.env.TEI_EMBED_ENDPOINT || '/embed';
  const url = new URL(endpoint, embedBaseUrl()).toString();

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      inputs: inputText,
      truncate: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Embedding request failed: ${response.status} ${response.statusText}\n${await response.text()}`);
  }

  const payload = await response.json();
  if (Array.isArray(payload) && payload.length > 0 && Array.isArray(payload[0])) {
    return payload[0];
  }
  if (Array.isArray(payload)) {
    return payload;
  }

  throw new Error('Unexpected embedding payload shape from embedding service.');
}

async function fetchCollectionInfo(collection) {
  const response = await fetch(`${qdrantBaseUrl()}/collections/${encodeURIComponent(collection)}`, {
    method: 'GET',
    headers: qdrantHeaders(),
  });

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Qdrant collection lookup failed: ${response.status} ${response.statusText}\n${await response.text()}`);
  }

  return response.json();
}

function extractVectorSize(collectionInfo, vectorName) {
  const vectors = collectionInfo?.result?.config?.params?.vectors;
  if (!vectors) return null;

  if (typeof vectors.size === 'number') {
    return vectors.size;
  }

  if (vectors[vectorName] && typeof vectors[vectorName].size === 'number') {
    return vectors[vectorName].size;
  }

  return null;
}

export async function ensureQdrantCollection(collection, vectorName, vectorSize) {
  await ensurePlatformEnvLoaded();
  const existing = await fetchCollectionInfo(collection);
  if (existing) {
    const existingSize = extractVectorSize(existing, vectorName);
    if (existingSize !== null && existingSize !== vectorSize) {
      throw new Error(`Qdrant collection ${collection} already exists with vector size ${existingSize}, expected ${vectorSize}.`);
    }
    return { created: false, details: existing };
  }

  const response = await fetch(`${qdrantBaseUrl()}/collections/${encodeURIComponent(collection)}`, {
    method: 'PUT',
    headers: qdrantHeaders(),
    body: JSON.stringify({
      vectors: {
        [vectorName]: {
          size: vectorSize,
          distance: 'Cosine',
        },
      },
      on_disk_payload: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Qdrant collection create failed: ${response.status} ${response.statusText}\n${await response.text()}`);
  }

  return { created: true, details: await response.json() };
}

export async function upsertQdrantPoints(collection, vectorName, points) {
  await ensurePlatformEnvLoaded();
  const response = await fetch(`${qdrantBaseUrl()}/collections/${encodeURIComponent(collection)}/points?wait=true`, {
    method: 'PUT',
    headers: qdrantHeaders(),
    body: JSON.stringify({
      points: points.map((point) => ({
        id: point.id,
        vector: {
          [vectorName]: point.vector,
        },
        payload: point.payload,
      })),
    }),
  });

  if (!response.ok) {
    throw new Error(`Qdrant upsert failed: ${response.status} ${response.statusText}\n${await response.text()}`);
  }

  return response.json();
}

export async function searchQdrant(collection, vectorName, vector, filter, limit) {
  await ensurePlatformEnvLoaded();
  const response = await fetch(`${qdrantBaseUrl()}/collections/${encodeURIComponent(collection)}/points/search`, {
    method: 'POST',
    headers: qdrantHeaders(),
    body: JSON.stringify({
      vector: {
        name: vectorName,
        vector,
      },
      limit,
      with_payload: true,
      filter,
    }),
  });

  if (!response.ok) {
    throw new Error(`Qdrant search failed: ${response.status} ${response.statusText}\n${await response.text()}`);
  }

  return response.json();
}
