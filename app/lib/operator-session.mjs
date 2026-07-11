import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {
  actorWithOperatorDatabaseContext,
} from './operator-db-context.mjs';

const SHA256 = /^[a-f0-9]{64}$/;
const PRINCIPAL_KEY = /^human:[a-z0-9][a-z0-9_.-]{1,118}$/;
const DEPARTMENT_KEY = /^[a-z][a-z0-9_]{1,79}$/;

function digest(value) {
  return crypto.createHash('sha256').update(value).digest();
}

function timingSafeEqual(left, right) {
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

export function parseCredentialMap(value) {
  if (!exactKeys(value, ['schema_version', 'credentials']) || value.schema_version !== 1) {
    throw new TypeError('Operator credential map must use schema version 1.');
  }
  if (!Array.isArray(value.credentials) || value.credentials.length < 1 || value.credentials.length > 16) {
    throw new TypeError('Operator credential map must contain between 1 and 16 credentials.');
  }
  const tokenHashes = new Set();
  const credentials = value.credentials.map((entry) => {
    if (!exactKeys(entry, ['token_sha256', 'principal_key', 'department_key'])) {
      throw new TypeError('Operator credential fields are invalid.');
    }
    if (!SHA256.test(entry.token_sha256)) throw new TypeError('Operator token hash is invalid.');
    if (!PRINCIPAL_KEY.test(entry.principal_key)) throw new TypeError('Operator principal key is invalid.');
    if (!DEPARTMENT_KEY.test(entry.department_key)) throw new TypeError('Operator department key is invalid.');
    if (tokenHashes.has(entry.token_sha256)) throw new TypeError('Operator token hashes must be unique.');
    tokenHashes.add(entry.token_sha256);
    return Object.freeze({ ...entry, token_digest: Buffer.from(entry.token_sha256, 'hex') });
  });
  return Object.freeze(credentials);
}

export async function loadCredentialMap(filePath) {
  if (typeof filePath !== 'string' || !filePath.startsWith('/')) {
    throw new TypeError('An absolute operator credential-map path is required.');
  }
  const stats = await fs.stat(filePath);
  const mode = stats.mode & 0o777;
  const processGroups = typeof process.getgroups === 'function' ? process.getgroups() : [];
  const groupReadAllowed = (mode & 0o040) === 0 || processGroups.includes(stats.gid);
  if (!stats.isFile() || (mode & 0o037) !== 0 || !groupReadAllowed) {
    throw new Error('operator_credential_map_permissions_invalid');
  }
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    throw new Error('operator_credential_map_invalid');
  }
  return parseCredentialMap(parsed);
}

export function createOperatorSessionManager({
  credentials,
  ttlMs = 30 * 60_000,
  maxSessions = 16,
  now = () => Date.now(),
  randomBytes = crypto.randomBytes,
} = {}) {
  if (!Array.isArray(credentials) || !credentials.length) {
    throw new TypeError('Parsed operator credentials are required.');
  }
  if (!Number.isInteger(ttlMs) || ttlMs < 60_000 || ttlMs > 8 * 60 * 60_000) {
    throw new TypeError('Session TTL is out of range.');
  }
  if (!Number.isInteger(maxSessions) || maxSessions < 1 || maxSessions > 64) {
    throw new TypeError('Session limit is out of range.');
  }
  const sessions = new Map();

  function prune() {
    const current = now();
    for (const [key, session] of sessions) {
      if (session.expiresAt <= current) sessions.delete(key);
    }
    while (sessions.size >= maxSessions) sessions.delete(sessions.keys().next().value);
  }

  function credentialForToken(token) {
    if (typeof token !== 'string' || token.length < 32 || token.length > 128 || !/^[A-Za-z0-9_-]+$/.test(token)) {
      return null;
    }
    const candidate = digest(token);
    let matched = null;
    for (const credential of credentials) {
      if (timingSafeEqual(candidate, credential.token_digest)) matched = credential;
    }
    return matched;
  }

  return Object.freeze({
    authenticate(token) {
      return credentialForToken(token);
    },

    issue(actor, { databaseContextTokenSha256 = null } = {}) {
      prune();
      const sessionToken = randomBytes(32).toString('base64url');
      const csrfToken = randomBytes(32).toString('base64url');
      const createdAt = now();
      const expiresAt = createdAt + ttlMs;
      const sessionActor = databaseContextTokenSha256
        ? actorWithOperatorDatabaseContext(actor, databaseContextTokenSha256)
        : actor;
      sessions.set(digest(sessionToken).toString('hex'), {
        actor: sessionActor,
        csrfDigest: digest(csrfToken),
        createdAt,
        expiresAt,
      });
      return {
        sessionToken,
        csrfToken,
        session: {
          actor,
          created_at: new Date(createdAt).toISOString(),
          expires_at: new Date(expiresAt).toISOString(),
        },
      };
    },

    resolve(sessionToken) {
      if (typeof sessionToken !== 'string' || sessionToken.length !== 43) return null;
      const key = digest(sessionToken).toString('hex');
      const session = sessions.get(key);
      if (!session) return null;
      if (session.expiresAt <= now()) {
        sessions.delete(key);
        return null;
      }
      return session;
    },

    verifyCsrf(session, value) {
      if (!session || typeof value !== 'string' || value.length !== 43) return false;
      return timingSafeEqual(digest(value), session.csrfDigest);
    },

    rotateCsrf(session) {
      if (!session) return null;
      const csrfToken = randomBytes(32).toString('base64url');
      session.csrfDigest = digest(csrfToken);
      return csrfToken;
    },

    destroy(sessionToken) {
      if (typeof sessionToken !== 'string') return false;
      return sessions.delete(digest(sessionToken).toString('hex'));
    },

    size() {
      prune();
      return sessions.size;
    },
  });
}
