import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EMPLOYEE_DATABASE_CONTEXT,
} from '../../app/lib/employee-db-context.mjs';
import { createEmployeeSessionManager } from '../../app/lib/employee-session.mjs';

const TOKEN_HASH = 'b'.repeat(64);

test('employee sessions expose no credential hash and enforce CSRF, expiry, and deletion', () => {
  let current = Date.parse('2026-07-11T06:00:00Z');
  let fill = 0;
  const manager = createEmployeeSessionManager({
    ttlMs: 60_000,
    now: () => current,
    randomBytes(size) {
      fill += 1;
      return Buffer.alloc(size, fill);
    },
  });
  const actor = { principal_id: 'human-id', agent_id: 'agent-id' };
  const issued = manager.issue(actor, { databaseContextTokenSha256: TOKEN_HASH });
  const session = manager.resolve(issued.sessionToken);

  assert.equal(session.actor[EMPLOYEE_DATABASE_CONTEXT], TOKEN_HASH);
  assert.doesNotMatch(JSON.stringify(issued), new RegExp(TOKEN_HASH));
  assert.doesNotMatch(JSON.stringify(session.actor), new RegExp(TOKEN_HASH));
  assert.equal(manager.verifyCsrf(session, issued.csrfToken), true);
  assert.equal(manager.verifyCsrf(session, 'C'.repeat(43)), false);
  const inspected = manager.csrfToken(issued.sessionToken);
  assert.equal(inspected, issued.csrfToken);
  assert.equal(manager.verifyCsrf(session, issued.csrfToken), true);

  assert.equal(manager.destroy(issued.sessionToken), true);
  assert.equal(manager.resolve(issued.sessionToken), null);

  const second = manager.issue(actor, { databaseContextTokenSha256: TOKEN_HASH });
  current += 60_001;
  assert.equal(manager.resolve(second.sessionToken), null);
  assert.equal(manager.size(), 0);
});

test('employee session configuration and context hash fail closed', () => {
  assert.throws(() => createEmployeeSessionManager({ ttlMs: 1 }), /TTL/);
  assert.throws(
    () => createEmployeeSessionManager({ maxSessions: 2, maxSessionsPerPrincipal: 3 }),
    /Per-principal/,
  );
  const manager = createEmployeeSessionManager();
  assert.throws(() => manager.issue({}, { databaseContextTokenSha256: 'raw-token' }), /database context/);
});

test('one principal cannot evict other principals from the bounded session store', () => {
  let fill = 0;
  const manager = createEmployeeSessionManager({
    maxSessions: 4,
    maxSessionsPerPrincipal: 2,
    randomBytes(size) {
      fill += 1;
      return Buffer.alloc(size, fill);
    },
  });
  const other = manager.issue(
    { principal_id: 'human:other' },
    { databaseContextTokenSha256: TOKEN_HASH },
  );
  const first = manager.issue(
    { principal_id: 'human:one' },
    { databaseContextTokenSha256: TOKEN_HASH },
  );
  manager.issue({ principal_id: 'human:one' }, { databaseContextTokenSha256: TOKEN_HASH });
  manager.issue({ principal_id: 'human:one' }, { databaseContextTokenSha256: TOKEN_HASH });
  assert.equal(manager.resolve(first.sessionToken), null);
  assert.notEqual(manager.resolve(other.sessionToken), null);
  assert.equal(manager.size(), 3);
});
