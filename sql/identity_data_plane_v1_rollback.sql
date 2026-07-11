\set ON_ERROR_STOP on

-- Reverses only identity_data_plane_v1.sql. It does not restore or alter any
-- pre-existing memory object or role. Run as a PostgreSQL administrator.

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('organizational-ai-memory:identity-data-plane:v1'));

REVOKE oam_public_runtime FROM oam_public_api;

DROP SCHEMA IF EXISTS oam_public CASCADE;
DROP SCHEMA IF EXISTS governance CASCADE;
DROP SCHEMA IF EXISTS quarantine CASCADE;
DROP SCHEMA IF EXISTS identity CASCADE;
DROP SCHEMA IF EXISTS audit CASCADE;

DO $roles$
DECLARE
    role_name text;
BEGIN
    FOREACH role_name IN ARRAY ARRAY[
        'oam_operator_api',
        'oam_broker_api',
        'oam_public_api',
        'oam_public_runtime',
        'oam_operator_runtime',
        'oam_broker_runtime',
        'oam_reviewer_runtime',
        'oam_promoter_runtime',
        'oam_public_view_owner',
        'oam_audit_owner',
        'oam_security_owner'
    ]
    LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
            EXECUTE format('REASSIGN OWNED BY %I TO CURRENT_USER', role_name);
            EXECUTE format('DROP OWNED BY %I', role_name);
            EXECUTE format('DROP ROLE %I', role_name);
        END IF;
    END LOOP;
END
$roles$;

COMMIT;
