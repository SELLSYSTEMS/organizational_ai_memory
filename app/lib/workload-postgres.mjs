export async function assertLeastPrivilegeWorkload(pool, {
  requiredRole,
  forbiddenRoles = [],
} = {}) {
  if (!pool || typeof pool.query !== 'function') throw new TypeError('A PostgreSQL pool is required.');
  if (typeof requiredRole !== 'string' || !requiredRole) throw new TypeError('requiredRole is required.');
  const result = await pool.query(
    `WITH RECURSIVE transitive_memberships(role_oid) AS (
       SELECT membership.roleid
       FROM pg_auth_members AS membership
       JOIN pg_roles AS login ON login.oid = membership.member
       WHERE login.rolname = current_user
       UNION
       SELECT membership.roleid
       FROM pg_auth_members AS membership
       JOIN transitive_memberships AS inherited
         ON inherited.role_oid = membership.member
     )
     SELECT current_user AS login_role,
            rolsuper,
            rolbypassrls,
            pg_has_role(current_user, $1, 'member') AS has_required_role,
            ARRAY(
              SELECT forbidden.role_name
              FROM unnest($2::text[]) AS forbidden(role_name)
              WHERE pg_has_role(current_user, forbidden.role_name, 'member')
              ORDER BY forbidden.role_name
            ) AS forbidden_memberships,
            ARRAY(
              SELECT role.rolname::text
              FROM transitive_memberships AS membership
              JOIN pg_roles AS role ON role.oid = membership.role_oid
              ORDER BY role.rolname
            ) AS role_memberships
     FROM pg_roles WHERE rolname = current_user`,
    [requiredRole, forbiddenRoles],
  );
  const row = result.rows[0];
  const roleMemberships = Array.isArray(row?.role_memberships)
    ? [...new Set(row.role_memberships)].sort()
    : null;
  const requiredMemberships = [requiredRole];
  if (!row || row.rolsuper || row.rolbypassrls || !row.has_required_role
      || (row.forbidden_memberships || []).length
      || !roleMemberships
      || roleMemberships.length !== requiredMemberships.length
      || roleMemberships.some((role, index) => role !== requiredMemberships[index])) {
    throw new Error('database_workload_role_invalid');
  }
  return Object.freeze({
    login_role: row.login_role,
    required_role: requiredRole,
  });
}
