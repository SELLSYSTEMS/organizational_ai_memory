import crypto from 'node:crypto';
import { actorWithEmployeeDatabaseContext } from './employee-db-context.mjs';

const SHA256 = /^[a-f0-9]{64}$/;

function digest(value) {
  return crypto.createHash('sha256').update(value).digest();
}

function timingSafeEqual(left, right) {
  return Buffer.isBuffer(left)
    && Buffer.isBuffer(right)
    && left.length === right.length
    && crypto.timingSafeEqual(left, right);
}

export function createEmployeeSessionManager({
  ttlMs = 30 * 60_000,
  maxSessions = 4_096,
  maxSessionsPerPrincipal = 8,
  now = () => Date.now(),
  randomBytes = crypto.randomBytes,
} = {}) {
  if (!Number.isInteger(ttlMs) || ttlMs < 60_000 || ttlMs > 8 * 60 * 60_000) {
    throw new TypeError('Session TTL is out of range.');
  }
  if (!Number.isInteger(maxSessions) || maxSessions < 1 || maxSessions > 20_000) {
    throw new TypeError('Session limit is out of range.');
  }
  if (!Number.isInteger(maxSessionsPerPrincipal)
      || maxSessionsPerPrincipal < 1
      || maxSessionsPerPrincipal > maxSessions) {
    throw new TypeError('Per-principal session limit is out of range.');
  }
  const csrfSecret = randomBytes(32);
  if (!Buffer.isBuffer(csrfSecret) || csrfSecret.length !== 32) {
    throw new TypeError('Session entropy source is invalid.');
  }
  const sessions = new Map();

  function csrfForSession(sessionToken) {
    return crypto.createHmac('sha256', csrfSecret).update(sessionToken).digest('base64url');
  }

  function pruneExpired() {
    const current = now();
    for (const [key, session] of sessions) {
      if (session.expiresAt <= current) sessions.delete(key);
    }
  }

  function ensureGlobalCapacity() {
    while (sessions.size >= maxSessions) sessions.delete(sessions.keys().next().value);
  }

  return Object.freeze({
    issue(actor, { databaseContextTokenSha256 } = {}) {
      if (!actor || typeof actor !== 'object' || typeof actor.principal_id !== 'string'
          || !actor.principal_id || !SHA256.test(databaseContextTokenSha256 || '')) {
        throw new TypeError('An employee actor and database context are required.');
      }
      pruneExpired();
      const principalSessions = [];
      for (const [key, session] of sessions) {
        if (session.actor.principal_id === actor.principal_id) principalSessions.push(key);
      }
      while (principalSessions.length >= maxSessionsPerPrincipal) {
        sessions.delete(principalSessions.shift());
      }
      ensureGlobalCapacity();
      const sessionToken = randomBytes(32).toString('base64url');
      const csrfToken = csrfForSession(sessionToken);
      const createdAt = now();
      const expiresAt = createdAt + ttlMs;
      sessions.set(digest(sessionToken).toString('hex'), {
        actor: actorWithEmployeeDatabaseContext(actor, databaseContextTokenSha256),
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

    csrfToken(sessionToken) {
      const session = this.resolve(sessionToken);
      if (!session) return null;
      const csrfToken = csrfForSession(sessionToken);
      return timingSafeEqual(digest(csrfToken), session.csrfDigest) ? csrfToken : null;
    },

    destroy(sessionToken) {
      if (typeof sessionToken !== 'string') return false;
      return sessions.delete(digest(sessionToken).toString('hex'));
    },

    size() {
      pruneExpired();
      return sessions.size;
    },
  });
}
