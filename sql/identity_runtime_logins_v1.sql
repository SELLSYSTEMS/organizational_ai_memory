\set ON_ERROR_STOP on

-- psql variables required:
--   public_password, operator_password, broker_password, employee_password
-- Run after identity_data_plane_v1.sql and v8 have created the NOLOGIN workload roles.

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
ALTER ROLE oam_employee_api
    LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
    CONNECTION LIMIT 12 PASSWORD :'employee_password';

GRANT oam_public_runtime TO oam_public_api;
GRANT oam_operator_runtime TO oam_operator_api;
GRANT oam_broker_runtime TO oam_broker_api;
GRANT oam_employee_runtime TO oam_employee_api;

REVOKE oam_operator_runtime, oam_broker_runtime FROM oam_public_api;
REVOKE oam_public_runtime, oam_broker_runtime FROM oam_operator_api;
REVOKE oam_public_runtime, oam_operator_runtime FROM oam_broker_api;
REVOKE oam_public_runtime, oam_operator_runtime, oam_broker_runtime FROM oam_employee_api;
REVOKE oam_employee_runtime FROM oam_public_api, oam_operator_api, oam_broker_api;

ALTER ROLE oam_public_api SET statement_timeout = '5s';
ALTER ROLE oam_operator_api SET statement_timeout = '5s';
ALTER ROLE oam_broker_api SET statement_timeout = '5s';
ALTER ROLE oam_employee_api SET statement_timeout = '5s';

COMMIT;
