\set ON_ERROR_STOP on

-- Read-only cutover proof. Run while connected as oam_public_api after the
-- operator separately provisions its credential and enables LOGIN.

SELECT current_user AS runtime_role;

SELECT
    rolsuper,
    rolcreatedb,
    rolcreaterole,
    rolreplication,
    rolbypassrls
FROM pg_roles
WHERE rolname = current_user;

SELECT
    has_schema_privilege(current_user, 'oam_public', 'USAGE') AS public_view_usage,
    has_schema_privilege(current_user, 'memory', 'USAGE') AS canonical_memory_usage,
    has_table_privilege(current_user, relation.oid, 'INSERT') AS canonical_insert,
    has_table_privilege(current_user, relation.oid, 'UPDATE') AS canonical_update,
    has_table_privilege(current_user, relation.oid, 'DELETE') AS canonical_delete,
    has_function_privilege(
        current_user,
        'audit.record_public_interaction(text,text,text,text,text,jsonb)',
        'EXECUTE'
    ) AS bounded_audit_execute
FROM pg_catalog.pg_class relation
JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
WHERE namespace.nspname = 'memory'
  AND relation.relname = 'capability_assets';

SELECT count(*) AS fixed_scope_capability_assets
FROM oam_public.capability_assets;

SELECT count(*) AS fixed_scope_continuity_threads
FROM oam_public.continuity_threads;
