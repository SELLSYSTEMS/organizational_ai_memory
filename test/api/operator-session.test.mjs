import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {
  createOperatorSessionManager,
  parseCredentialMap,
} from '../../app/lib/operator-session.mjs';

const TOKEN = 'A'.repeat(43);
const TOKEN_HASH = crypto.createHash('sha256').update(TOKEN).digest('hex');

function credentials() {
  return parseCredentialMap({
    schema_version: 1,
    credentials: [{
      token_sha256: TOKEN_HASH,
      principal_key: 'human:architect',
      department_key: 'website_delivery',
    }],
  });
}

test('credential map is exact, hash-only, and supports independent operator identities', () => {
  const parsed = credentials();
  assert.equal(parsed[0].principal_key, 'human:architect');
  assert.equal('token' in parsed[0], false);
  assert.throws(() => parseCredentialMap({
    schema_version: 1,
    credentials: [{
      token_sha256: TOKEN_HASH,
      principal_key: 'human:architect',
      department_key: 'website_delivery',
      role: 'architect',
    }],
  }), /fields/);
});

test('bounded sessions authenticate by hash and enforce CSRF plus expiry', () => {
  let current = Date.parse('2026-07-11T05:00:00Z');
  let byte = 0;
  const manager = createOperatorSessionManager({
    credentials: credentials(),
    ttlMs: 60_000,
    now: () => current,
    randomBytes(size) {
      byte += 1;
      return Buffer.alloc(size, byte);
    },
  });
  const mapping = manager.authenticate(TOKEN);
  assert.equal(mapping.principal_key, 'human:architect');
  assert.equal(manager.authenticate('B'.repeat(43)), null);

  const issued = manager.issue(
    { principal_id: 'architect-id' },
    { databaseContextTokenSha256: TOKEN_HASH },
  );
  const session = manager.resolve(issued.sessionToken);
  assert.equal(session.actor.principal_id, 'architect-id');
  assert.doesNotMatch(JSON.stringify(issued.session), new RegExp(TOKEN_HASH));
  assert.doesNotMatch(JSON.stringify(session.actor), new RegExp(TOKEN_HASH));
  assert.equal(manager.verifyCsrf(session, issued.csrfToken), true);
  assert.equal(manager.verifyCsrf(session, 'C'.repeat(43)), false);

  current += 60_001;
  assert.equal(manager.resolve(issued.sessionToken), null);
  assert.equal(manager.size(), 0);
});
