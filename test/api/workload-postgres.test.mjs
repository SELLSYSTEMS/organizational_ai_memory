import assert from 'node:assert/strict';
import test from 'node:test';
import { assertLeastPrivilegeWorkload } from '../../app/lib/workload-postgres.mjs';

function pool(row) {
  return { async query() { return { rows: [row] }; } };
}

test('least-privilege workload accepts only the required isolated membership', async () => {
  const result = await assertLeastPrivilegeWorkload(pool({
    login_role: 'oam_public_api',
    rolsuper: false,
    rolbypassrls: false,
    has_required_role: true,
    forbidden_memberships: [],
    role_memberships: ['oam_public_runtime'],
  }), {
    requiredRole: 'oam_public_runtime',
    forbiddenRoles: ['oam_operator_runtime', 'oam_broker_runtime'],
  });
  assert.equal(result.login_role, 'oam_public_api');
});

for (const [label, overrides] of [
  ['superuser', { rolsuper: true }],
  ['BYPASSRLS', { rolbypassrls: true }],
  ['missing required membership', { has_required_role: false }],
  ['forbidden cross-workload membership', { forbidden_memberships: ['oam_operator_runtime'] }],
  ['predefined privileged membership', {
    role_memberships: ['oam_public_runtime', 'pg_read_all_data'],
  }],
  ['unnamed custom membership', {
    role_memberships: ['custom_reporting_role', 'oam_public_runtime'],
  }],
  ['missing membership inventory', { role_memberships: undefined }],
]) {
  test(`least-privilege workload rejects ${label}`, async () => {
    await assert.rejects(
      assertLeastPrivilegeWorkload(pool({
        login_role: 'unsafe_login',
        rolsuper: false,
        rolbypassrls: false,
        has_required_role: true,
        forbidden_memberships: [],
        role_memberships: ['oam_public_runtime'],
        ...overrides,
      }), {
        requiredRole: 'oam_public_runtime',
        forbiddenRoles: ['oam_operator_runtime', 'oam_broker_runtime'],
      }),
      /database_workload_role_invalid/,
    );
  });
}

test('least-privilege workload inventories transitive memberships from PostgreSQL catalogs', async () => {
  let query;
  await assertLeastPrivilegeWorkload({
    async query(statement) {
      query = statement;
      return {
        rows: [{
          login_role: 'oam_public_api',
          rolsuper: false,
          rolbypassrls: false,
          has_required_role: true,
          forbidden_memberships: [],
          role_memberships: ['oam_public_runtime'],
        }],
      };
    },
  }, {
    requiredRole: 'oam_public_runtime',
    forbiddenRoles: [],
  });

  assert.match(query, /WITH RECURSIVE transitive_memberships/);
  assert.match(query, /FROM pg_auth_members AS membership/);
  assert.match(query, /JOIN transitive_memberships AS inherited/);
  assert.match(query, /role\.rolname::text/);
  assert.match(query, /AS role_memberships/);
});
