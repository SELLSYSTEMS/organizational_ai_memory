\set ON_ERROR_STOP on

-- psql variables required:
--   public_password, operator_password, broker_password
-- Run only after identity_data_plane_v1.sql has created the NOLOGIN workload roles.

BEGIN;

DO $roles$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oam_operator_api') THEN
        CREATE ROLE oam_operator_api
            LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oam_broker_api') THEN
        CREATE ROLE oam_broker_api
            LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    END IF;
END
$roles$;

ALTER ROLE oam_public_api
    LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
    CONNECTION LIMIT 12 PASSWORD :'public_password';
ALTER ROLE oam_operator_api
    LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
    CONNECTION LIMIT 8 PASSWORD :'operator_password';
ALTER ROLE oam_broker_api
    LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
    CONNECTION LIMIT 8 PASSWORD :'broker_password';

GRANT oam_public_runtime TO oam_public_api;
GRANT oam_operator_runtime TO oam_operator_api;
GRANT oam_broker_runtime TO oam_broker_api;

REVOKE oam_operator_runtime, oam_broker_runtime FROM oam_public_api;
REVOKE oam_public_runtime, oam_broker_runtime FROM oam_operator_api;
REVOKE oam_public_runtime, oam_operator_runtime FROM oam_broker_api;

ALTER ROLE oam_public_api SET statement_timeout = '5s';
ALTER ROLE oam_operator_api SET statement_timeout = '5s';
ALTER ROLE oam_broker_api SET statement_timeout = '5s';

COMMIT;
