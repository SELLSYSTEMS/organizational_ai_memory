\set ON_ERROR_STOP on

-- Organizational identity and governed-ingestion foundation.
-- PostgreSQL 17. Apply as a cluster/database administrator. This migration is
-- additive: it does not alter existing memory tables, users, or live grants.

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('organizational-ai-memory:identity-data-plane:v1'));

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $roles$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oam_security_owner') THEN
        CREATE ROLE oam_security_owner
            NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oam_public_view_owner') THEN
        CREATE ROLE oam_public_view_owner
            NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oam_audit_owner') THEN
        CREATE ROLE oam_audit_owner
            NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oam_public_runtime') THEN
        CREATE ROLE oam_public_runtime
            NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oam_operator_runtime') THEN
        CREATE ROLE oam_operator_runtime
            NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oam_broker_runtime') THEN
        CREATE ROLE oam_broker_runtime
            NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oam_reviewer_runtime') THEN
        CREATE ROLE oam_reviewer_runtime
            NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oam_promoter_runtime') THEN
        CREATE ROLE oam_promoter_runtime
            NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oam_public_api') THEN
        -- Deliberately disabled. Cutover must provision a credential and enable
        -- LOGIN only after the negative-write proof succeeds.
        CREATE ROLE oam_public_api
            NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    END IF;
END
$roles$;

ALTER ROLE oam_security_owner
    NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE oam_public_view_owner
    NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE oam_audit_owner
    NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE oam_public_runtime
    NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE oam_operator_runtime
    NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE oam_broker_runtime
    NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE oam_reviewer_runtime
    NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE oam_promoter_runtime
    NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE oam_public_api
    NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

GRANT oam_public_runtime TO oam_public_api;

CREATE SCHEMA IF NOT EXISTS identity AUTHORIZATION oam_security_owner;
CREATE SCHEMA IF NOT EXISTS quarantine AUTHORIZATION oam_security_owner;
CREATE SCHEMA IF NOT EXISTS governance AUTHORIZATION oam_security_owner;
CREATE SCHEMA IF NOT EXISTS audit AUTHORIZATION oam_audit_owner;
CREATE SCHEMA IF NOT EXISTS oam_public AUTHORIZATION oam_public_view_owner;

SET LOCAL ROLE oam_security_owner;

CREATE TABLE identity.departments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    department_key text NOT NULL UNIQUE,
    display_name text NOT NULL,
    status text NOT NULL DEFAULT 'active',
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT departments_key_check
        CHECK (department_key ~ '^[a-z][a-z0-9_]{1,79}$'),
    CONSTRAINT departments_name_check
        CHECK (char_length(display_name) BETWEEN 1 AND 160),
    CONSTRAINT departments_status_check
        CHECK (status IN ('active', 'suspended', 'retired')),
    CONSTRAINT departments_metadata_check
        CHECK (jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 8192)
);

CREATE TABLE identity.principals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    principal_key text NOT NULL UNIQUE,
    principal_kind text NOT NULL,
    display_name text NOT NULL,
    external_issuer text,
    external_subject text,
    status text NOT NULL DEFAULT 'draft',
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    suspended_at timestamptz,
    CONSTRAINT principals_key_check
        CHECK (principal_key ~ '^(human|agent|service):[a-z0-9][a-z0-9_.-]{1,118}$'),
    CONSTRAINT principals_kind_check
        CHECK (principal_kind IN ('human', 'agent', 'service')),
    CONSTRAINT principals_name_check
        CHECK (char_length(display_name) BETWEEN 1 AND 200),
    CONSTRAINT principals_status_check
        CHECK (status IN ('draft', 'active', 'suspended', 'retired')),
    CONSTRAINT principals_external_pair_check
        CHECK ((external_issuer IS NULL) = (external_subject IS NULL)),
    CONSTRAINT principals_external_size_check
        CHECK (
            external_issuer IS NULL
            OR (
                char_length(external_issuer) BETWEEN 1 AND 500
                AND char_length(external_subject) BETWEEN 1 AND 500
            )
        ),
    CONSTRAINT principals_metadata_check
        CHECK (jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 16384),
    CONSTRAINT principals_suspension_check
        CHECK ((status = 'suspended') = (suspended_at IS NOT NULL))
);

CREATE UNIQUE INDEX identity_principals_external_subject_uidx
    ON identity.principals (external_issuer, external_subject)
    WHERE external_issuer IS NOT NULL;

CREATE TABLE identity.department_memberships (
    principal_id uuid NOT NULL REFERENCES identity.principals(id) ON DELETE RESTRICT,
    department_id uuid NOT NULL REFERENCES identity.departments(id) ON DELETE RESTRICT,
    membership_role text NOT NULL,
    status text NOT NULL DEFAULT 'active',
    valid_from timestamptz NOT NULL DEFAULT now(),
    valid_to timestamptz,
    approved_by_principal_id uuid REFERENCES identity.principals(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (principal_id, department_id, membership_role),
    CONSTRAINT department_memberships_role_check
        CHECK (membership_role IN ('member', 'reviewer', 'architect')),
    CONSTRAINT department_memberships_status_check
        CHECK (status IN ('active', 'suspended', 'expired')),
    CONSTRAINT department_memberships_validity_check
        CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE INDEX department_memberships_department_idx
    ON identity.department_memberships (department_id, status, membership_role, principal_id);

CREATE TABLE identity.principal_links (
    source_principal_id uuid NOT NULL REFERENCES identity.principals(id) ON DELETE RESTRICT,
    target_principal_id uuid NOT NULL REFERENCES identity.principals(id) ON DELETE RESTRICT,
    link_kind text NOT NULL,
    status text NOT NULL DEFAULT 'active',
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (source_principal_id, target_principal_id, link_kind),
    CONSTRAINT principal_links_kind_check
        CHECK (link_kind IN ('linked_agent', 'reports_to', 'service_owner')),
    CONSTRAINT principal_links_status_check
        CHECK (status IN ('active', 'suspended', 'retired')),
    CONSTRAINT principal_links_distinct_check
        CHECK (source_principal_id <> target_principal_id),
    CONSTRAINT principal_links_metadata_check
        CHECK (jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 8192)
);

CREATE TABLE identity.runtime_bindings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    principal_id uuid NOT NULL REFERENCES identity.principals(id) ON DELETE RESTRICT,
    binding_kind text NOT NULL,
    binding_value text NOT NULL,
    access_mode text NOT NULL DEFAULT 'brokered',
    status text NOT NULL DEFAULT 'draft',
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    valid_from timestamptz NOT NULL DEFAULT now(),
    valid_to timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT runtime_bindings_kind_check
        CHECK (binding_kind IN (
            'linux_user', 'linux_group', 'postgres_role', 'systemd_unit',
            'workspace', 'unix_socket', 'broker_client'
        )),
    CONSTRAINT runtime_bindings_value_check
        CHECK (char_length(binding_value) BETWEEN 1 AND 500),
    CONSTRAINT runtime_bindings_access_mode_check
        CHECK (access_mode IN ('logical_only', 'brokered', 'direct')),
    CONSTRAINT runtime_bindings_status_check
        CHECK (status IN ('draft', 'active', 'suspended', 'retired')),
    CONSTRAINT runtime_bindings_validity_check
        CHECK (valid_to IS NULL OR valid_to > valid_from),
    CONSTRAINT runtime_bindings_metadata_check
        CHECK (jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 8192)
);

CREATE UNIQUE INDEX runtime_bindings_active_value_uidx
    ON identity.runtime_bindings (binding_kind, binding_value)
    WHERE status IN ('draft', 'active');

CREATE INDEX runtime_bindings_principal_idx
    ON identity.runtime_bindings (principal_id, status, binding_kind);

CREATE TABLE identity.policy_templates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    template_key text NOT NULL,
    version integer NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    status text NOT NULL DEFAULT 'draft',
    created_by_principal_id uuid REFERENCES identity.principals(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    activated_at timestamptz,
    UNIQUE (template_key, version),
    CONSTRAINT policy_templates_key_check
        CHECK (template_key ~ '^[a-z][a-z0-9_]{1,79}$'),
    CONSTRAINT policy_templates_version_check CHECK (version BETWEEN 1 AND 1000000),
    CONSTRAINT policy_templates_status_check
        CHECK (status IN ('draft', 'active', 'superseded', 'retired')),
    CONSTRAINT policy_templates_activation_check
        CHECK ((status = 'active' AND activated_at IS NOT NULL) OR status <> 'active')
);

CREATE TABLE identity.policy_template_rules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id uuid NOT NULL REFERENCES identity.policy_templates(id) ON DELETE CASCADE,
    principal_kind text NOT NULL,
    membership_role text,
    permission_key text NOT NULL,
    effect text NOT NULL,
    conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
    sort_order smallint NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE NULLS NOT DISTINCT (template_id, principal_kind, membership_role, permission_key),
    CONSTRAINT policy_template_rules_kind_check
        CHECK (principal_kind IN ('human', 'agent', 'service')),
    CONSTRAINT policy_template_rules_role_check
        CHECK (membership_role IS NULL OR membership_role IN ('member', 'reviewer', 'architect')),
    CONSTRAINT policy_template_rules_permission_check
        CHECK (permission_key ~ '^[a-z][a-z0-9_.:]{2,119}$'),
    CONSTRAINT policy_template_rules_effect_check CHECK (effect IN ('allow', 'deny')),
    CONSTRAINT policy_template_rules_conditions_check
        CHECK (jsonb_typeof(conditions) = 'object' AND octet_length(conditions::text) <= 8192),
    CONSTRAINT policy_template_rules_sort_check CHECK (sort_order BETWEEN 0 AND 32767)
);

CREATE TABLE identity.policy_assignments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_key text NOT NULL UNIQUE,
    assignment_scope text NOT NULL,
    principal_id uuid REFERENCES identity.principals(id) ON DELETE RESTRICT,
    department_id uuid NOT NULL REFERENCES identity.departments(id) ON DELETE RESTRICT,
    template_id uuid NOT NULL REFERENCES identity.policy_templates(id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'active',
    valid_from timestamptz NOT NULL DEFAULT now(),
    valid_to timestamptz,
    assigned_by_principal_id uuid NOT NULL REFERENCES identity.principals(id) ON DELETE RESTRICT,
    reason text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE NULLS NOT DISTINCT (assignment_scope, principal_id, department_id, template_id),
    CONSTRAINT policy_assignments_key_check
        CHECK (assignment_key ~ '^assignment:[a-z0-9][a-z0-9_.:-]{1,108}$'),
    CONSTRAINT policy_assignments_scope_check
        CHECK (assignment_scope IN ('department', 'principal')),
    CONSTRAINT policy_assignments_target_check CHECK (
        (assignment_scope = 'department' AND principal_id IS NULL)
        OR (assignment_scope = 'principal' AND principal_id IS NOT NULL)
    ),
    CONSTRAINT policy_assignments_status_check
        CHECK (status IN ('active', 'suspended', 'expired', 'retired')),
    CONSTRAINT policy_assignments_validity_check CHECK (valid_to IS NULL OR valid_to > valid_from),
    CONSTRAINT policy_assignments_reason_check CHECK (char_length(reason) BETWEEN 1 AND 2000)
);

CREATE INDEX policy_assignments_principal_scope_idx
    ON identity.policy_assignments (principal_id, department_id, status, valid_from, valid_to);

CREATE TABLE identity.explicit_permission_denials (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    denial_key text NOT NULL UNIQUE,
    principal_id uuid NOT NULL REFERENCES identity.principals(id) ON DELETE RESTRICT,
    department_id uuid NOT NULL REFERENCES identity.departments(id) ON DELETE RESTRICT,
    permission_key text NOT NULL,
    reason text NOT NULL,
    status text NOT NULL DEFAULT 'active',
    valid_from timestamptz NOT NULL DEFAULT now(),
    valid_to timestamptz,
    recorded_by_principal_id uuid NOT NULL REFERENCES identity.principals(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (principal_id, department_id, permission_key),
    CONSTRAINT explicit_permission_denials_key_check
        CHECK (denial_key ~ '^deny:[a-z0-9][a-z0-9_.:-]{1,112}$'),
    CONSTRAINT explicit_permission_denials_permission_check
        CHECK (permission_key ~ '^[a-z][a-z0-9_.:]{2,119}$'),
    CONSTRAINT explicit_permission_denials_reason_check CHECK (char_length(reason) BETWEEN 1 AND 2000),
    CONSTRAINT explicit_permission_denials_status_check
        CHECK (status IN ('active', 'expired', 'retired')),
    CONSTRAINT explicit_permission_denials_validity_check CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE INDEX explicit_permission_denials_principal_scope_idx
    ON identity.explicit_permission_denials
    (principal_id, department_id, status, permission_key, valid_from, valid_to);

CREATE OR REPLACE FUNCTION identity.enforce_policy_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, identity
AS $function$
DECLARE
    template_status text;
BEGIN
    IF TG_TABLE_NAME = 'policy_template_rules' THEN
        IF TG_OP = 'UPDATE' AND NEW.template_id IS DISTINCT FROM OLD.template_id THEN
            RAISE EXCEPTION 'policy rules cannot move between templates' USING ERRCODE = '55000';
        END IF;
        IF TG_OP IN ('UPDATE', 'DELETE') THEN
            SELECT status INTO template_status
            FROM identity.policy_templates
            WHERE id = OLD.template_id;
            IF template_status IN ('active', 'superseded', 'retired') THEN
                RAISE EXCEPTION 'activated policy rules are immutable' USING ERRCODE = '55000';
            END IF;
        END IF;
        IF TG_OP IN ('INSERT', 'UPDATE') THEN
            SELECT status INTO template_status
            FROM identity.policy_templates
            WHERE id = NEW.template_id;
            IF template_status IN ('active', 'superseded', 'retired') THEN
                RAISE EXCEPTION 'activated policy rules are immutable' USING ERRCODE = '55000';
            END IF;
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' AND OLD.status <> 'draft' THEN
        RAISE EXCEPTION 'activated policy templates are immutable' USING ERRCODE = '55000';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status <> 'draft' AND (
        NEW.template_key IS DISTINCT FROM OLD.template_key
        OR NEW.version IS DISTINCT FROM OLD.version
        OR NEW.title IS DISTINCT FROM OLD.title
        OR NEW.description IS DISTINCT FROM OLD.description
        OR NEW.created_by_principal_id IS DISTINCT FROM OLD.created_by_principal_id
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
        OR NEW.activated_at IS DISTINCT FROM OLD.activated_at
    ) THEN
        RAISE EXCEPTION 'activated policy templates are immutable' USING ERRCODE = '55000';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'active'
       AND NEW.status NOT IN ('active', 'superseded', 'retired') THEN
        RAISE EXCEPTION 'invalid active policy transition' USING ERRCODE = '55000';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'superseded'
       AND NEW.status NOT IN ('superseded', 'retired') THEN
        RAISE EXCEPTION 'invalid superseded policy transition' USING ERRCODE = '55000';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'retired' AND NEW.status <> 'retired' THEN
        RAISE EXCEPTION 'retired policies cannot be reactivated' USING ERRCODE = '55000';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END
$function$;

CREATE TRIGGER policy_template_immutability_trigger
BEFORE UPDATE OR DELETE ON identity.policy_templates
FOR EACH ROW EXECUTE FUNCTION identity.enforce_policy_immutability();

CREATE TRIGGER policy_rule_immutability_trigger
BEFORE INSERT OR UPDATE OR DELETE ON identity.policy_template_rules
FOR EACH ROW EXECUTE FUNCTION identity.enforce_policy_immutability();

REVOKE ALL ON FUNCTION identity.enforce_policy_immutability() FROM PUBLIC;

-- Bearer secrets are never stored. The broker authenticates only a SHA-256
-- digest and resolves every identity and policy dimension server-side.
CREATE TABLE identity.broker_credentials (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    principal_id uuid NOT NULL REFERENCES identity.principals(id) ON DELETE RESTRICT,
    token_sha256 text NOT NULL UNIQUE,
    policy_template_id uuid NOT NULL REFERENCES identity.policy_templates(id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'draft',
    issued_by_principal_id uuid NOT NULL REFERENCES identity.principals(id) ON DELETE RESTRICT,
    issued_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz,
    revoked_at timestamptz,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT broker_credentials_hash_check CHECK (token_sha256 ~ '^[a-f0-9]{64}$'),
    CONSTRAINT broker_credentials_status_check
        CHECK (status IN ('draft', 'active', 'suspended', 'revoked')),
    CONSTRAINT broker_credentials_expiry_check
        CHECK (expires_at IS NULL OR expires_at > issued_at),
    CONSTRAINT broker_credentials_revocation_check
        CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),
    CONSTRAINT broker_credentials_metadata_check
        CHECK (jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 8192)
);

CREATE INDEX broker_credentials_principal_status_idx
    ON identity.broker_credentials (principal_id, status, issued_at DESC);

CREATE TABLE governance.capability_grants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    principal_id uuid NOT NULL REFERENCES identity.principals(id) ON DELETE RESTRICT,
    department_id uuid NOT NULL REFERENCES identity.departments(id) ON DELETE RESTRICT,
    policy_template_id uuid NOT NULL REFERENCES identity.policy_templates(id) ON DELETE RESTRICT,
    capability_task_key text NOT NULL,
    allowed_review_statuses text[] NOT NULL DEFAULT ARRAY['approved']::text[],
    status text NOT NULL DEFAULT 'draft',
    valid_from timestamptz NOT NULL DEFAULT now(),
    valid_to timestamptz,
    created_by_principal_id uuid NOT NULL REFERENCES identity.principals(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (principal_id, department_id, policy_template_id, capability_task_key),
    CONSTRAINT capability_grants_task_check
        CHECK (capability_task_key ~ '^[a-z][a-z0-9_]{2,119}$'),
    CONSTRAINT capability_grants_review_check CHECK (
        cardinality(allowed_review_statuses) BETWEEN 1 AND 4
        AND allowed_review_statuses <@ ARRAY['draft', 'reviewed', 'approved', 'deprecated']::text[]
    ),
    CONSTRAINT capability_grants_status_check
        CHECK (status IN ('draft', 'active', 'suspended', 'revoked')),
    CONSTRAINT capability_grants_validity_check CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE INDEX capability_grants_principal_status_idx
    ON governance.capability_grants (principal_id, status, department_id, capability_task_key);

CREATE TABLE identity.operator_context_credentials (
    token_sha256 text PRIMARY KEY,
    principal_id uuid NOT NULL REFERENCES identity.principals(id) ON DELETE CASCADE,
    department_id uuid NOT NULL REFERENCES identity.departments(id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT operator_context_credentials_hash_check
        CHECK (token_sha256 ~ '^[a-f0-9]{64}$'),
    CONSTRAINT operator_context_credentials_status_check
        CHECK (status IN ('active', 'retired')),
    UNIQUE (principal_id, department_id)
);

CREATE OR REPLACE FUNCTION identity.current_operator_principal_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, identity
AS $function$
    SELECT credential.principal_id
    FROM identity.operator_context_credentials credential
    JOIN identity.principals principal
      ON principal.id = credential.principal_id
     AND principal.principal_kind = 'human'
     AND principal.status = 'active'
    JOIN identity.department_memberships membership
      ON membership.principal_id = credential.principal_id
     AND membership.department_id = credential.department_id
     AND membership.membership_role IN ('reviewer', 'architect')
     AND membership.status = 'active'
     AND membership.valid_from <= now()
     AND (membership.valid_to IS NULL OR membership.valid_to > now())
    JOIN identity.departments department
      ON department.id = credential.department_id
     AND department.status = 'active'
    WHERE credential.token_sha256 =
          current_setting('oam.operator_context_sha256', true)
      AND credential.status = 'active'
      AND session_user = 'oam_operator_api'
    LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION identity.current_operator_department_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, identity
AS $function$
    SELECT credential.department_id
    FROM identity.operator_context_credentials credential
    WHERE credential.token_sha256 =
          current_setting('oam.operator_context_sha256', true)
      AND credential.status = 'active'
      AND credential.principal_id = identity.current_operator_principal_id()
    LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION identity.establish_operator_context(p_token_sha256 text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, identity
AS $function$
BEGIN
    IF p_token_sha256 !~ '^[a-f0-9]{64}$'
       OR NOT EXISTS (
         SELECT 1
         FROM identity.operator_context_credentials credential
         JOIN identity.principals principal
           ON principal.id = credential.principal_id
          AND principal.principal_kind = 'human'
          AND principal.status = 'active'
         JOIN identity.department_memberships membership
          ON membership.principal_id = credential.principal_id
          AND membership.department_id = credential.department_id
          AND membership.membership_role IN ('reviewer', 'architect')
          AND membership.status = 'active'
          AND membership.valid_from <= now()
          AND (membership.valid_to IS NULL OR membership.valid_to > now())
         JOIN identity.departments department
           ON department.id = credential.department_id
          AND department.status = 'active'
         WHERE credential.token_sha256 = p_token_sha256
           AND credential.status = 'active'
       )
       OR session_user <> 'oam_operator_api' THEN
        RAISE EXCEPTION 'operator database context denied' USING ERRCODE = '42501';
    END IF;
    PERFORM set_config('oam.operator_context_sha256', p_token_sha256, true);
END
$function$;

CREATE OR REPLACE FUNCTION identity.resolve_operator_context(
    p_principal_key text,
    p_department_key text,
    p_token_sha256 text
)
RETURNS TABLE (
    principal_id uuid,
    principal_key text,
    display_name text,
    membership_role text,
    department_id uuid,
    department_key text,
    department_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, identity
AS $function$
    SELECT principal.id,
           principal.principal_key,
           principal.display_name,
           membership.membership_role,
           department.id,
           department.department_key,
           department.display_name
    FROM identity.operator_context_credentials credential
    JOIN identity.principals principal
      ON principal.id = credential.principal_id
     AND principal.principal_key = p_principal_key
     AND principal.principal_kind = 'human'
     AND principal.status = 'active'
    JOIN identity.department_memberships membership
      ON membership.principal_id = principal.id
     AND membership.department_id = credential.department_id
     AND membership.status = 'active'
     AND membership.valid_from <= now()
     AND (membership.valid_to IS NULL OR membership.valid_to > now())
    JOIN identity.departments department
      ON department.id = credential.department_id
     AND department.department_key = p_department_key
     AND department.status = 'active'
    WHERE credential.token_sha256 = p_token_sha256
      AND credential.status = 'active'
      AND membership.membership_role IN ('reviewer', 'architect')
      AND session_user = 'oam_operator_api'
      AND EXISTS (
        SELECT 1
        FROM identity.policy_assignments assignment
        JOIN identity.policy_templates template
          ON template.id = assignment.template_id AND template.status = 'active'
        JOIN identity.policy_template_rules rule
          ON rule.template_id = template.id
         AND rule.principal_kind = 'human'
         AND rule.permission_key = 'memory.department.read'
         AND rule.effect = 'allow'
         AND rule.conditions = '{}'::jsonb
         AND (rule.membership_role IS NULL OR rule.membership_role = membership.membership_role)
        WHERE assignment.assignment_scope = 'principal'
          AND assignment.principal_id = principal.id
          AND assignment.department_id = department.id
          AND assignment.status = 'active'
          AND assignment.valid_from <= now()
          AND (assignment.valid_to IS NULL OR assignment.valid_to > now())
      )
      AND NOT EXISTS (
        SELECT 1
        FROM identity.explicit_permission_denials denial
        WHERE denial.principal_id = principal.id
          AND denial.department_id = department.id
          AND denial.permission_key = 'memory.department.read'
          AND denial.status = 'active'
          AND denial.valid_from <= now()
          AND (denial.valid_to IS NULL OR denial.valid_to > now())
      )
    LIMIT 1
$function$;

REVOKE ALL ON TABLE identity.operator_context_credentials FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.current_operator_principal_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.current_operator_department_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.establish_operator_context(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.resolve_operator_context(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.current_operator_principal_id()
    TO oam_operator_runtime;
GRANT EXECUTE ON FUNCTION identity.current_operator_department_id()
    TO oam_operator_runtime;
GRANT EXECUTE ON FUNCTION identity.establish_operator_context(text)
    TO oam_operator_runtime;
GRANT EXECUTE ON FUNCTION identity.resolve_operator_context(text, text, text)
    TO oam_operator_runtime;

ALTER TABLE identity.broker_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.broker_credentials FORCE ROW LEVEL SECURITY;
ALTER TABLE identity.policy_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.policy_assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE identity.explicit_permission_denials ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.explicit_permission_denials FORCE ROW LEVEL SECURITY;
ALTER TABLE governance.capability_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance.capability_grants FORCE ROW LEVEL SECURITY;

CREATE POLICY broker_credentials_operator_policy
    ON identity.broker_credentials
    FOR ALL
    TO oam_operator_runtime
    USING (EXISTS (
        SELECT 1 FROM identity.department_memberships membership
        WHERE membership.principal_id = broker_credentials.principal_id
          AND membership.department_id = identity.current_operator_department_id()
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM identity.department_memberships membership
        WHERE membership.principal_id = broker_credentials.principal_id
          AND membership.department_id = identity.current_operator_department_id()
    ));

CREATE POLICY broker_credentials_broker_read_policy
    ON identity.broker_credentials
    FOR SELECT
    USING (pg_has_role(current_user, 'oam_broker_runtime', 'member'));

CREATE POLICY broker_credentials_owner_policy
    ON identity.broker_credentials
    FOR ALL TO oam_security_owner
    USING (true)
    WITH CHECK (true);

CREATE POLICY policy_assignments_operator_policy
    ON identity.policy_assignments
    FOR ALL
    TO oam_operator_runtime
    USING (department_id = identity.current_operator_department_id())
    WITH CHECK (department_id = identity.current_operator_department_id());

CREATE POLICY policy_assignments_broker_read_policy
    ON identity.policy_assignments
    FOR SELECT
    USING (pg_has_role(current_user, 'oam_broker_runtime', 'member'));

CREATE POLICY policy_assignments_owner_policy
    ON identity.policy_assignments
    FOR ALL TO oam_security_owner
    USING (true)
    WITH CHECK (true);

CREATE POLICY explicit_permission_denials_operator_policy
    ON identity.explicit_permission_denials
    FOR ALL
    TO oam_operator_runtime
    USING (department_id = identity.current_operator_department_id())
    WITH CHECK (department_id = identity.current_operator_department_id());

CREATE POLICY explicit_permission_denials_broker_read_policy
    ON identity.explicit_permission_denials
    FOR SELECT
    USING (pg_has_role(current_user, 'oam_broker_runtime', 'member'));

CREATE POLICY explicit_permission_denials_owner_policy
    ON identity.explicit_permission_denials
    FOR ALL TO oam_security_owner
    USING (true)
    WITH CHECK (true);

CREATE POLICY capability_grants_operator_policy
    ON governance.capability_grants
    FOR ALL
    TO oam_operator_runtime
    USING (department_id = identity.current_operator_department_id())
    WITH CHECK (department_id = identity.current_operator_department_id());

CREATE POLICY capability_grants_broker_read_policy
    ON governance.capability_grants
    FOR SELECT
    USING (pg_has_role(current_user, 'oam_broker_runtime', 'member'));

CREATE POLICY capability_grants_owner_policy
    ON governance.capability_grants
    FOR ALL TO oam_security_owner
    USING (true)
    WITH CHECK (true);

CREATE TABLE identity.provisioning_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key uuid NOT NULL UNIQUE,
    principal_id uuid NOT NULL REFERENCES identity.principals(id) ON DELETE RESTRICT,
    department_id uuid NOT NULL REFERENCES identity.departments(id) ON DELETE RESTRICT,
    job_type text NOT NULL,
    requested_by_principal_id uuid NOT NULL REFERENCES identity.principals(id) ON DELETE RESTRICT,
    confirmed_by_principal_id uuid REFERENCES identity.principals(id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'queued',
    plan jsonb NOT NULL,
    plan_hash text GENERATED ALWAYS AS (
        encode(digest(plan::text, 'sha256'), 'hex')
    ) STORED,
    requested_at timestamptz NOT NULL DEFAULT now(),
    confirmed_at timestamptz,
    started_at timestamptz,
    finished_at timestamptz,
    error_code text,
    revision integer NOT NULL DEFAULT 0,
    CONSTRAINT provisioning_jobs_type_check
        CHECK (job_type IN (
            'logical_principal', 'linux_identity', 'runtime_binding',
            'broker_credential', 'postgres_exception', 'suspension', 'revocation'
        )),
    CONSTRAINT provisioning_jobs_status_check
        CHECK (status IN (
            'queued', 'confirmed', 'running', 'succeeded', 'failed', 'cancelled'
        )),
    CONSTRAINT provisioning_jobs_plan_check
        CHECK (jsonb_typeof(plan) = 'object' AND octet_length(plan::text) BETWEEN 2 AND 32768),
    CONSTRAINT provisioning_jobs_revision_check CHECK (revision BETWEEN 0 AND 1000000),
    CONSTRAINT provisioning_jobs_confirmation_check CHECK (
        (status = 'queued' AND confirmed_by_principal_id IS NULL AND confirmed_at IS NULL)
        OR status <> 'queued'
    )
);

CREATE INDEX provisioning_jobs_principal_status_idx
    ON identity.provisioning_jobs (department_id, principal_id, status, requested_at DESC);

CREATE TABLE identity.provisioning_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_id uuid NOT NULL REFERENCES identity.provisioning_jobs(id) ON DELETE CASCADE,
    event_type text NOT NULL,
    actor_principal_id uuid REFERENCES identity.principals(id) ON DELETE RESTRICT,
    from_status text,
    to_status text NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT provisioning_events_type_check
        CHECK (event_type IN ('queued', 'confirmed', 'started', 'succeeded', 'failed', 'cancelled')),
    CONSTRAINT provisioning_events_payload_check
        CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 8192)
);

CREATE INDEX provisioning_events_job_time_idx
    ON identity.provisioning_events (job_id, created_at, id);

CREATE TABLE identity.proof_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    proof_key text NOT NULL,
    target_kind text NOT NULL,
    target_key text NOT NULL,
    status text NOT NULL,
    commands jsonb NOT NULL,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    recorded_by_principal_id uuid NOT NULL REFERENCES identity.principals(id) ON DELETE RESTRICT,
    department_id uuid NOT NULL REFERENCES identity.departments(id) ON DELETE RESTRICT,
    executed_at timestamptz NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (proof_key, target_kind, target_key, executed_at),
    CONSTRAINT proof_runs_key_check CHECK (proof_key ~ '^[a-z][a-z0-9_.:-]{2,119}$'),
    CONSTRAINT proof_runs_target_check
        CHECK (target_kind IN ('principal', 'runtime_binding', 'systemd_unit', 'postgres_role', 'workspace')),
    CONSTRAINT proof_runs_status_check CHECK (status IN ('passed', 'failed', 'inconclusive')),
    CONSTRAINT proof_runs_commands_check
        CHECK (jsonb_typeof(commands) = 'array' AND jsonb_array_length(commands) BETWEEN 1 AND 64),
    CONSTRAINT proof_runs_evidence_check
        CHECK (jsonb_typeof(evidence) = 'object' AND octet_length(evidence::text) <= 32768)
);

CREATE INDEX proof_runs_target_time_idx
    ON identity.proof_runs (target_kind, target_key, executed_at DESC);
CREATE INDEX proof_runs_department_time_idx
    ON identity.proof_runs (department_id, executed_at DESC, id);

CREATE TABLE quarantine.uploads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    upload_key text NOT NULL UNIQUE,
    submitted_by_principal_id uuid NOT NULL REFERENCES identity.principals(id) ON DELETE RESTRICT,
    owning_department_id uuid NOT NULL REFERENCES identity.departments(id) ON DELETE RESTRICT,
    original_name text NOT NULL,
    storage_key text NOT NULL,
    sha256 text NOT NULL,
    size_bytes bigint NOT NULL,
    declared_mime text,
    detected_mime text,
    status text NOT NULL DEFAULT 'received',
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT quarantine_uploads_key_check
        CHECK (upload_key ~ '^upload:[a-z0-9][a-z0-9_.-]{1,118}$'),
    CONSTRAINT quarantine_uploads_name_check CHECK (
        char_length(original_name) BETWEEN 1 AND 255
        AND position('/' IN original_name) = 0
        AND position(chr(92) IN original_name) = 0
    ),
    CONSTRAINT quarantine_uploads_storage_check
        CHECK (storage_key ~ '^[a-f0-9]{2}/[a-f0-9]{64}$'),
    CONSTRAINT quarantine_uploads_sha_check CHECK (sha256 ~ '^[a-f0-9]{64}$'),
    CONSTRAINT quarantine_uploads_size_check CHECK (size_bytes BETWEEN 1 AND 52428800),
    CONSTRAINT quarantine_uploads_status_check CHECK (status IN (
        'received', 'scanning', 'quarantined', 'rejected',
        'ready_for_review', 'approved_for_promotion', 'promoted'
    )),
    CONSTRAINT quarantine_uploads_metadata_check
        CHECK (jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 16384),
    CONSTRAINT quarantine_uploads_capture_binding_key
        UNIQUE (id, submitted_by_principal_id, owning_department_id, sha256)
);

CREATE INDEX quarantine_uploads_department_status_idx
    ON quarantine.uploads (owning_department_id, status, created_at DESC);

CREATE INDEX quarantine_uploads_storage_key_idx
    ON quarantine.uploads (storage_key);

CREATE TABLE quarantine.scan_findings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    upload_id uuid NOT NULL REFERENCES quarantine.uploads(id) ON DELETE CASCADE,
    scanner_principal_id uuid NOT NULL REFERENCES identity.principals(id) ON DELETE RESTRICT,
    scanner_key text NOT NULL,
    verdict text NOT NULL,
    findings jsonb NOT NULL,
    content_sha256 text NOT NULL,
    scanned_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT quarantine_scan_verdict_check
        CHECK (verdict IN ('clean', 'suspicious', 'malicious', 'unsupported', 'error')),
    CONSTRAINT quarantine_scan_hash_check CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
    CONSTRAINT quarantine_scan_findings_check
        CHECK (jsonb_typeof(findings) = 'object' AND octet_length(findings::text) <= 32768)
);

CREATE INDEX quarantine_scan_findings_latest_idx
    ON quarantine.scan_findings (upload_id, scanned_at DESC, id DESC);

CREATE TABLE quarantine.candidates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_key text NOT NULL UNIQUE,
    upload_id uuid NOT NULL REFERENCES quarantine.uploads(id) ON DELETE RESTRICT,
    owning_department_id uuid NOT NULL REFERENCES identity.departments(id) ON DELETE RESTRICT,
    produced_by_principal_id uuid NOT NULL REFERENCES identity.principals(id) ON DELETE RESTRICT,
    submitted_by_principal_id uuid NOT NULL REFERENCES identity.principals(id) ON DELETE RESTRICT,
    source_upload_sha256 text NOT NULL,
    candidate_type text NOT NULL,
    title text NOT NULL,
    candidate_payload jsonb NOT NULL,
    content_hash text GENERATED ALWAYS AS (
        encode(digest(candidate_payload::text, 'sha256'), 'hex')
    ) STORED,
    approved_content_hash text,
    status text NOT NULL DEFAULT 'draft',
    revision integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT quarantine_candidates_key_check
        CHECK (candidate_key ~ '^candidate:[a-z0-9][a-z0-9_.-]{1,115}$'),
    CONSTRAINT quarantine_candidates_type_check
        CHECK (candidate_type IN ('prompt', 'workflow', 'agent', 'decision_pattern', 'best_practice')),
    CONSTRAINT quarantine_candidates_title_check CHECK (char_length(title) BETWEEN 1 AND 240),
    CONSTRAINT quarantine_candidates_payload_check CHECK (
        jsonb_typeof(candidate_payload) = 'object'
        AND octet_length(candidate_payload::text) BETWEEN 2 AND 32768
    ),
    CONSTRAINT quarantine_candidates_source_hash_check
        CHECK (source_upload_sha256 ~ '^[a-f0-9]{64}$'),
    CONSTRAINT quarantine_candidates_approved_hash_check
        CHECK (approved_content_hash IS NULL OR approved_content_hash ~ '^[a-f0-9]{64}$'),
    CONSTRAINT quarantine_candidates_status_check CHECK (status IN (
        'draft', 'review_pending', 'reviewed', 'rejected', 'promoted_to_draft'
    )),
    CONSTRAINT quarantine_candidates_revision_check CHECK (revision BETWEEN 0 AND 1000000),
    CONSTRAINT quarantine_candidates_approval_integrity_check CHECK (
        (
            status IN ('reviewed', 'promoted_to_draft')
            AND approved_content_hash = content_hash
        ) OR (
            status NOT IN ('reviewed', 'promoted_to_draft')
            AND approved_content_hash IS NULL
        )
    ),
    CONSTRAINT quarantine_candidates_upload_binding_fkey FOREIGN KEY (
        upload_id,
        submitted_by_principal_id,
        owning_department_id,
        source_upload_sha256
    ) REFERENCES quarantine.uploads (
        id,
        submitted_by_principal_id,
        owning_department_id,
        sha256
    ) ON DELETE RESTRICT
);

CREATE INDEX quarantine_candidates_department_status_idx
    ON quarantine.candidates (owning_department_id, status, created_at DESC);

CREATE TABLE quarantine.candidate_evidence (
    candidate_id uuid NOT NULL REFERENCES quarantine.candidates(id) ON DELETE CASCADE,
    upload_id uuid NOT NULL REFERENCES quarantine.uploads(id) ON DELETE RESTRICT,
    evidence_kind text NOT NULL,
    evidence_ref text NOT NULL,
    excerpt text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (candidate_id, evidence_kind, evidence_ref),
    CONSTRAINT candidate_evidence_kind_check
        CHECK (evidence_kind IN ('upload_text', 'source_turn', 'observation', 'artifact_hash')),
    CONSTRAINT candidate_evidence_ref_check CHECK (char_length(evidence_ref) BETWEEN 1 AND 500),
    CONSTRAINT candidate_evidence_excerpt_check CHECK (char_length(excerpt) BETWEEN 1 AND 2000)
);

CREATE TABLE governance.candidate_reviews (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id uuid NOT NULL REFERENCES quarantine.candidates(id) ON DELETE RESTRICT,
    reviewer_principal_id uuid NOT NULL REFERENCES identity.principals(id) ON DELETE RESTRICT,
    action text NOT NULL,
    reason text NOT NULL,
    candidate_revision integer NOT NULL,
    candidate_content_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT candidate_reviews_action_check
        CHECK (action IN ('approve_for_draft', 'reject')),
    CONSTRAINT candidate_reviews_reason_check CHECK (char_length(reason) BETWEEN 1 AND 2000),
    CONSTRAINT candidate_reviews_revision_check CHECK (candidate_revision BETWEEN 0 AND 1000000),
    CONSTRAINT candidate_reviews_content_hash_check
        CHECK (candidate_content_hash ~ '^[a-f0-9]{64}$')
);

CREATE INDEX candidate_reviews_candidate_time_idx
    ON governance.candidate_reviews (candidate_id, created_at DESC, id);

CREATE TABLE governance.promotion_drafts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    draft_key text NOT NULL UNIQUE,
    candidate_id uuid NOT NULL UNIQUE REFERENCES quarantine.candidates(id) ON DELETE RESTRICT,
    owning_department_id uuid NOT NULL REFERENCES identity.departments(id) ON DELETE RESTRICT,
    architect_principal_id uuid NOT NULL REFERENCES identity.principals(id) ON DELETE RESTRICT,
    asset_type text NOT NULL,
    title text NOT NULL,
    draft_payload jsonb NOT NULL,
    content_hash text NOT NULL,
    review_status text NOT NULL DEFAULT 'draft',
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT promotion_drafts_key_check
        CHECK (draft_key ~ '^draft:[a-z0-9][a-z0-9_.-]{1,119}$'),
    CONSTRAINT promotion_drafts_type_check
        CHECK (asset_type IN ('prompt', 'workflow', 'agent', 'decision_pattern', 'best_practice')),
    CONSTRAINT promotion_drafts_payload_check
        CHECK (jsonb_typeof(draft_payload) = 'object' AND octet_length(draft_payload::text) <= 32768),
    CONSTRAINT promotion_drafts_hash_check CHECK (content_hash ~ '^[a-f0-9]{64}$'),
    CONSTRAINT promotion_drafts_status_check CHECK (review_status = 'draft')
);

CREATE TABLE governance.promotion_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idempotency_key uuid NOT NULL UNIQUE,
    candidate_id uuid NOT NULL REFERENCES quarantine.candidates(id) ON DELETE RESTRICT,
    draft_id uuid NOT NULL REFERENCES governance.promotion_drafts(id) ON DELETE RESTRICT,
    architect_principal_id uuid NOT NULL REFERENCES identity.principals(id) ON DELETE RESTRICT,
    event_type text NOT NULL,
    from_status text NOT NULL,
    to_status text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT promotion_events_type_check CHECK (event_type = 'promoted_to_draft'),
    CONSTRAINT promotion_events_status_check
        CHECK (from_status = 'reviewed' AND to_status = 'promoted_to_draft')
);

CREATE INDEX promotion_events_candidate_time_idx
    ON governance.promotion_events (candidate_id, created_at, id);

CREATE OR REPLACE FUNCTION governance.record_candidate_review(
    p_candidate_id uuid,
    p_reviewer_principal_id uuid,
    p_action text,
    p_reason text,
    p_expected_revision integer
)
RETURNS TABLE (candidate_id uuid, status text, revision integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, identity, quarantine, governance
AS $function$
DECLARE
    candidate_row quarantine.candidates%ROWTYPE;
    next_status text;
BEGIN
    IF p_action NOT IN ('approve_for_draft', 'reject') THEN
        RAISE EXCEPTION 'invalid review action' USING ERRCODE = '22023';
    END IF;
    IF char_length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 1 AND 2000 THEN
        RAISE EXCEPTION 'invalid review reason' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO candidate_row
    FROM quarantine.candidates candidate
    WHERE candidate.id = p_candidate_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'candidate not found' USING ERRCODE = 'P0002';
    END IF;
    IF session_user = 'oam_operator_api'
       AND (
         identity.current_operator_principal_id() IS DISTINCT FROM p_reviewer_principal_id
         OR identity.current_operator_department_id() IS DISTINCT FROM candidate_row.owning_department_id
       ) THEN
        RAISE EXCEPTION 'database-bound reviewer identity mismatch' USING ERRCODE = '42501';
    END IF;
    IF candidate_row.revision <> p_expected_revision THEN
        RAISE EXCEPTION 'candidate revision conflict' USING ERRCODE = '40001';
    END IF;
    IF candidate_row.status <> 'review_pending' THEN
        RAISE EXCEPTION 'candidate is not reviewable' USING ERRCODE = '55000';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM identity.principals principal
        JOIN identity.department_memberships membership
          ON membership.principal_id = principal.id
         AND membership.department_id = candidate_row.owning_department_id
         AND membership.membership_role IN ('reviewer', 'architect')
         AND membership.status = 'active'
         AND membership.valid_from <= now()
         AND (membership.valid_to IS NULL OR membership.valid_to > now())
        JOIN identity.policy_assignments assignment
          ON assignment.assignment_scope = 'principal'
         AND assignment.principal_id = principal.id
         AND assignment.department_id = candidate_row.owning_department_id
         AND assignment.status = 'active'
         AND assignment.valid_from <= now()
         AND (assignment.valid_to IS NULL OR assignment.valid_to > now())
        JOIN identity.policy_templates template
          ON template.id = assignment.template_id
         AND template.status = 'active'
        JOIN identity.policy_template_rules rule
          ON rule.template_id = template.id
         AND rule.principal_kind = 'human'
         AND rule.permission_key = 'candidate.review'
         AND rule.effect = 'allow'
         AND rule.conditions = '{}'::jsonb
         AND (rule.membership_role IS NULL OR rule.membership_role = membership.membership_role)
        WHERE principal.id = p_reviewer_principal_id
          AND principal.principal_kind = 'human'
          AND principal.status = 'active'
          AND NOT EXISTS (
              SELECT 1 FROM identity.policy_template_rules deny_rule
              WHERE deny_rule.template_id = template.id
                AND deny_rule.principal_kind = 'human'
                AND deny_rule.permission_key = 'candidate.review'
                AND deny_rule.effect = 'deny'
          )
          AND NOT EXISTS (
              SELECT 1 FROM identity.explicit_permission_denials denial
              WHERE denial.principal_id = principal.id
                AND denial.department_id = candidate_row.owning_department_id
                AND denial.permission_key = 'candidate.review'
                AND denial.status = 'active'
                AND denial.valid_from <= now()
                AND (denial.valid_to IS NULL OR denial.valid_to > now())
          )
    ) THEN
        RAISE EXCEPTION 'active human reviewer membership required' USING ERRCODE = '42501';
    END IF;

    next_status := CASE p_action WHEN 'approve_for_draft' THEN 'reviewed' ELSE 'rejected' END;

    INSERT INTO governance.candidate_reviews (
        candidate_id,
        reviewer_principal_id,
        action,
        reason,
        candidate_revision,
        candidate_content_hash
    ) VALUES (
        p_candidate_id,
        p_reviewer_principal_id,
        p_action,
        btrim(p_reason),
        candidate_row.revision,
        candidate_row.content_hash
    );

    UPDATE quarantine.candidates candidate
    SET status = next_status,
        approved_content_hash = CASE
            WHEN p_action = 'approve_for_draft' THEN candidate.content_hash
            ELSE NULL
        END,
        revision = candidate.revision + 1,
        updated_at = now()
    WHERE candidate.id = p_candidate_id
    RETURNING candidate.id, candidate.status, candidate.revision
    INTO candidate_id, status, revision;

    IF p_action = 'approve_for_draft' THEN
        UPDATE quarantine.uploads upload
        SET status = 'approved_for_promotion', updated_at = now()
        WHERE upload.id = candidate_row.upload_id
          AND upload.status IN ('ready_for_review', 'approved_for_promotion')
          AND upload.submitted_by_principal_id = candidate_row.submitted_by_principal_id
          AND upload.owning_department_id = candidate_row.owning_department_id
          AND upload.sha256 = candidate_row.source_upload_sha256
          AND (upload.sha256, 'clean'::text) = (
              SELECT finding.content_sha256, finding.verdict
              FROM quarantine.scan_findings finding
              WHERE finding.upload_id = upload.id
              ORDER BY finding.scanned_at DESC, finding.created_at DESC, finding.id DESC
              LIMIT 1
          );
        IF NOT FOUND THEN
            RAISE EXCEPTION 'clean hash-verified upload required for approval' USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEXT;
END
$function$;

CREATE OR REPLACE FUNCTION governance.promote_candidate_to_draft(
    p_candidate_id uuid,
    p_architect_principal_id uuid,
    p_expected_revision integer,
    p_idempotency_key uuid
)
RETURNS TABLE (
    draft_id uuid,
    draft_key text,
    review_status text,
    candidate_revision integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, identity, quarantine, governance
AS $function$
DECLARE
    candidate_row quarantine.candidates%ROWTYPE;
    existing_event governance.promotion_events%ROWTYPE;
    existing_draft governance.promotion_drafts%ROWTYPE;
BEGIN
    SELECT * INTO candidate_row
    FROM quarantine.candidates candidate
    WHERE candidate.id = p_candidate_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'candidate not found' USING ERRCODE = 'P0002';
    END IF;
    IF session_user = 'oam_operator_api'
       AND (
         identity.current_operator_principal_id() IS DISTINCT FROM p_architect_principal_id
         OR identity.current_operator_department_id() IS DISTINCT FROM candidate_row.owning_department_id
       ) THEN
        RAISE EXCEPTION 'database-bound architect identity mismatch' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM identity.principals principal
        JOIN identity.department_memberships membership
          ON membership.principal_id = principal.id
         AND membership.department_id = candidate_row.owning_department_id
         AND membership.membership_role = 'architect'
         AND membership.status = 'active'
         AND membership.valid_from <= now()
         AND (membership.valid_to IS NULL OR membership.valid_to > now())
        JOIN identity.policy_assignments assignment
          ON assignment.assignment_scope = 'principal'
         AND assignment.principal_id = principal.id
         AND assignment.department_id = candidate_row.owning_department_id
         AND assignment.status = 'active'
         AND assignment.valid_from <= now()
         AND (assignment.valid_to IS NULL OR assignment.valid_to > now())
        JOIN identity.policy_templates template
          ON template.id = assignment.template_id
         AND template.status = 'active'
        JOIN identity.policy_template_rules rule
          ON rule.template_id = template.id
         AND rule.principal_kind = 'human'
         AND rule.permission_key = 'candidate.promote_as_draft'
         AND rule.effect = 'allow'
         AND rule.conditions = '{}'::jsonb
         AND (rule.membership_role IS NULL OR rule.membership_role = membership.membership_role)
        WHERE principal.id = p_architect_principal_id
          AND principal.principal_kind = 'human'
          AND principal.status = 'active'
          AND NOT EXISTS (
              SELECT 1 FROM identity.policy_template_rules deny_rule
              WHERE deny_rule.template_id = template.id
                AND deny_rule.principal_kind = 'human'
                AND deny_rule.permission_key = 'candidate.promote_as_draft'
                AND deny_rule.effect = 'deny'
          )
          AND NOT EXISTS (
              SELECT 1 FROM identity.explicit_permission_denials denial
              WHERE denial.principal_id = principal.id
                AND denial.department_id = candidate_row.owning_department_id
                AND denial.permission_key = 'candidate.promote_as_draft'
                AND denial.status = 'active'
                AND denial.valid_from <= now()
                AND (denial.valid_to IS NULL OR denial.valid_to > now())
          )
    ) THEN
        RAISE EXCEPTION 'active human architect membership required' USING ERRCODE = '42501';
    END IF;

    SELECT event.* INTO existing_event
    FROM governance.promotion_events event
    WHERE event.idempotency_key = p_idempotency_key;

    IF FOUND THEN
        IF existing_event.candidate_id <> p_candidate_id
           OR existing_event.architect_principal_id <> p_architect_principal_id THEN
            RAISE EXCEPTION 'idempotency key binding conflict' USING ERRCODE = '22023';
        END IF;

        SELECT * INTO existing_draft
        FROM governance.promotion_drafts draft
        WHERE draft.id = existing_event.draft_id;

        IF NOT FOUND
           OR existing_draft.candidate_id <> p_candidate_id
           OR existing_draft.architect_principal_id <> p_architect_principal_id
           OR candidate_row.status <> 'promoted_to_draft'
           OR candidate_row.revision <> p_expected_revision + 1
           OR candidate_row.approved_content_hash IS DISTINCT FROM candidate_row.content_hash
           OR existing_draft.content_hash IS DISTINCT FROM candidate_row.content_hash
           OR encode(digest(existing_draft.draft_payload::text, 'sha256'), 'hex')
                IS DISTINCT FROM existing_draft.content_hash THEN
            RAISE EXCEPTION 'idempotent promotion integrity check failed' USING ERRCODE = '55000';
        END IF;

        draft_id := existing_draft.id;
        draft_key := existing_draft.draft_key;
        review_status := existing_draft.review_status;
        candidate_revision := candidate_row.revision;
        RETURN NEXT;
        RETURN;
    END IF;

    IF candidate_row.revision <> p_expected_revision THEN
        RAISE EXCEPTION 'candidate revision conflict' USING ERRCODE = '40001';
    END IF;
    IF candidate_row.status <> 'reviewed' THEN
        RAISE EXCEPTION 'candidate is not approved for draft promotion' USING ERRCODE = '55000';
    END IF;
    IF candidate_row.approved_content_hash IS DISTINCT FROM candidate_row.content_hash THEN
        RAISE EXCEPTION 'candidate content changed after approval' USING ERRCODE = '55000';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM governance.candidate_reviews review
        WHERE review.candidate_id = candidate_row.id
          AND review.action = 'approve_for_draft'
          AND review.reviewer_principal_id <> p_architect_principal_id
          AND review.candidate_revision = candidate_row.revision - 1
          AND review.candidate_content_hash = candidate_row.content_hash
    ) THEN
        RAISE EXCEPTION 'independent reviewer approval required' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM quarantine.candidate_evidence evidence
        WHERE evidence.candidate_id = candidate_row.id
          AND evidence.upload_id = candidate_row.upload_id
    ) THEN
        RAISE EXCEPTION 'candidate evidence required' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM quarantine.uploads upload
        WHERE upload.id = candidate_row.upload_id
          AND upload.status = 'approved_for_promotion'
          AND upload.submitted_by_principal_id = candidate_row.submitted_by_principal_id
          AND upload.owning_department_id = candidate_row.owning_department_id
          AND upload.sha256 = candidate_row.source_upload_sha256
          AND (upload.sha256, 'clean'::text) = (
              SELECT finding.content_sha256, finding.verdict
              FROM quarantine.scan_findings finding
              WHERE finding.upload_id = upload.id
              ORDER BY finding.scanned_at DESC, finding.created_at DESC, finding.id DESC
              LIMIT 1
          )
    ) THEN
        RAISE EXCEPTION 'clean hash-verified upload approval required' USING ERRCODE = '23514';
    END IF;

    INSERT INTO governance.promotion_drafts (
        draft_key,
        candidate_id,
        owning_department_id,
        architect_principal_id,
        asset_type,
        title,
        draft_payload,
        content_hash,
        review_status
    ) VALUES (
        'draft:' || replace(candidate_row.candidate_key, 'candidate:', ''),
        candidate_row.id,
        candidate_row.owning_department_id,
        p_architect_principal_id,
        candidate_row.candidate_type,
        candidate_row.title,
        candidate_row.candidate_payload,
        candidate_row.content_hash,
        'draft'
    )
    RETURNING id, promotion_drafts.draft_key, promotion_drafts.review_status
    INTO draft_id, draft_key, review_status;

    UPDATE quarantine.candidates candidate
    SET status = 'promoted_to_draft',
        revision = candidate.revision + 1,
        updated_at = now()
    WHERE candidate.id = candidate_row.id
    RETURNING candidate.revision INTO candidate_revision;

    INSERT INTO governance.promotion_events (
        idempotency_key,
        candidate_id,
        draft_id,
        architect_principal_id,
        event_type,
        from_status,
        to_status
    ) VALUES (
        p_idempotency_key,
        candidate_row.id,
        draft_id,
        p_architect_principal_id,
        'promoted_to_draft',
        'reviewed',
        'promoted_to_draft'
    );

    UPDATE quarantine.uploads upload
    SET status = 'promoted', updated_at = now()
    WHERE upload.id = candidate_row.upload_id;

    RETURN NEXT;
END
$function$;

REVOKE ALL ON FUNCTION governance.record_candidate_review(uuid, uuid, text, text, integer)
    FROM PUBLIC;
REVOKE ALL ON FUNCTION governance.promote_candidate_to_draft(uuid, uuid, integer, uuid)
    FROM PUBLIC;

RESET ROLE;

SET LOCAL ROLE oam_audit_owner;

CREATE TABLE audit.security_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_key uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    event_type text NOT NULL,
    actor_principal_id uuid,
    department_id uuid,
    workload_role name NOT NULL,
    resource_type text NOT NULL,
    resource_key text NOT NULL,
    outcome text NOT NULL,
    correlation_key text,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT security_events_type_check
        CHECK (event_type ~ '^[a-z][a-z0-9_.:-]{2,119}$'),
    CONSTRAINT security_events_resource_check
        CHECK (resource_type ~ '^[a-z][a-z0-9_.:-]{1,79}$' AND char_length(resource_key) BETWEEN 1 AND 500),
    CONSTRAINT security_events_outcome_check
        CHECK (outcome IN ('allowed', 'denied', 'failed', 'recorded')),
    CONSTRAINT security_events_correlation_check
        CHECK (correlation_key IS NULL OR char_length(correlation_key) BETWEEN 1 AND 200),
    CONSTRAINT security_events_payload_check
        CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 32768)
);

CREATE INDEX security_events_resource_time_idx
    ON audit.security_events (resource_type, resource_key, occurred_at DESC, id DESC);

CREATE INDEX security_events_actor_time_idx
    ON audit.security_events (actor_principal_id, occurred_at DESC, id DESC);

CREATE INDEX security_events_department_time_idx
    ON audit.security_events (department_id, occurred_at DESC, id DESC);

CREATE OR REPLACE FUNCTION audit.record_public_interaction(
    p_event_type text,
    p_resource_type text,
    p_resource_key text,
    p_outcome text,
    p_correlation_key text,
    p_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, audit
AS $function$
DECLARE
    inserted_key uuid;
BEGIN
    IF p_event_type NOT IN ('public_retrieval', 'public_demo_session', 'public_rate_limit') THEN
        RAISE EXCEPTION 'unsupported public event type' USING ERRCODE = '22023';
    END IF;
    IF p_resource_type NOT IN ('continuity_query', 'capability_search', 'capability_assist', 'demo_session') THEN
        RAISE EXCEPTION 'unsupported public resource type' USING ERRCODE = '22023';
    END IF;
    IF char_length(coalesce(p_resource_key, '')) NOT BETWEEN 1 AND 200 THEN
        RAISE EXCEPTION 'invalid public resource key' USING ERRCODE = '22023';
    END IF;
    IF p_outcome NOT IN ('allowed', 'denied', 'failed', 'recorded') THEN
        RAISE EXCEPTION 'invalid event outcome' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object'
       OR octet_length(coalesce(p_payload, '{}'::jsonb)::text) > 8192 THEN
        RAISE EXCEPTION 'invalid public event payload' USING ERRCODE = '22023';
    END IF;

    INSERT INTO audit.security_events (
        event_type,
        actor_principal_id,
        workload_role,
        resource_type,
        resource_key,
        outcome,
        correlation_key,
        payload
    ) VALUES (
        p_event_type,
        NULL,
        session_user,
        p_resource_type,
        p_resource_key,
        p_outcome,
        p_correlation_key,
        coalesce(p_payload, '{}'::jsonb)
    )
    RETURNING event_key INTO inserted_key;

    RETURN inserted_key;
END
$function$;

CREATE OR REPLACE FUNCTION audit.record_broker_interaction(
    p_actor_principal_id uuid,
    p_outcome text,
    p_resource_key text,
    p_correlation_key text,
    p_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, audit
AS $function$
DECLARE
    inserted_key uuid;
BEGIN
    IF p_outcome NOT IN ('allowed', 'denied', 'failed') THEN
        RAISE EXCEPTION 'invalid broker event outcome' USING ERRCODE = '22023';
    END IF;
    IF char_length(coalesce(p_resource_key, '')) NOT BETWEEN 1 AND 200 THEN
        RAISE EXCEPTION 'invalid broker resource key' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object'
       OR octet_length(coalesce(p_payload, '{}'::jsonb)::text) > 8192 THEN
        RAISE EXCEPTION 'invalid broker event payload' USING ERRCODE = '22023';
    END IF;

    INSERT INTO audit.security_events (
        event_type,
        actor_principal_id,
        workload_role,
        resource_type,
        resource_key,
        outcome,
        correlation_key,
        payload
    ) VALUES (
        'broker.capability_retrieval',
        p_actor_principal_id,
        session_user,
        'capability_task',
        p_resource_key,
        p_outcome,
        p_correlation_key,
        coalesce(p_payload, '{}'::jsonb)
    )
    RETURNING event_key INTO inserted_key;

    RETURN inserted_key;
END
$function$;

REVOKE ALL ON TABLE audit.security_events FROM PUBLIC;
REVOKE ALL ON FUNCTION audit.record_public_interaction(text, text, text, text, text, jsonb)
    FROM PUBLIC;
REVOKE ALL ON FUNCTION audit.record_broker_interaction(uuid, text, text, text, jsonb)
    FROM PUBLIC;

RESET ROLE;

-- The view owner has no login and is never granted to a runtime principal. It
-- can read only the source tables needed to build fixed-scope public views.
GRANT USAGE ON SCHEMA memory TO oam_public_view_owner;
GRANT SELECT ON TABLE
    memory.threads,
    memory.thread_turns,
    memory.observations,
    memory.facts,
    memory.fact_supersessions,
    memory.thread_summaries,
    memory.reflections,
    memory.capability_packs,
    memory.capability_assets,
    memory.capability_asset_versions,
    memory.capability_asset_evidence,
    memory.capability_asset_relations,
    memory.capability_tasks,
    memory.capability_task_recommendations,
    memory.capability_analytics_signals
TO oam_public_view_owner;

SET LOCAL ROLE oam_public_view_owner;

CREATE OR REPLACE VIEW oam_public.continuity_threads
WITH (security_barrier = true)
AS
SELECT thread.*
FROM memory.threads thread
WHERE thread.brand_key = 'sell_systems_hackathon_demo'
  AND thread.thread_key = 'oam_public_demo_v1'
  AND thread.status = 'active'
  AND thread.metadata @> jsonb_build_object(
      'corpus', 'public_demo'::text,
      'visibility', 'public_safe'::text
  );

CREATE OR REPLACE VIEW oam_public.continuity_turns
WITH (security_barrier = true)
AS
SELECT turn.*
FROM memory.thread_turns turn
JOIN oam_public.continuity_threads thread ON thread.id = turn.thread_id;

CREATE OR REPLACE VIEW oam_public.continuity_observations
WITH (security_barrier = true)
AS
SELECT observation.*
FROM memory.observations observation
JOIN oam_public.continuity_threads thread ON thread.id = observation.thread_id
WHERE observation.is_active = true;

CREATE OR REPLACE VIEW oam_public.continuity_facts
WITH (security_barrier = true)
AS
SELECT fact.*
FROM memory.facts fact
JOIN oam_public.continuity_threads thread ON thread.id = fact.thread_id;

CREATE OR REPLACE VIEW oam_public.continuity_fact_supersessions
WITH (security_barrier = true)
AS
SELECT supersession.*
FROM memory.fact_supersessions supersession
JOIN oam_public.continuity_facts previous_fact
  ON previous_fact.id = supersession.previous_fact_id
JOIN oam_public.continuity_facts new_fact
  ON new_fact.id = supersession.new_fact_id;

CREATE OR REPLACE VIEW oam_public.continuity_summaries
WITH (security_barrier = true)
AS
SELECT summary.*
FROM memory.thread_summaries summary
JOIN oam_public.continuity_threads thread ON thread.id = summary.thread_id
WHERE summary.is_active = true;

CREATE OR REPLACE VIEW oam_public.continuity_reflections
WITH (security_barrier = true)
AS
SELECT reflection.*
FROM memory.reflections reflection
JOIN oam_public.continuity_threads thread ON thread.id = reflection.thread_id
WHERE reflection.is_active = true;

CREATE OR REPLACE VIEW oam_public.capability_packs
WITH (security_barrier = true)
AS
SELECT pack.*
FROM memory.capability_packs pack
JOIN memory.threads evidence_thread ON evidence_thread.id = pack.evidence_thread_id
WHERE pack.pack_key = 'aihackathon_public_safe_asset_pack_2026_07_10'
  AND pack.brand_key = 'sell_systems_hackathon_demo'
  AND pack.corpus = 'public_demo'
  AND pack.source_classification = 'public_safe'
  AND pack.publication_status = 'active'
  AND evidence_thread.thread_key = 'oam_public_capability_assets_v1'
  AND evidence_thread.brand_key = pack.brand_key
  AND evidence_thread.status = 'active'
  AND evidence_thread.metadata @> jsonb_build_object(
      'corpus', 'public_demo'::text,
      'visibility', 'public_safe'::text,
      'source_classification', 'public_safe'::text,
      'review_status', 'approved_for_public_demo'::text
  );

CREATE OR REPLACE VIEW oam_public.capability_assets
WITH (security_barrier = true)
AS
SELECT asset.*
FROM memory.capability_assets asset
JOIN oam_public.capability_packs pack ON pack.id = asset.pack_id
WHERE asset.review_status = 'approved'
  AND asset.metadata @> '{"public_demo_eligible":true,"publication_decision":"approved_for_public_demo","source_classification":"public_safe"}'::jsonb;

CREATE OR REPLACE VIEW oam_public.capability_asset_versions
WITH (security_barrier = true)
AS
SELECT version.*
FROM memory.capability_asset_versions version
JOIN oam_public.capability_assets asset
  ON asset.pack_id = version.pack_id
 AND asset.id = version.asset_id
WHERE version.is_current = true;

CREATE OR REPLACE VIEW oam_public.capability_asset_evidence
WITH (security_barrier = true)
AS
SELECT evidence.*
FROM memory.capability_asset_evidence evidence
JOIN oam_public.capability_assets asset
  ON asset.pack_id = evidence.pack_id
 AND asset.id = evidence.asset_id
JOIN oam_public.capability_packs pack ON pack.id = evidence.pack_id
JOIN memory.observations observation ON observation.id = evidence.observation_id
JOIN memory.thread_turns turn ON turn.id = evidence.turn_id
WHERE observation.thread_id = pack.evidence_thread_id
  AND turn.thread_id = pack.evidence_thread_id
  AND observation.turn_id = turn.id
  AND observation.is_active = true
  AND observation.observation_kind = 'capability_source_narrative';

CREATE OR REPLACE VIEW oam_public.capability_source_evidence
WITH (security_barrier = true)
AS
SELECT
    evidence.pack_id,
    evidence.asset_id,
    evidence.observation_id,
    turn.source_turn_id,
    turn.actor_role,
    COALESCE(observation.metadata->>'context_scope', observation.subject_key) AS context_scope,
    COALESCE(turn.sent_at, observation.observed_at) AS occurred_at,
    left(observation.observation_text, 1600) AS evidence_text
FROM oam_public.capability_asset_evidence evidence
JOIN memory.observations observation ON observation.id = evidence.observation_id
JOIN memory.thread_turns turn ON turn.id = evidence.turn_id;

CREATE OR REPLACE VIEW oam_public.capability_asset_relations
WITH (security_barrier = true)
AS
SELECT relation.*
FROM memory.capability_asset_relations relation
JOIN oam_public.capability_assets source_asset
  ON source_asset.pack_id = relation.pack_id
 AND source_asset.id = relation.source_asset_id
JOIN oam_public.capability_assets target_asset
  ON target_asset.pack_id = relation.pack_id
 AND target_asset.id = relation.target_asset_id;

CREATE OR REPLACE VIEW oam_public.capability_tasks
WITH (security_barrier = true)
AS
SELECT task.*
FROM memory.capability_tasks task
JOIN oam_public.capability_packs pack ON pack.id = task.pack_id;

CREATE OR REPLACE VIEW oam_public.capability_task_recommendations
WITH (security_barrier = true)
AS
SELECT recommendation.*
FROM memory.capability_task_recommendations recommendation
JOIN oam_public.capability_tasks task
  ON task.pack_id = recommendation.pack_id
 AND task.id = recommendation.task_id
JOIN oam_public.capability_assets asset
  ON asset.pack_id = recommendation.pack_id
 AND asset.id = recommendation.asset_id;

CREATE OR REPLACE VIEW oam_public.capability_analytics_signals
WITH (security_barrier = true)
AS
SELECT signal.*
FROM memory.capability_analytics_signals signal
JOIN oam_public.capability_packs pack ON pack.id = signal.pack_id;

RESET ROLE;

REVOKE ALL ON SCHEMA identity, quarantine, governance, audit, oam_public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA identity, quarantine, governance, audit, oam_public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA identity, quarantine, governance, audit FROM PUBLIC;

GRANT USAGE ON SCHEMA oam_public TO oam_public_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA oam_public TO oam_public_runtime;
GRANT USAGE ON SCHEMA audit TO oam_public_runtime;
GRANT EXECUTE ON FUNCTION audit.record_public_interaction(text, text, text, text, text, jsonb)
    TO oam_public_runtime;

GRANT USAGE ON SCHEMA identity, governance, oam_public, audit TO oam_broker_runtime;
GRANT SELECT ON TABLE
    identity.departments,
    identity.principals,
    identity.department_memberships,
    identity.principal_links,
    identity.runtime_bindings,
    identity.broker_credentials,
    identity.provisioning_jobs,
    identity.policy_assignments,
    identity.explicit_permission_denials,
    identity.policy_templates,
    identity.policy_template_rules,
    governance.capability_grants
TO oam_broker_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA oam_public TO oam_broker_runtime;
GRANT EXECUTE ON FUNCTION audit.record_broker_interaction(uuid, text, text, text, jsonb)
    TO oam_broker_runtime;

GRANT USAGE ON SCHEMA identity, quarantine, governance, audit TO oam_operator_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA identity, quarantine, governance
    TO oam_operator_runtime;
REVOKE ALL ON TABLE identity.operator_context_credentials
    FROM oam_operator_runtime, oam_broker_runtime, oam_public_runtime,
         oam_reviewer_runtime, oam_promoter_runtime;
GRANT INSERT, UPDATE ON TABLE
    identity.principals,
    identity.department_memberships,
    identity.principal_links,
    identity.runtime_bindings,
    identity.broker_credentials,
    identity.policy_assignments,
    identity.explicit_permission_denials,
    identity.provisioning_jobs,
    identity.provisioning_events,
    identity.proof_runs,
    quarantine.uploads,
    quarantine.scan_findings,
    quarantine.candidate_evidence,
    governance.capability_grants
TO oam_operator_runtime;
REVOKE INSERT, UPDATE, DELETE ON TABLE
    identity.departments,
    identity.policy_templates,
    identity.policy_template_rules
FROM oam_operator_runtime;
GRANT INSERT ON TABLE quarantine.candidates TO oam_operator_runtime;
REVOKE UPDATE ON TABLE quarantine.candidates FROM oam_operator_runtime;
GRANT SELECT, INSERT ON TABLE audit.security_events TO oam_operator_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA identity, quarantine, governance, audit
    TO oam_operator_runtime;
GRANT EXECUTE ON FUNCTION governance.record_candidate_review(uuid, uuid, text, text, integer)
    TO oam_operator_runtime;
GRANT EXECUTE ON FUNCTION governance.promote_candidate_to_draft(uuid, uuid, integer, uuid)
    TO oam_operator_runtime;

GRANT USAGE ON SCHEMA identity, quarantine, governance TO oam_reviewer_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA identity, quarantine, governance TO oam_reviewer_runtime;
GRANT EXECUTE ON FUNCTION governance.record_candidate_review(uuid, uuid, text, text, integer)
    TO oam_reviewer_runtime;

GRANT USAGE ON SCHEMA identity, quarantine, governance TO oam_promoter_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA identity, quarantine, governance TO oam_promoter_runtime;
GRANT EXECUTE ON FUNCTION governance.promote_candidate_to_draft(uuid, uuid, integer, uuid)
    TO oam_promoter_runtime;

REVOKE ALL ON TABLE identity.operator_context_credentials
    FROM oam_operator_runtime, oam_broker_runtime, oam_public_runtime,
         oam_reviewer_runtime, oam_promoter_runtime;

-- Public runtime must have no canonical-memory privilege even if this migration
-- is re-run after unrelated grants were introduced.
REVOKE ALL ON SCHEMA memory FROM oam_public_runtime, oam_public_api;
REVOKE ALL ON ALL TABLES IN SCHEMA memory FROM oam_public_runtime, oam_public_api;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA memory FROM oam_public_runtime, oam_public_api;

COMMIT;
