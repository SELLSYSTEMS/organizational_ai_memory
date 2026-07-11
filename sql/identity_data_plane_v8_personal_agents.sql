\set ON_ERROR_STOP on

-- Personal employee workspaces and one-to-one personal agents. This migration
-- is additive: private employee context remains outside canonical memory and
-- can reach organizational memory only through the existing quarantine path.

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('organizational-ai-memory:identity-data-plane:v8'));

DO $preconditions$
BEGIN
    IF to_regclass('identity.principals') IS NULL
       OR to_regclass('identity.operator_context_credentials') IS NULL
       OR to_regclass('governance.capability_grants') IS NULL
       OR to_regclass('audit.security_events') IS NULL THEN
        RAISE EXCEPTION 'identity data plane v7 must exist before v8';
    END IF;
END
$preconditions$;

DO $roles$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oam_personal_memory_owner') THEN
        CREATE ROLE oam_personal_memory_owner
            NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oam_employee_runtime') THEN
        CREATE ROLE oam_employee_runtime
            NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oam_employee_api') THEN
        -- Deployment provisions LOGIN and a password separately. Keeping the
        -- migration credential-free also makes fresh databases fail closed.
        CREATE ROLE oam_employee_api
            NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    END IF;
END
$roles$;

ALTER ROLE oam_personal_memory_owner
    NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE oam_employee_runtime
    NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE oam_employee_api
    INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

GRANT oam_employee_runtime TO oam_employee_api;
REVOKE oam_operator_runtime, oam_broker_runtime, oam_public_runtime
    FROM oam_employee_api;

GRANT USAGE ON SCHEMA identity TO oam_employee_runtime;

CREATE SCHEMA IF NOT EXISTS personal AUTHORIZATION oam_personal_memory_owner;
REVOKE ALL ON SCHEMA personal FROM PUBLIC;

SET LOCAL ROLE oam_security_owner;

CREATE TABLE IF NOT EXISTS identity.employee_personal_agents (
    human_principal_id uuid PRIMARY KEY
        REFERENCES identity.principals(id) ON DELETE RESTRICT,
    agent_principal_id uuid NOT NULL UNIQUE
        REFERENCES identity.principals(id) ON DELETE RESTRICT,
    department_id uuid NOT NULL
        REFERENCES identity.departments(id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'draft',
    created_by_principal_id uuid NOT NULL
        REFERENCES identity.principals(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    activated_at timestamptz,
    suspended_at timestamptz,
    CONSTRAINT employee_personal_agents_distinct_check
        CHECK (human_principal_id <> agent_principal_id),
    CONSTRAINT employee_personal_agents_status_check
        CHECK (status IN ('draft', 'active', 'suspended', 'retired')),
    CONSTRAINT employee_personal_agents_lifecycle_check CHECK (
        (status = 'draft' AND activated_at IS NULL AND suspended_at IS NULL)
        OR (status = 'active' AND activated_at IS NOT NULL AND suspended_at IS NULL)
        OR (status = 'suspended' AND suspended_at IS NOT NULL)
        OR status = 'retired'
    )
);

CREATE INDEX IF NOT EXISTS employee_personal_agents_department_status_idx
    ON identity.employee_personal_agents (department_id, status, human_principal_id);

CREATE TABLE IF NOT EXISTS identity.employee_workspace_credentials (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    token_sha256 text NOT NULL UNIQUE,
    human_principal_id uuid NOT NULL
        REFERENCES identity.principals(id) ON DELETE RESTRICT,
    department_id uuid NOT NULL
        REFERENCES identity.departments(id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'active',
    expires_at timestamptz NOT NULL,
    issued_by_principal_id uuid NOT NULL
        REFERENCES identity.principals(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz,
    revoked_at timestamptz,
    CONSTRAINT employee_workspace_credentials_hash_check
        CHECK (token_sha256 ~ '^[a-f0-9]{64}$'),
    CONSTRAINT employee_workspace_credentials_status_check
        CHECK (status IN ('active', 'revoked', 'expired')),
    CONSTRAINT employee_workspace_credentials_expiry_check
        CHECK (expires_at > created_at),
    CONSTRAINT employee_workspace_credentials_revocation_check CHECK (
        (status = 'revoked' AND revoked_at IS NOT NULL)
        OR (status <> 'revoked' AND revoked_at IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS employee_workspace_credentials_owner_status_idx
    ON identity.employee_workspace_credentials
       (human_principal_id, department_id, status, expires_at DESC);

CREATE OR REPLACE FUNCTION identity.enforce_employee_personal_agent_pair()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, identity
AS $function$
DECLARE
    human_kind text;
    agent_kind text;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.human_principal_id IS DISTINCT FROM OLD.human_principal_id
           OR NEW.agent_principal_id IS DISTINCT FROM OLD.agent_principal_id
           OR NEW.department_id IS DISTINCT FROM OLD.department_id
           OR NEW.created_by_principal_id IS DISTINCT FROM OLD.created_by_principal_id
           OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION 'personal agent identity binding is immutable' USING ERRCODE = '55000';
        END IF;
        IF OLD.status = 'retired' AND NEW.status IS DISTINCT FROM OLD.status THEN
            RAISE EXCEPTION 'retired personal agent binding is immutable' USING ERRCODE = '55000';
        END IF;
        IF OLD.status = 'draft' AND NEW.status NOT IN ('draft', 'active', 'suspended', 'retired')
           OR OLD.status = 'active' AND NEW.status NOT IN ('active', 'suspended', 'retired')
           OR OLD.status = 'suspended' AND NEW.status NOT IN ('suspended', 'active', 'retired') THEN
            RAISE EXCEPTION 'invalid personal agent lifecycle transition' USING ERRCODE = '55000';
        END IF;
    END IF;

    SELECT principal_kind INTO human_kind
    FROM identity.principals WHERE id = NEW.human_principal_id;
    SELECT principal_kind INTO agent_kind
    FROM identity.principals WHERE id = NEW.agent_principal_id;
    IF human_kind IS DISTINCT FROM 'human' OR agent_kind IS DISTINCT FROM 'agent' THEN
        RAISE EXCEPTION 'personal agent pair requires one human and one agent' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM identity.department_memberships membership
      WHERE membership.principal_id = NEW.human_principal_id
        AND membership.department_id = NEW.department_id
    ) OR NOT EXISTS (
      SELECT 1 FROM identity.department_memberships membership
      WHERE membership.principal_id = NEW.agent_principal_id
        AND membership.department_id = NEW.department_id
    ) THEN
        RAISE EXCEPTION 'personal agent pair requires same-department memberships' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM identity.department_memberships membership
      WHERE membership.principal_id = NEW.agent_principal_id
        AND membership.department_id <> NEW.department_id
    ) THEN
        RAISE EXCEPTION 'personal agent requires one authoritative department' USING ERRCODE = '23514';
    END IF;

    NEW.updated_at := now();
    IF NEW.status = 'active' AND NEW.activated_at IS NULL THEN NEW.activated_at := now(); END IF;
    IF NEW.status = 'active' THEN NEW.suspended_at := NULL; END IF;
    IF NEW.status = 'suspended' AND NEW.suspended_at IS NULL THEN NEW.suspended_at := now(); END IF;
    RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS employee_personal_agents_guard
    ON identity.employee_personal_agents;
CREATE TRIGGER employee_personal_agents_guard
BEFORE INSERT OR UPDATE ON identity.employee_personal_agents
FOR EACH ROW EXECUTE FUNCTION identity.enforce_employee_personal_agent_pair();

CREATE OR REPLACE FUNCTION identity.enforce_personal_agent_membership_department()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, identity
AS $function$
BEGIN
    IF EXISTS (
      SELECT 1
      FROM identity.employee_personal_agents pair
      WHERE pair.agent_principal_id = NEW.principal_id
        AND pair.department_id <> NEW.department_id
    ) THEN
        RAISE EXCEPTION 'personal agent membership must remain in its authoritative department'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS department_memberships_personal_agent_department_guard
    ON identity.department_memberships;
CREATE TRIGGER department_memberships_personal_agent_department_guard
BEFORE INSERT OR UPDATE OF principal_id, department_id
ON identity.department_memberships
FOR EACH ROW EXECUTE FUNCTION identity.enforce_personal_agent_membership_department();

-- Backfill the compatibility projection when this additive migration is
-- reapplied over pairs created by an earlier v8 revision. The pair remains the
-- authority; this row exists only for the generic physical provisioner path.
INSERT INTO identity.principal_links (
  source_principal_id, target_principal_id, link_kind, status, metadata
)
SELECT pair.human_principal_id, pair.agent_principal_id, 'linked_agent', 'active',
       jsonb_build_object(
         'permission_inheritance', false,
         'authority', 'employee_personal_agents',
         'compatibility_projection', true
       )
FROM identity.employee_personal_agents pair
WHERE pair.status IN ('draft', 'active', 'suspended')
ON CONFLICT (source_principal_id, target_principal_id, link_kind) DO UPDATE
SET status = 'active',
    metadata = identity.principal_links.metadata || EXCLUDED.metadata;

CREATE OR REPLACE FUNCTION identity.validate_active_employee_personal_agent_pair()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, identity
AS $function$
BEGIN
    IF NEW.status = 'active' AND NOT EXISTS (
      SELECT 1
      FROM identity.principals human
      JOIN identity.principals agent ON agent.id = NEW.agent_principal_id
      JOIN identity.departments department ON department.id = NEW.department_id
      JOIN identity.department_memberships human_membership
        ON human_membership.principal_id = human.id
       AND human_membership.department_id = department.id
       AND human_membership.status = 'active'
       AND human_membership.valid_from <= now()
       AND (human_membership.valid_to IS NULL OR human_membership.valid_to > now())
      JOIN identity.department_memberships agent_membership
        ON agent_membership.principal_id = agent.id
       AND agent_membership.department_id = department.id
       AND agent_membership.status = 'active'
       AND agent_membership.valid_from <= now()
       AND (agent_membership.valid_to IS NULL OR agent_membership.valid_to > now())
      WHERE human.id = NEW.human_principal_id
        AND human.principal_kind = 'human' AND human.status = 'active'
        AND agent.principal_kind = 'agent' AND agent.status = 'active'
        AND department.status = 'active'
    ) THEN
        RAISE EXCEPTION 'active personal agent pair requires active same-department identities'
            USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END
$function$;

DROP TRIGGER IF EXISTS employee_personal_agents_active_constraint
    ON identity.employee_personal_agents;
CREATE CONSTRAINT TRIGGER employee_personal_agents_active_constraint
AFTER INSERT OR UPDATE ON identity.employee_personal_agents
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION identity.validate_active_employee_personal_agent_pair();

CREATE OR REPLACE FUNCTION identity.current_employee_principal_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, identity
AS $function$
    SELECT credential.human_principal_id
    FROM identity.employee_workspace_credentials credential
    JOIN identity.employee_personal_agents pair
      ON pair.human_principal_id = credential.human_principal_id
     AND pair.department_id = credential.department_id
     AND pair.status = 'active'
    JOIN identity.principals human
      ON human.id = credential.human_principal_id
     AND human.principal_kind = 'human' AND human.status = 'active'
    JOIN identity.principals agent
      ON agent.id = pair.agent_principal_id
     AND agent.principal_kind = 'agent' AND agent.status = 'active'
    JOIN identity.departments department
      ON department.id = credential.department_id AND department.status = 'active'
    JOIN identity.department_memberships membership
      ON membership.principal_id = human.id
     AND membership.department_id = department.id
     AND membership.status = 'active'
     AND membership.valid_from <= now()
     AND (membership.valid_to IS NULL OR membership.valid_to > now())
    WHERE credential.token_sha256 = current_setting('oam.employee_context_sha256', true)
      AND credential.status = 'active' AND credential.expires_at > now()
      AND session_user = 'oam_employee_api'
    LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION identity.current_employee_department_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, identity
AS $function$
    SELECT credential.department_id
    FROM identity.employee_workspace_credentials credential
    WHERE credential.token_sha256 = current_setting('oam.employee_context_sha256', true)
      AND credential.status = 'active' AND credential.expires_at > now()
      AND credential.human_principal_id = identity.current_employee_principal_id()
    LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION identity.current_employee_agent_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, identity
AS $function$
    SELECT pair.agent_principal_id
    FROM identity.employee_personal_agents pair
    WHERE pair.human_principal_id = identity.current_employee_principal_id()
      AND pair.department_id = identity.current_employee_department_id()
      AND pair.status = 'active'
    LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION identity.personal_agent_pair_is_active(
    p_human_principal_id uuid,
    p_agent_principal_id uuid,
    p_department_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, identity
AS $function$
    SELECT session_user IN ('oam_employee_api', 'oam_broker_api')
       AND EXISTS (
         SELECT 1
         FROM identity.employee_personal_agents pair
         JOIN identity.principals human
           ON human.id = pair.human_principal_id
          AND human.principal_kind = 'human' AND human.status = 'active'
         JOIN identity.principals agent
           ON agent.id = pair.agent_principal_id
          AND agent.principal_kind = 'agent' AND agent.status = 'active'
         JOIN identity.departments department
           ON department.id = pair.department_id AND department.status = 'active'
         JOIN identity.department_memberships human_membership
           ON human_membership.principal_id = human.id
          AND human_membership.department_id = department.id
          AND human_membership.status = 'active'
          AND human_membership.valid_from <= now()
          AND (human_membership.valid_to IS NULL OR human_membership.valid_to > now())
         JOIN identity.department_memberships agent_membership
           ON agent_membership.principal_id = agent.id
          AND agent_membership.department_id = department.id
          AND agent_membership.status = 'active'
          AND agent_membership.valid_from <= now()
          AND (agent_membership.valid_to IS NULL OR agent_membership.valid_to > now())
         WHERE pair.human_principal_id = p_human_principal_id
           AND pair.agent_principal_id = p_agent_principal_id
           AND pair.department_id = p_department_id
           AND pair.status = 'active'
       )
$function$;

REVOKE ALL ON FUNCTION identity.personal_agent_pair_is_active(uuid, uuid, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION identity.establish_employee_context(p_token_sha256 text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, identity
AS $function$
BEGIN
    IF session_user <> 'oam_employee_api'
       OR p_token_sha256 !~ '^[a-f0-9]{64}$'
       OR NOT EXISTS (
         SELECT 1
         FROM identity.employee_workspace_credentials credential
         JOIN identity.employee_personal_agents pair
           ON pair.human_principal_id = credential.human_principal_id
          AND pair.department_id = credential.department_id
          AND pair.status = 'active'
         JOIN identity.principals human
           ON human.id = credential.human_principal_id
          AND human.principal_kind = 'human' AND human.status = 'active'
         JOIN identity.principals agent
           ON agent.id = pair.agent_principal_id
          AND agent.principal_kind = 'agent' AND agent.status = 'active'
         JOIN identity.departments department
           ON department.id = credential.department_id AND department.status = 'active'
         JOIN identity.department_memberships human_membership
           ON human_membership.principal_id = human.id
          AND human_membership.department_id = department.id
          AND human_membership.status = 'active'
          AND human_membership.valid_from <= now()
          AND (human_membership.valid_to IS NULL OR human_membership.valid_to > now())
         JOIN identity.department_memberships agent_membership
           ON agent_membership.principal_id = agent.id
          AND agent_membership.department_id = department.id
          AND agent_membership.status = 'active'
          AND agent_membership.valid_from <= now()
          AND (agent_membership.valid_to IS NULL OR agent_membership.valid_to > now())
         WHERE credential.token_sha256 = p_token_sha256
           AND credential.status = 'active' AND credential.expires_at > now()
       ) THEN
        RAISE EXCEPTION 'employee workspace authentication failed' USING ERRCODE = '28000';
    END IF;
    PERFORM set_config('oam.employee_context_sha256', p_token_sha256, true);
END
$function$;

ALTER TABLE identity.employee_personal_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.employee_personal_agents FORCE ROW LEVEL SECURITY;
ALTER TABLE identity.employee_workspace_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.employee_workspace_credentials FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS employee_personal_agents_owner ON identity.employee_personal_agents;
CREATE POLICY employee_personal_agents_owner ON identity.employee_personal_agents
    FOR ALL TO oam_security_owner USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS employee_personal_agents_operator ON identity.employee_personal_agents;
CREATE POLICY employee_personal_agents_operator ON identity.employee_personal_agents
    FOR ALL TO oam_operator_runtime
    USING (department_id = identity.current_operator_department_id())
    WITH CHECK (department_id = identity.current_operator_department_id());
DROP POLICY IF EXISTS employee_personal_agents_employee_read ON identity.employee_personal_agents;
CREATE POLICY employee_personal_agents_employee_read ON identity.employee_personal_agents
    FOR SELECT TO oam_employee_runtime
    USING (human_principal_id = identity.current_employee_principal_id());
DROP POLICY IF EXISTS employee_personal_agents_personal_owner_read
    ON identity.employee_personal_agents;
CREATE POLICY employee_personal_agents_personal_owner_read
    ON identity.employee_personal_agents
    FOR SELECT TO oam_personal_memory_owner USING (true);

DROP POLICY IF EXISTS employee_workspace_credentials_owner
    ON identity.employee_workspace_credentials;
CREATE POLICY employee_workspace_credentials_owner ON identity.employee_workspace_credentials
    FOR ALL TO oam_security_owner USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS principals_personal_employee_read ON identity.principals;
CREATE POLICY principals_personal_employee_read ON identity.principals
    FOR SELECT TO oam_personal_memory_owner
    USING (
      session_user = 'oam_employee_api'
      AND id IN (
        identity.current_employee_principal_id(),
        identity.current_employee_agent_id()
      )
    );
DROP POLICY IF EXISTS departments_personal_employee_read ON identity.departments;
CREATE POLICY departments_personal_employee_read ON identity.departments
    FOR SELECT TO oam_personal_memory_owner
    USING (
      session_user = 'oam_employee_api'
      AND id = identity.current_employee_department_id()
    );
DROP POLICY IF EXISTS memberships_personal_employee_read ON identity.department_memberships;
CREATE POLICY memberships_personal_employee_read ON identity.department_memberships
    FOR SELECT TO oam_personal_memory_owner
    USING (
      session_user = 'oam_employee_api'
      AND department_id = identity.current_employee_department_id()
      AND principal_id IN (
        identity.current_employee_principal_id(),
        identity.current_employee_agent_id()
      )
    );

REVOKE ALL ON TABLE identity.employee_personal_agents,
    identity.employee_workspace_credentials FROM PUBLIC;
GRANT SELECT ON TABLE identity.employee_personal_agents TO oam_operator_runtime;
REVOKE INSERT, UPDATE, DELETE ON TABLE identity.employee_personal_agents
    FROM oam_operator_runtime;
GRANT SELECT ON TABLE identity.employee_personal_agents TO oam_employee_runtime;
REVOKE ALL ON TABLE identity.employee_workspace_credentials
    FROM oam_operator_runtime, oam_employee_runtime, oam_broker_runtime;

REVOKE ALL ON FUNCTION identity.current_employee_principal_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.current_employee_department_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.current_employee_agent_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.establish_employee_context(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.current_employee_principal_id(),
    identity.current_employee_department_id(),
    identity.current_employee_agent_id(),
    identity.establish_employee_context(text)
TO oam_employee_runtime;

RESET ROLE;

SET LOCAL ROLE oam_audit_owner;

CREATE OR REPLACE FUNCTION audit.record_employee_interaction(
    p_event_type text,
    p_actor_principal_id uuid,
    p_department_id uuid,
    p_resource_type text,
    p_resource_key text,
    p_outcome text,
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
    IF session_user NOT IN ('oam_employee_api', 'oam_operator_api', 'oam_broker_api') THEN
        RAISE EXCEPTION 'employee audit caller denied' USING ERRCODE = '42501';
    END IF;
    IF p_event_type NOT IN (
      'employee.workspace_authenticated', 'employee.onboarded',
      'employee.profile_updated', 'employee.profile_shared',
      'employee.profile_unshared', 'employee.memory_created',
      'employee.memory_updated', 'employee.memory_shared',
      'employee.memory_unshared', 'employee.agent_context_retrieved',
      'agent.personal_context_retrieved', 'agent.personal_context_denied'
    ) THEN
        RAISE EXCEPTION 'unsupported employee audit event' USING ERRCODE = '22023';
    END IF;
    IF p_resource_type NOT IN ('employee_workspace', 'employee_profile', 'personal_memory', 'personal_context')
       OR char_length(coalesce(p_resource_key, '')) NOT BETWEEN 1 AND 500
       OR p_outcome NOT IN ('allowed', 'denied', 'failed', 'recorded')
       OR jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object'
       OR octet_length(coalesce(p_payload, '{}'::jsonb)::text) > 16384 THEN
        RAISE EXCEPTION 'invalid employee audit event' USING ERRCODE = '22023';
    END IF;

    INSERT INTO audit.security_events (
      event_type, actor_principal_id, department_id, workload_role,
      resource_type, resource_key, outcome, payload
    ) VALUES (
      p_event_type, p_actor_principal_id, p_department_id, session_user,
      p_resource_type, p_resource_key, p_outcome, coalesce(p_payload, '{}'::jsonb)
    ) RETURNING event_key INTO inserted_key;
    RETURN inserted_key;
END
$function$;

REVOKE ALL ON FUNCTION audit.record_employee_interaction(text, uuid, uuid, text, text, text, jsonb)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit.record_employee_interaction(text, uuid, uuid, text, text, text, jsonb)
    TO oam_security_owner, oam_personal_memory_owner;

RESET ROLE;

GRANT USAGE ON SCHEMA audit TO oam_security_owner;
GRANT USAGE ON SCHEMA identity, audit TO oam_personal_memory_owner;
REVOKE USAGE ON SCHEMA governance FROM oam_personal_memory_owner;
GRANT SELECT ON TABLE identity.principals, identity.departments,
    identity.department_memberships, identity.employee_personal_agents
TO oam_personal_memory_owner;
REVOKE SELECT ON TABLE identity.employee_workspace_credentials,
    identity.broker_credentials, identity.runtime_bindings,
    identity.policy_templates, identity.policy_assignments,
    identity.provisioning_jobs, governance.capability_grants
FROM oam_personal_memory_owner;
GRANT REFERENCES ON TABLE identity.principals, identity.departments
    TO oam_personal_memory_owner;
GRANT EXECUTE ON FUNCTION identity.current_operator_principal_id(),
    identity.current_operator_department_id(),
    identity.current_employee_principal_id(),
    identity.current_employee_department_id(),
    identity.current_employee_agent_id(),
    identity.personal_agent_pair_is_active(uuid, uuid, uuid)
TO oam_personal_memory_owner;

SET LOCAL ROLE oam_personal_memory_owner;

CREATE TABLE IF NOT EXISTS personal.employee_profile_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    human_principal_id uuid NOT NULL REFERENCES identity.principals(id) ON DELETE RESTRICT,
    agent_principal_id uuid NOT NULL REFERENCES identity.principals(id) ON DELETE RESTRICT,
    department_id uuid NOT NULL REFERENCES identity.departments(id) ON DELETE RESTRICT,
    revision bigint NOT NULL,
    sharing_scope text NOT NULL DEFAULT 'owner_only',
    agent_shared boolean GENERATED ALWAYS AS (
      sharing_scope = 'owner_and_personal_agent'
    ) STORED,
    profile_payload jsonb NOT NULL,
    content_sha256 text GENERATED ALWAYS AS (
      encode(digest(profile_payload::text, 'sha256'), 'hex')
    ) STORED,
    created_by_principal_id uuid NOT NULL REFERENCES identity.principals(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (human_principal_id, revision),
    CONSTRAINT employee_profile_versions_revision_check CHECK (revision BETWEEN 1 AND 1000000),
    CONSTRAINT employee_profile_versions_sharing_check
      CHECK (sharing_scope IN ('owner_only', 'owner_and_personal_agent')),
    CONSTRAINT employee_profile_versions_payload_check CHECK (
      jsonb_typeof(profile_payload) = 'object'
      AND octet_length(profile_payload::text) BETWEEN 2 AND 32768
    )
);

-- Preserve rerun safety when an earlier draft of v8 already created the table.
ALTER TABLE personal.employee_profile_versions
    ADD COLUMN IF NOT EXISTS sharing_scope text NOT NULL DEFAULT 'owner_only';
ALTER TABLE personal.employee_profile_versions
    ADD COLUMN IF NOT EXISTS agent_shared boolean GENERATED ALWAYS AS (
      sharing_scope = 'owner_and_personal_agent'
    ) STORED;
ALTER TABLE personal.employee_profile_versions
    DROP CONSTRAINT IF EXISTS employee_profile_versions_sharing_check;
ALTER TABLE personal.employee_profile_versions
    ADD CONSTRAINT employee_profile_versions_sharing_check
      CHECK (sharing_scope IN ('owner_only', 'owner_and_personal_agent'));

CREATE INDEX IF NOT EXISTS employee_profile_versions_owner_revision_idx
    ON personal.employee_profile_versions (human_principal_id, revision DESC);

CREATE TABLE IF NOT EXISTS personal.employee_memory_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    human_principal_id uuid NOT NULL REFERENCES identity.principals(id) ON DELETE RESTRICT,
    agent_principal_id uuid NOT NULL REFERENCES identity.principals(id) ON DELETE RESTRICT,
    department_id uuid NOT NULL REFERENCES identity.departments(id) ON DELETE RESTRICT,
    memory_type text NOT NULL,
    sensitivity text NOT NULL,
    sharing_scope text NOT NULL DEFAULT 'owner_only',
    status text NOT NULL DEFAULT 'active',
    current_revision bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, human_principal_id, agent_principal_id, department_id),
    CONSTRAINT employee_memory_items_type_check
      CHECK (memory_type IN ('experience', 'lesson', 'preference', 'skill', 'decision', 'pattern')),
    CONSTRAINT employee_memory_items_sensitivity_check
      CHECK (sensitivity IN ('private', 'restricted')),
    CONSTRAINT employee_memory_items_sharing_check
      CHECK (sharing_scope IN ('owner_only', 'owner_and_personal_agent')),
    CONSTRAINT employee_memory_items_restricted_check
      CHECK (sensitivity <> 'restricted' OR sharing_scope = 'owner_only'),
    CONSTRAINT employee_memory_items_status_check CHECK (status IN ('active', 'retired')),
    CONSTRAINT employee_memory_items_revision_check CHECK (current_revision BETWEEN 1 AND 1000000)
);

CREATE INDEX IF NOT EXISTS employee_memory_items_owner_status_idx
    ON personal.employee_memory_items (human_principal_id, status, updated_at DESC, id);
CREATE INDEX IF NOT EXISTS employee_memory_items_agent_shared_idx
    ON personal.employee_memory_items (agent_principal_id, status, sharing_scope, updated_at DESC, id);

CREATE TABLE IF NOT EXISTS personal.employee_memory_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    memory_id uuid NOT NULL,
    human_principal_id uuid NOT NULL,
    agent_principal_id uuid NOT NULL,
    department_id uuid NOT NULL,
    revision bigint NOT NULL,
    memory_payload jsonb NOT NULL,
    content_sha256 text GENERATED ALWAYS AS (
      encode(digest(memory_payload::text, 'sha256'), 'hex')
    ) STORED,
    created_by_principal_id uuid NOT NULL REFERENCES identity.principals(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (memory_id, revision),
    CONSTRAINT employee_memory_versions_item_fkey FOREIGN KEY (
      memory_id, human_principal_id, agent_principal_id, department_id
    ) REFERENCES personal.employee_memory_items (
      id, human_principal_id, agent_principal_id, department_id
    ) ON DELETE RESTRICT,
    CONSTRAINT employee_memory_versions_revision_check CHECK (revision BETWEEN 1 AND 1000000),
    CONSTRAINT employee_memory_versions_payload_check CHECK (
      jsonb_typeof(memory_payload) = 'object'
      AND octet_length(memory_payload::text) BETWEEN 2 AND 32768
    )
);

CREATE INDEX IF NOT EXISTS employee_memory_versions_item_revision_idx
    ON personal.employee_memory_versions (memory_id, revision DESC);

CREATE TABLE IF NOT EXISTS personal.employee_memory_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_key uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    human_principal_id uuid NOT NULL REFERENCES identity.principals(id) ON DELETE RESTRICT,
    agent_principal_id uuid NOT NULL REFERENCES identity.principals(id) ON DELETE RESTRICT,
    department_id uuid NOT NULL REFERENCES identity.departments(id) ON DELETE RESTRICT,
    memory_id uuid REFERENCES personal.employee_memory_items(id) ON DELETE RESTRICT,
    event_type text NOT NULL,
    from_revision bigint,
    to_revision bigint,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT employee_memory_events_type_check CHECK (
      event_type IN (
        'profile_updated', 'profile_shared', 'profile_unshared',
        'memory_created', 'memory_updated', 'memory_shared', 'memory_unshared'
      )
    ),
    CONSTRAINT employee_memory_events_revision_check CHECK (
      (from_revision IS NULL OR from_revision BETWEEN 1 AND 1000000)
      AND (to_revision IS NULL OR to_revision BETWEEN 1 AND 1000000)
    ),
    CONSTRAINT employee_memory_events_payload_check CHECK (
      jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 8192
    )
);

ALTER TABLE personal.employee_memory_events
    DROP CONSTRAINT IF EXISTS employee_memory_events_type_check;
ALTER TABLE personal.employee_memory_events
    ADD CONSTRAINT employee_memory_events_type_check CHECK (
      event_type IN (
        'profile_updated', 'profile_shared', 'profile_unshared',
        'memory_created', 'memory_updated', 'memory_shared', 'memory_unshared'
      )
    );

CREATE INDEX IF NOT EXISTS employee_memory_events_owner_time_idx
    ON personal.employee_memory_events (human_principal_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION personal.reject_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
    RAISE EXCEPTION 'personal memory history is append-only' USING ERRCODE = '55000';
END
$function$;

DROP TRIGGER IF EXISTS employee_profile_versions_append_only
    ON personal.employee_profile_versions;
CREATE TRIGGER employee_profile_versions_append_only
BEFORE UPDATE OR DELETE ON personal.employee_profile_versions
FOR EACH ROW EXECUTE FUNCTION personal.reject_append_only_mutation();
DROP TRIGGER IF EXISTS employee_memory_versions_append_only
    ON personal.employee_memory_versions;
CREATE TRIGGER employee_memory_versions_append_only
BEFORE UPDATE OR DELETE ON personal.employee_memory_versions
FOR EACH ROW EXECUTE FUNCTION personal.reject_append_only_mutation();
DROP TRIGGER IF EXISTS employee_memory_events_append_only
    ON personal.employee_memory_events;
CREATE TRIGGER employee_memory_events_append_only
BEFORE UPDATE OR DELETE ON personal.employee_memory_events
FOR EACH ROW EXECUTE FUNCTION personal.reject_append_only_mutation();

ALTER TABLE personal.employee_profile_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal.employee_profile_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE personal.employee_memory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal.employee_memory_items FORCE ROW LEVEL SECURITY;
ALTER TABLE personal.employee_memory_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal.employee_memory_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE personal.employee_memory_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal.employee_memory_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS employee_profile_versions_owner ON personal.employee_profile_versions;
CREATE POLICY employee_profile_versions_owner ON personal.employee_profile_versions
    FOR ALL TO oam_personal_memory_owner USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS employee_profile_versions_self_read ON personal.employee_profile_versions;
CREATE POLICY employee_profile_versions_self_read ON personal.employee_profile_versions
    FOR SELECT TO oam_employee_runtime
    USING (human_principal_id = identity.current_employee_principal_id());
DROP POLICY IF EXISTS employee_memory_items_owner ON personal.employee_memory_items;
CREATE POLICY employee_memory_items_owner ON personal.employee_memory_items
    FOR ALL TO oam_personal_memory_owner USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS employee_memory_items_self_read ON personal.employee_memory_items;
CREATE POLICY employee_memory_items_self_read ON personal.employee_memory_items
    FOR SELECT TO oam_employee_runtime
    USING (human_principal_id = identity.current_employee_principal_id());
DROP POLICY IF EXISTS employee_memory_versions_owner ON personal.employee_memory_versions;
CREATE POLICY employee_memory_versions_owner ON personal.employee_memory_versions
    FOR ALL TO oam_personal_memory_owner USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS employee_memory_versions_self_read ON personal.employee_memory_versions;
CREATE POLICY employee_memory_versions_self_read ON personal.employee_memory_versions
    FOR SELECT TO oam_employee_runtime
    USING (human_principal_id = identity.current_employee_principal_id());
DROP POLICY IF EXISTS employee_memory_events_owner ON personal.employee_memory_events;
CREATE POLICY employee_memory_events_owner ON personal.employee_memory_events
    FOR ALL TO oam_personal_memory_owner USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS employee_memory_events_self_read ON personal.employee_memory_events;
CREATE POLICY employee_memory_events_self_read ON personal.employee_memory_events
    FOR SELECT TO oam_employee_runtime
    USING (human_principal_id = identity.current_employee_principal_id());

REVOKE ALL ON ALL TABLES IN SCHEMA personal FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA personal FROM PUBLIC;
GRANT USAGE ON SCHEMA personal TO oam_employee_runtime, oam_broker_runtime;
GRANT SELECT ON TABLE personal.employee_profile_versions,
    personal.employee_memory_items, personal.employee_memory_versions,
    personal.employee_memory_events
TO oam_employee_runtime;
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA personal
    FROM oam_employee_runtime, oam_broker_runtime;

CREATE OR REPLACE FUNCTION personal.valid_json_string_array(
    p_value jsonb,
    p_max_items integer,
    p_max_length integer
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
    SELECT jsonb_typeof(p_value) = 'array'
       AND jsonb_array_length(p_value) <= p_max_items
       AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_value) item
         WHERE jsonb_typeof(item) <> 'string'
            OR char_length(item #>> '{}') NOT BETWEEN 1 AND p_max_length
       )
$function$;

CREATE OR REPLACE FUNCTION personal.record_domain_event(
    p_event_type text,
    p_human_principal_id uuid,
    p_agent_principal_id uuid,
    p_department_id uuid,
    p_memory_id uuid,
    p_from_revision bigint,
    p_to_revision bigint,
    p_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, personal, audit
AS $function$
DECLARE
    audit_key uuid;
    audit_event_type text;
    resource_type text;
    resource_key text;
BEGIN
    IF p_event_type NOT IN (
      'profile_updated', 'profile_shared', 'profile_unshared',
      'memory_created', 'memory_updated', 'memory_shared', 'memory_unshared'
    ) THEN
        RAISE EXCEPTION 'unsupported personal event' USING ERRCODE = '22023';
    END IF;

    INSERT INTO personal.employee_memory_events (
      human_principal_id, agent_principal_id, department_id, memory_id,
      event_type, from_revision, to_revision, payload
    ) VALUES (
      p_human_principal_id, p_agent_principal_id, p_department_id, p_memory_id,
      p_event_type, p_from_revision, p_to_revision, coalesce(p_payload, '{}'::jsonb)
    );

    audit_event_type := 'employee.' || p_event_type;
    resource_type := CASE WHEN p_memory_id IS NULL THEN 'employee_profile' ELSE 'personal_memory' END;
    resource_key := coalesce(p_memory_id::text, p_human_principal_id::text);
    audit_key := audit.record_employee_interaction(
      audit_event_type,
      p_human_principal_id,
      p_department_id,
      resource_type,
      resource_key,
      'recorded',
      coalesce(p_payload, '{}'::jsonb)
    );
    RETURN audit_key;
END
$function$;

CREATE OR REPLACE FUNCTION personal.bootstrap_employee_profile(
    p_human_principal_id uuid,
    p_agent_principal_id uuid,
    p_department_id uuid,
    p_job_title text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, identity, personal
AS $function$
DECLARE
    inserted personal.employee_profile_versions%ROWTYPE;
    payload jsonb;
BEGIN
    IF session_user <> 'oam_operator_api'
       OR identity.current_operator_principal_id() IS NULL
       OR identity.current_operator_department_id() IS DISTINCT FROM p_department_id
       OR char_length(btrim(coalesce(p_job_title, ''))) NOT BETWEEN 1 AND 160 THEN
        RAISE EXCEPTION 'employee profile bootstrap denied' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM identity.employee_personal_agents pair
      WHERE pair.human_principal_id = p_human_principal_id
        AND pair.agent_principal_id = p_agent_principal_id
        AND pair.department_id = p_department_id
    ) THEN
        RAISE EXCEPTION 'employee personal agent pair not found' USING ERRCODE = '23503';
    END IF;

    payload := jsonb_build_object(
      'job_title', btrim(p_job_title),
      'role_summary', '',
      'expertise', '[]'::jsonb,
      'working_style', '',
      'current_goals', '[]'::jsonb,
      'boundaries', ''
    );
    INSERT INTO personal.employee_profile_versions (
      human_principal_id, agent_principal_id, department_id,
      revision, sharing_scope, profile_payload, created_by_principal_id
    ) VALUES (
      p_human_principal_id, p_agent_principal_id, p_department_id,
      1, 'owner_only', payload, identity.current_operator_principal_id()
    ) RETURNING * INTO inserted;

    PERFORM personal.record_domain_event(
      'profile_updated', p_human_principal_id, p_agent_principal_id,
      p_department_id, NULL, NULL, 1,
      jsonb_build_object('bootstrap', true, 'content_sha256', inserted.content_sha256)
    );
    RETURN inserted.profile_payload || jsonb_build_object(
      'id', inserted.id,
      'revision', inserted.revision,
      'sharing_scope', inserted.sharing_scope,
      'agent_shared', inserted.agent_shared,
      'content_sha256', inserted.content_sha256,
      'created_at', inserted.created_at
    );
END
$function$;

CREATE OR REPLACE FUNCTION personal.employee_workspace()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, identity, personal
AS $function$
#variable_conflict use_variable
DECLARE
    human_id uuid := identity.current_employee_principal_id();
    department_id uuid := identity.current_employee_department_id();
    agent_id uuid := identity.current_employee_agent_id();
    result jsonb;
BEGIN
    IF session_user <> 'oam_employee_api'
       OR human_id IS NULL OR department_id IS NULL OR agent_id IS NULL THEN
        RAISE EXCEPTION 'employee workspace authentication failed' USING ERRCODE = '28000';
    END IF;

    SELECT jsonb_build_object(
      'schema_version', 1,
      'principal', jsonb_build_object(
        'id', human.id,
        'principal_key', human.principal_key,
        'display_name', human.display_name,
        'status', human.status,
        'membership_role', membership.membership_role
      ),
      'department', jsonb_build_object(
        'id', department.id,
        'department_key', department.department_key,
        'display_name', department.display_name,
        'status', department.status
      ),
      'agent', jsonb_build_object(
        'id', agent.id,
        'principal_key', agent.principal_key,
        'display_name', agent.display_name,
        'status', agent.status,
        'pair_status', pair.status
      ),
      'profile', (
        SELECT profile.profile_payload || jsonb_build_object(
          'id', profile.id,
          'revision', profile.revision,
          'sharing_scope', profile.sharing_scope,
          'agent_shared', profile.agent_shared,
          'content_sha256', profile.content_sha256,
          'created_at', profile.created_at
        )
        FROM personal.employee_profile_versions profile
        WHERE profile.human_principal_id = human.id
        ORDER BY profile.revision DESC LIMIT 1
      ),
      'memories', coalesce((
        SELECT jsonb_agg(
          version.memory_payload || jsonb_build_object(
            'id', item.id,
            'memory_type', item.memory_type,
            'sensitivity', item.sensitivity,
            'sharing_scope', item.sharing_scope,
            'agent_shared', item.sharing_scope = 'owner_and_personal_agent',
            'status', item.status,
            'current_revision', item.current_revision,
            'revision', version.revision,
            'content_sha256', version.content_sha256,
            'created_at', item.created_at,
            'updated_at', item.updated_at
          ) ORDER BY item.updated_at DESC, item.id
        )
        FROM personal.employee_memory_items item
        JOIN personal.employee_memory_versions version
          ON version.memory_id = item.id AND version.revision = item.current_revision
        WHERE item.human_principal_id = human.id
      ), '[]'::jsonb)
    ) INTO result
    FROM identity.principals human
    JOIN identity.employee_personal_agents pair
      ON pair.human_principal_id = human.id
     AND pair.agent_principal_id = agent_id
     AND pair.department_id = department_id
     AND pair.status = 'active'
    JOIN identity.principals agent ON agent.id = pair.agent_principal_id
    JOIN identity.departments department ON department.id = pair.department_id
    JOIN identity.department_memberships membership
      ON membership.principal_id = human.id
     AND membership.department_id = department.id
     AND membership.status = 'active'
    WHERE human.id = human_id;

    IF result IS NULL THEN
        RAISE EXCEPTION 'employee workspace authentication failed' USING ERRCODE = '28000';
    END IF;
    RETURN result;
END
$function$;

CREATE OR REPLACE FUNCTION personal.update_employee_profile(
    p_expected_revision bigint,
    p_job_title text,
    p_role_summary text,
    p_expertise jsonb,
    p_working_style text,
    p_current_goals jsonb,
    p_boundaries text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, identity, personal
AS $function$
#variable_conflict use_variable
DECLARE
    human_id uuid := identity.current_employee_principal_id();
    department_id uuid := identity.current_employee_department_id();
    agent_id uuid := identity.current_employee_agent_id();
    current_profile personal.employee_profile_versions%ROWTYPE;
    inserted personal.employee_profile_versions%ROWTYPE;
    payload jsonb;
    audit_key uuid;
BEGIN
    IF session_user <> 'oam_employee_api'
       OR human_id IS NULL OR department_id IS NULL OR agent_id IS NULL THEN
        RAISE EXCEPTION 'employee workspace authentication failed' USING ERRCODE = '28000';
    END IF;
    IF char_length(btrim(coalesce(p_job_title, ''))) NOT BETWEEN 1 AND 160
       OR char_length(btrim(coalesce(p_role_summary, ''))) > 2000
       OR char_length(btrim(coalesce(p_working_style, ''))) > 2000
       OR char_length(btrim(coalesce(p_boundaries, ''))) > 2000
       OR NOT personal.valid_json_string_array(p_expertise, 32, 120)
       OR NOT personal.valid_json_string_array(p_current_goals, 24, 240) THEN
        RAISE EXCEPTION 'invalid employee profile' USING ERRCODE = '22023';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('employee-profile:' || human_id::text));
    SELECT * INTO current_profile
    FROM personal.employee_profile_versions profile
    WHERE profile.human_principal_id = human_id
      AND profile.agent_principal_id = agent_id
      AND profile.department_id = department_id
    ORDER BY profile.revision DESC
    LIMIT 1;
    IF NOT FOUND OR current_profile.revision IS DISTINCT FROM p_expected_revision THEN
        RAISE EXCEPTION 'employee profile revision conflict' USING ERRCODE = '40001';
    END IF;

    payload := jsonb_build_object(
      'job_title', btrim(p_job_title),
      'role_summary', btrim(coalesce(p_role_summary, '')),
      'expertise', p_expertise,
      'working_style', btrim(coalesce(p_working_style, '')),
      'current_goals', p_current_goals,
      'boundaries', btrim(coalesce(p_boundaries, ''))
    );
    INSERT INTO personal.employee_profile_versions (
      human_principal_id, agent_principal_id, department_id,
      revision, sharing_scope, profile_payload, created_by_principal_id
    ) VALUES (
      human_id, agent_id, department_id,
      current_profile.revision + 1, 'owner_only', payload, human_id
    ) RETURNING * INTO inserted;

    audit_key := personal.record_domain_event(
      'profile_updated', human_id, agent_id, department_id,
      NULL, current_profile.revision, inserted.revision,
      jsonb_build_object(
        'content_sha256', inserted.content_sha256,
        'sharing_scope', inserted.sharing_scope,
        'sharing_reset', current_profile.agent_shared
      )
    );
    RETURN inserted.profile_payload || jsonb_build_object(
      'id', inserted.id,
      'revision', inserted.revision,
      'sharing_scope', inserted.sharing_scope,
      'agent_shared', inserted.agent_shared,
      'content_sha256', inserted.content_sha256,
      'created_at', inserted.created_at,
      'audit_event_key', audit_key
    );
END
$function$;

CREATE OR REPLACE FUNCTION personal.change_employee_profile_sharing(
    p_expected_revision bigint,
    p_sharing_scope text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, identity, personal
AS $function$
#variable_conflict use_variable
DECLARE
    human_id uuid := identity.current_employee_principal_id();
    department_id uuid := identity.current_employee_department_id();
    agent_id uuid := identity.current_employee_agent_id();
    current_profile personal.employee_profile_versions%ROWTYPE;
    inserted personal.employee_profile_versions%ROWTYPE;
    audit_key uuid;
    event_type text;
BEGIN
    IF session_user <> 'oam_employee_api'
       OR human_id IS NULL OR department_id IS NULL OR agent_id IS NULL
       OR p_sharing_scope NOT IN ('owner_only', 'owner_and_personal_agent')
       OR NOT identity.personal_agent_pair_is_active(
         human_id, agent_id, department_id
       ) THEN
        RAISE EXCEPTION 'employee profile sharing denied' USING ERRCODE = '42501';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('employee-profile:' || human_id::text));
    SELECT * INTO current_profile
    FROM personal.employee_profile_versions profile
    WHERE profile.human_principal_id = human_id
      AND profile.agent_principal_id = agent_id
      AND profile.department_id = department_id
    ORDER BY profile.revision DESC
    LIMIT 1;
    IF NOT FOUND OR current_profile.revision IS DISTINCT FROM p_expected_revision THEN
        RAISE EXCEPTION 'employee profile revision conflict' USING ERRCODE = '40001';
    END IF;
    IF current_profile.sharing_scope = p_sharing_scope THEN
        RETURN current_profile.profile_payload || jsonb_build_object(
          'id', current_profile.id,
          'revision', current_profile.revision,
          'sharing_scope', current_profile.sharing_scope,
          'agent_shared', current_profile.agent_shared,
          'content_sha256', current_profile.content_sha256,
          'created_at', current_profile.created_at
        );
    END IF;

    INSERT INTO personal.employee_profile_versions (
      human_principal_id, agent_principal_id, department_id,
      revision, sharing_scope, profile_payload, created_by_principal_id
    ) VALUES (
      human_id, agent_id, department_id,
      current_profile.revision + 1, p_sharing_scope,
      current_profile.profile_payload, human_id
    ) RETURNING * INTO inserted;

    event_type := CASE p_sharing_scope
      WHEN 'owner_and_personal_agent' THEN 'profile_shared'
      ELSE 'profile_unshared'
    END;
    audit_key := personal.record_domain_event(
      event_type, human_id, agent_id, department_id,
      NULL, current_profile.revision, inserted.revision,
      jsonb_build_object(
        'from_sharing_scope', current_profile.sharing_scope,
        'sharing_scope', inserted.sharing_scope,
        'content_sha256', inserted.content_sha256
      )
    );
    RETURN inserted.profile_payload || jsonb_build_object(
      'id', inserted.id,
      'revision', inserted.revision,
      'sharing_scope', inserted.sharing_scope,
      'agent_shared', inserted.agent_shared,
      'content_sha256', inserted.content_sha256,
      'created_at', inserted.created_at,
      'audit_event_key', audit_key
    );
END
$function$;

CREATE OR REPLACE FUNCTION personal.share_employee_profile(p_expected_revision bigint)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, personal
AS $function$
    SELECT personal.change_employee_profile_sharing(
      p_expected_revision, 'owner_and_personal_agent'
    )
$function$;

CREATE OR REPLACE FUNCTION personal.unshare_employee_profile(p_expected_revision bigint)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, personal
AS $function$
    SELECT personal.change_employee_profile_sharing(
      p_expected_revision, 'owner_only'
    )
$function$;

CREATE OR REPLACE FUNCTION personal.build_memory_payload(
    p_memory_type text,
    p_title text,
    p_content text,
    p_context text,
    p_why_it_worked text,
    p_evidence jsonb,
    p_tags text[],
    p_sensitivity text
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
DECLARE
    tag text;
BEGIN
    IF p_memory_type NOT IN ('experience', 'lesson', 'preference', 'skill', 'decision', 'pattern')
       OR p_sensitivity NOT IN ('private', 'restricted')
       OR char_length(btrim(coalesce(p_title, ''))) NOT BETWEEN 1 AND 200
       OR char_length(btrim(coalesce(p_content, ''))) NOT BETWEEN 1 AND 12000
       OR char_length(btrim(coalesce(p_context, ''))) > 4000
       OR char_length(btrim(coalesce(p_why_it_worked, ''))) > 4000
       OR jsonb_typeof(p_evidence) <> 'array'
       OR jsonb_array_length(p_evidence) > 32
       OR octet_length(p_evidence::text) > 16384
       OR cardinality(coalesce(p_tags, ARRAY[]::text[])) > 16 THEN
        RAISE EXCEPTION 'invalid employee memory' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_evidence) item
      WHERE jsonb_typeof(item) NOT IN ('string', 'object')
         OR (jsonb_typeof(item) = 'string' AND char_length(item #>> '{}') NOT BETWEEN 1 AND 1000)
         OR octet_length(item::text) > 4096
    ) THEN
        RAISE EXCEPTION 'memory evidence must contain bounded strings or objects' USING ERRCODE = '22023';
    END IF;
    FOREACH tag IN ARRAY coalesce(p_tags, ARRAY[]::text[]) LOOP
        IF char_length(btrim(coalesce(tag, ''))) NOT BETWEEN 1 AND 60 THEN
            RAISE EXCEPTION 'invalid employee memory tag' USING ERRCODE = '22023';
        END IF;
    END LOOP;
    RETURN jsonb_build_object(
      'memory_type', p_memory_type,
      'title', btrim(p_title),
      'content', btrim(p_content),
      'context', btrim(coalesce(p_context, '')),
      'why_it_worked', btrim(coalesce(p_why_it_worked, '')),
      'evidence', p_evidence,
      'tags', to_jsonb(coalesce(p_tags, ARRAY[]::text[])),
      'sensitivity', p_sensitivity
    );
END
$function$;

CREATE OR REPLACE FUNCTION personal.create_employee_memory(
    p_memory_type text,
    p_title text,
    p_content text,
    p_context text,
    p_why_it_worked text,
    p_evidence jsonb,
    p_tags text[],
    p_sensitivity text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, identity, personal
AS $function$
#variable_conflict use_variable
DECLARE
    human_id uuid := identity.current_employee_principal_id();
    department_id uuid := identity.current_employee_department_id();
    agent_id uuid := identity.current_employee_agent_id();
    item personal.employee_memory_items%ROWTYPE;
    version personal.employee_memory_versions%ROWTYPE;
    payload jsonb;
    audit_key uuid;
BEGIN
    IF session_user <> 'oam_employee_api'
       OR human_id IS NULL OR department_id IS NULL OR agent_id IS NULL THEN
        RAISE EXCEPTION 'employee workspace authentication failed' USING ERRCODE = '28000';
    END IF;
    payload := personal.build_memory_payload(
      p_memory_type, p_title, p_content, p_context, p_why_it_worked,
      p_evidence, p_tags, p_sensitivity
    );

    INSERT INTO personal.employee_memory_items (
      human_principal_id, agent_principal_id, department_id,
      memory_type, sensitivity, sharing_scope, status, current_revision
    ) VALUES (
      human_id, agent_id, department_id,
      p_memory_type, p_sensitivity, 'owner_only', 'active', 1
    ) RETURNING * INTO item;
    INSERT INTO personal.employee_memory_versions (
      memory_id, human_principal_id, agent_principal_id, department_id,
      revision, memory_payload, created_by_principal_id
    ) VALUES (
      item.id, human_id, agent_id, department_id, 1, payload, human_id
    ) RETURNING * INTO version;
    audit_key := personal.record_domain_event(
      'memory_created', human_id, agent_id, department_id,
      item.id, NULL, 1,
      jsonb_build_object(
        'content_sha256', version.content_sha256,
        'memory_type', item.memory_type,
        'sensitivity', item.sensitivity,
        'sharing_scope', item.sharing_scope
      )
    );
    RETURN version.memory_payload || jsonb_build_object(
      'id', item.id,
      'current_revision', item.current_revision,
      'revision', version.revision,
      'content_sha256', version.content_sha256,
      'sharing_scope', item.sharing_scope,
      'agent_shared', false,
      'created_at', item.created_at,
      'updated_at', item.updated_at,
      'audit_event_key', audit_key
    );
END
$function$;

CREATE OR REPLACE FUNCTION personal.update_employee_memory(
    p_memory_id uuid,
    p_expected_revision bigint,
    p_memory_type text,
    p_title text,
    p_content text,
    p_context text,
    p_why_it_worked text,
    p_evidence jsonb,
    p_tags text[],
    p_sensitivity text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, identity, personal
AS $function$
#variable_conflict use_variable
DECLARE
    human_id uuid := identity.current_employee_principal_id();
    department_id uuid := identity.current_employee_department_id();
    agent_id uuid := identity.current_employee_agent_id();
    item personal.employee_memory_items%ROWTYPE;
    version personal.employee_memory_versions%ROWTYPE;
    payload jsonb;
    next_sharing text;
    previous_sharing text;
    audit_key uuid;
BEGIN
    IF session_user <> 'oam_employee_api'
       OR human_id IS NULL OR department_id IS NULL OR agent_id IS NULL THEN
        RAISE EXCEPTION 'employee workspace authentication failed' USING ERRCODE = '28000';
    END IF;
    payload := personal.build_memory_payload(
      p_memory_type, p_title, p_content, p_context, p_why_it_worked,
      p_evidence, p_tags, p_sensitivity
    );
    SELECT * INTO item
    FROM personal.employee_memory_items memory
    WHERE memory.id = p_memory_id
      AND memory.human_principal_id = human_id
      AND memory.agent_principal_id = agent_id
      AND memory.department_id = department_id
      AND memory.status = 'active'
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'employee memory not found' USING ERRCODE = 'P0002';
    END IF;
    IF item.current_revision IS DISTINCT FROM p_expected_revision THEN
        RAISE EXCEPTION 'employee memory revision conflict' USING ERRCODE = '40001';
    END IF;
    previous_sharing := item.sharing_scope;
    -- Consent is revision-bound. New employee-authored content always returns
    -- to owner-only until the employee explicitly shares that exact revision.
    next_sharing := 'owner_only';
    INSERT INTO personal.employee_memory_versions (
      memory_id, human_principal_id, agent_principal_id, department_id,
      revision, memory_payload, created_by_principal_id
    ) VALUES (
      item.id, human_id, agent_id, department_id,
      item.current_revision + 1, payload, human_id
    ) RETURNING * INTO version;
    UPDATE personal.employee_memory_items
    SET memory_type = p_memory_type,
        sensitivity = p_sensitivity,
        sharing_scope = next_sharing,
        current_revision = version.revision,
        updated_at = now()
    WHERE id = item.id
    RETURNING * INTO item;
    audit_key := personal.record_domain_event(
      'memory_updated', human_id, agent_id, department_id,
      item.id, p_expected_revision, version.revision,
      jsonb_build_object(
        'content_sha256', version.content_sha256,
        'memory_type', item.memory_type,
        'sensitivity', item.sensitivity,
        'sharing_scope', item.sharing_scope,
        'sharing_reset', previous_sharing = 'owner_and_personal_agent'
      )
    );
    RETURN version.memory_payload || jsonb_build_object(
      'id', item.id,
      'current_revision', item.current_revision,
      'revision', version.revision,
      'content_sha256', version.content_sha256,
      'sharing_scope', item.sharing_scope,
      'agent_shared', item.sharing_scope = 'owner_and_personal_agent',
      'created_at', item.created_at,
      'updated_at', item.updated_at,
      'audit_event_key', audit_key
    );
END
$function$;

CREATE OR REPLACE FUNCTION personal.change_employee_memory_sharing(
    p_memory_id uuid,
    p_expected_revision bigint,
    p_sharing_scope text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, identity, personal
AS $function$
#variable_conflict use_variable
DECLARE
    human_id uuid := identity.current_employee_principal_id();
    department_id uuid := identity.current_employee_department_id();
    agent_id uuid := identity.current_employee_agent_id();
    item personal.employee_memory_items%ROWTYPE;
    current_version personal.employee_memory_versions%ROWTYPE;
    next_version personal.employee_memory_versions%ROWTYPE;
    event_type text;
    audit_key uuid;
BEGIN
    IF session_user <> 'oam_employee_api'
       OR human_id IS NULL OR department_id IS NULL OR agent_id IS NULL THEN
        RAISE EXCEPTION 'employee workspace authentication failed' USING ERRCODE = '28000';
    END IF;
    IF p_sharing_scope NOT IN ('owner_only', 'owner_and_personal_agent') THEN
        RAISE EXCEPTION 'invalid personal memory sharing scope' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO item
    FROM personal.employee_memory_items memory
    WHERE memory.id = p_memory_id
      AND memory.human_principal_id = human_id
      AND memory.agent_principal_id = agent_id
      AND memory.department_id = department_id
      AND memory.status = 'active'
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'employee memory not found' USING ERRCODE = 'P0002';
    END IF;
    IF item.current_revision IS DISTINCT FROM p_expected_revision THEN
        RAISE EXCEPTION 'employee memory revision conflict' USING ERRCODE = '40001';
    END IF;
    IF p_sharing_scope = 'owner_and_personal_agent' AND item.sensitivity = 'restricted' THEN
        RAISE EXCEPTION 'restricted memory cannot be shared with an agent' USING ERRCODE = '42501';
    END IF;
    IF item.sharing_scope = p_sharing_scope THEN
        RETURN jsonb_build_object(
          'id', item.id,
          'current_revision', item.current_revision,
          'revision', item.current_revision,
          'sharing_scope', item.sharing_scope,
          'agent_shared', item.sharing_scope = 'owner_and_personal_agent',
          'updated_at', item.updated_at
        );
    END IF;
    SELECT * INTO current_version
    FROM personal.employee_memory_versions version
    WHERE version.memory_id = item.id AND version.revision = item.current_revision;
    INSERT INTO personal.employee_memory_versions (
      memory_id, human_principal_id, agent_principal_id, department_id,
      revision, memory_payload, created_by_principal_id
    ) VALUES (
      item.id, human_id, agent_id, department_id,
      item.current_revision + 1, current_version.memory_payload, human_id
    ) RETURNING * INTO next_version;
    UPDATE personal.employee_memory_items
    SET sharing_scope = p_sharing_scope,
        current_revision = next_version.revision,
        updated_at = now()
    WHERE id = item.id
    RETURNING * INTO item;
    event_type := CASE
      WHEN p_sharing_scope = 'owner_and_personal_agent' THEN 'memory_shared'
      ELSE 'memory_unshared'
    END;
    audit_key := personal.record_domain_event(
      event_type, human_id, agent_id, department_id,
      item.id, p_expected_revision, next_version.revision,
      jsonb_build_object(
        'content_sha256', next_version.content_sha256,
        'sharing_scope', item.sharing_scope
      )
    );
    RETURN jsonb_build_object(
      'id', item.id,
      'current_revision', item.current_revision,
      'revision', next_version.revision,
      'content_sha256', next_version.content_sha256,
      'sharing_scope', item.sharing_scope,
      'agent_shared', item.sharing_scope = 'owner_and_personal_agent',
      'created_at', item.created_at,
      'updated_at', item.updated_at,
      'audit_event_key', audit_key
    );
END
$function$;

CREATE OR REPLACE FUNCTION personal.share_employee_memory(
    p_memory_id uuid,
    p_expected_revision bigint
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, personal
AS $function$
    SELECT personal.change_employee_memory_sharing(
      p_memory_id, p_expected_revision, 'owner_and_personal_agent'
    )
$function$;

CREATE OR REPLACE FUNCTION personal.unshare_employee_memory(
    p_memory_id uuid,
    p_expected_revision bigint
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, personal
AS $function$
    SELECT personal.change_employee_memory_sharing(
      p_memory_id, p_expected_revision, 'owner_only'
    )
$function$;

CREATE OR REPLACE FUNCTION personal.agent_context_document(
    p_human_principal_id uuid,
    p_agent_principal_id uuid,
    p_department_id uuid,
    p_query text,
    p_limit integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, identity, personal
AS $function$
DECLARE
    normalized_query text := regexp_replace(btrim(coalesce(p_query, '')), '\s+', ' ', 'g');
    result jsonb;
BEGIN
    IF session_user NOT IN ('oam_employee_api', 'oam_broker_api')
       OR char_length(normalized_query) NOT BETWEEN 2 AND 200
       OR p_limit NOT BETWEEN 1 AND 10 THEN
        RAISE EXCEPTION 'invalid personal context query' USING ERRCODE = '22023';
    END IF;
    IF NOT identity.personal_agent_pair_is_active(
      p_human_principal_id, p_agent_principal_id, p_department_id
    ) THEN
        RAISE EXCEPTION 'personal context authorization failed' USING ERRCODE = '42501';
    END IF;

    WITH memory_matched AS (
      SELECT 'memory'::text AS source_type,
             item.id AS source_id,
             version.memory_payload || jsonb_build_object(
               'source_type', 'memory',
               'id', item.id,
               'memory_type', item.memory_type,
               'sensitivity', item.sensitivity,
               'sharing_scope', item.sharing_scope,
               'agent_shared', true,
               'revision', item.current_revision,
               'content_sha256', version.content_sha256,
               'created_at', item.created_at,
               'updated_at', item.updated_at,
               'citation', jsonb_build_object(
                 'source_type', 'memory',
                 'source_id', item.id,
                 'memory_id', item.id,
                 'revision', item.current_revision,
                 'content_sha256', version.content_sha256
               )
             ) AS document,
             jsonb_build_object(
               'source_type', 'memory',
               'source_id', item.id,
               'memory_id', item.id,
               'revision', item.current_revision,
               'content_sha256', version.content_sha256
             ) AS citation,
             ts_rank_cd(
               to_tsvector('simple',
                 coalesce(version.memory_payload->>'title', '') || ' ' ||
                 coalesce(version.memory_payload->>'content', '') || ' ' ||
                 coalesce(version.memory_payload->>'context', '') || ' ' ||
                 coalesce(version.memory_payload->>'why_it_worked', '')
               ),
               plainto_tsquery('simple', normalized_query)
             ) AS relevance,
             item.updated_at AS source_updated_at
      FROM personal.employee_memory_items item
      JOIN personal.employee_memory_versions version
        ON version.memory_id = item.id
       AND version.revision = item.current_revision
      WHERE item.human_principal_id = p_human_principal_id
        AND item.agent_principal_id = p_agent_principal_id
        AND item.department_id = p_department_id
        AND item.status = 'active'
        AND item.sharing_scope = 'owner_and_personal_agent'
        AND item.sensitivity = 'private'
        AND to_tsvector('simple',
              coalesce(version.memory_payload->>'title', '') || ' ' ||
              coalesce(version.memory_payload->>'content', '') || ' ' ||
              coalesce(version.memory_payload->>'context', '') || ' ' ||
              coalesce(version.memory_payload->>'why_it_worked', '')
            ) @@ plainto_tsquery('simple', normalized_query)
    ), profile_matched AS (
      SELECT 'profile'::text AS source_type,
             profile.id AS source_id,
             profile.profile_payload || jsonb_build_object(
               'source_type', 'profile',
               'id', profile.id,
               'sharing_scope', profile.sharing_scope,
               'agent_shared', profile.agent_shared,
               'revision', profile.revision,
               'content_sha256', profile.content_sha256,
               'created_at', profile.created_at,
               'citation', jsonb_build_object(
                 'source_type', 'profile',
                 'source_id', profile.id,
                 'profile_id', profile.id,
                 'revision', profile.revision,
                 'content_sha256', profile.content_sha256
               )
             ) AS document,
             jsonb_build_object(
               'source_type', 'profile',
               'source_id', profile.id,
               'profile_id', profile.id,
               'revision', profile.revision,
               'content_sha256', profile.content_sha256
             ) AS citation,
             ts_rank_cd(
               to_tsvector('simple',
                 coalesce(profile.profile_payload->>'job_title', '') || ' ' ||
                 coalesce(profile.profile_payload->>'role_summary', '') || ' ' ||
                 coalesce(profile.profile_payload->>'expertise', '') || ' ' ||
                 coalesce(profile.profile_payload->>'working_style', '') || ' ' ||
                 coalesce(profile.profile_payload->>'current_goals', '') || ' ' ||
                 coalesce(profile.profile_payload->>'boundaries', '')
               ),
               plainto_tsquery('simple', normalized_query)
             ) AS relevance,
             profile.created_at AS source_updated_at
      FROM personal.employee_profile_versions profile
      WHERE profile.human_principal_id = p_human_principal_id
        AND profile.agent_principal_id = p_agent_principal_id
        AND profile.department_id = p_department_id
        AND profile.sharing_scope = 'owner_and_personal_agent'
        AND profile.agent_shared
        AND profile.revision = (
          SELECT max(current_profile.revision)
          FROM personal.employee_profile_versions current_profile
          WHERE current_profile.human_principal_id = p_human_principal_id
            AND current_profile.agent_principal_id = p_agent_principal_id
            AND current_profile.department_id = p_department_id
        )
        AND to_tsvector('simple',
              coalesce(profile.profile_payload->>'job_title', '') || ' ' ||
              coalesce(profile.profile_payload->>'role_summary', '') || ' ' ||
              coalesce(profile.profile_payload->>'expertise', '') || ' ' ||
              coalesce(profile.profile_payload->>'working_style', '') || ' ' ||
              coalesce(profile.profile_payload->>'current_goals', '') || ' ' ||
              coalesce(profile.profile_payload->>'boundaries', '')
            ) @@ plainto_tsquery('simple', normalized_query)
    ), combined AS (
      SELECT * FROM memory_matched
      UNION ALL
      SELECT * FROM profile_matched
    ), limited AS (
      SELECT * FROM combined
      ORDER BY relevance DESC, source_updated_at DESC, source_type, source_id
      LIMIT p_limit
    )
    SELECT jsonb_build_object(
      'text', normalized_query,
      'limit', p_limit,
      'matched_count', count(*),
      'items', coalesce(jsonb_agg(
        document ORDER BY relevance DESC, source_updated_at DESC, source_type, source_id
      ), '[]'::jsonb),
      'citations', coalesce(jsonb_agg(
        citation ORDER BY relevance DESC, source_updated_at DESC, source_type, source_id
      ), '[]'::jsonb)
    ) INTO result
    FROM limited;
    RETURN result;
END
$function$;

CREATE OR REPLACE FUNCTION personal.employee_agent_context(
    p_query text,
    p_limit integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, identity, personal, audit
AS $function$
#variable_conflict use_variable
DECLARE
    human_id uuid := identity.current_employee_principal_id();
    department_id uuid := identity.current_employee_department_id();
    agent_id uuid := identity.current_employee_agent_id();
    query_result jsonb;
    audit_key uuid;
BEGIN
    IF session_user <> 'oam_employee_api'
       OR human_id IS NULL OR department_id IS NULL OR agent_id IS NULL THEN
        RAISE EXCEPTION 'employee workspace authentication failed' USING ERRCODE = '28000';
    END IF;
    query_result := personal.agent_context_document(
      human_id, agent_id, department_id, p_query, p_limit
    );
    audit_key := audit.record_employee_interaction(
      'employee.agent_context_retrieved', human_id, department_id,
      'personal_context', 'employee-preview:' || agent_id::text, 'allowed',
      jsonb_build_object(
        'agent_principal_id', agent_id,
        'matched_count', (query_result->>'matched_count')::integer
      )
    );
    RETURN jsonb_build_object(
      'schema_version', 1,
      'authorization', 'allowed',
      'principal', jsonb_build_object(
        'human_id', human_id,
        'agent_id', agent_id,
        'department_id', department_id
      ),
      'query', query_result - 'items' - 'citations',
      'items', query_result->'items',
      'citations', query_result->'citations',
      'audit_event_key', audit_key
    );
END
$function$;

RESET ROLE;

SET LOCAL ROLE oam_security_owner;

CREATE OR REPLACE FUNCTION identity.resolve_personal_agent_broker_context(
    p_token_sha256 text,
    p_claimed_agent_key text
)
RETURNS TABLE (
    agent_id uuid,
    agent_key text,
    human_id uuid,
    human_key text,
    department_id uuid,
    department_key text,
    credential_id uuid,
    capability_grant_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, identity, governance
AS $function$
    SELECT agent.id,
           agent.principal_key,
           human.id,
           human.principal_key,
           department.id,
           department.department_key,
           credential.id,
           capability_grant.id
    FROM identity.broker_credentials credential
    JOIN identity.principals agent
      ON agent.id = credential.principal_id
     AND agent.principal_kind = 'agent' AND agent.status = 'active'
    JOIN identity.employee_personal_agents pair
      ON pair.agent_principal_id = agent.id AND pair.status = 'active'
    JOIN identity.principals human
      ON human.id = pair.human_principal_id
     AND human.principal_kind = 'human' AND human.status = 'active'
    JOIN identity.departments department
      ON department.id = pair.department_id AND department.status = 'active'
    JOIN identity.department_memberships human_membership
      ON human_membership.principal_id = human.id
     AND human_membership.department_id = department.id
     AND human_membership.status = 'active'
     AND human_membership.valid_from <= now()
     AND (human_membership.valid_to IS NULL OR human_membership.valid_to > now())
    JOIN identity.department_memberships agent_membership
      ON agent_membership.principal_id = agent.id
     AND agent_membership.department_id = department.id
     AND agent_membership.status = 'active'
     AND agent_membership.valid_from <= now()
     AND (agent_membership.valid_to IS NULL OR agent_membership.valid_to > now())
    JOIN identity.policy_templates template
      ON template.id = credential.policy_template_id AND template.status = 'active'
    JOIN identity.policy_assignments assignment
      ON assignment.principal_id = agent.id
     AND assignment.department_id = department.id
     AND assignment.template_id = template.id
     AND assignment.assignment_scope = 'principal'
     AND assignment.status = 'active'
     AND assignment.valid_from <= now()
     AND (assignment.valid_to IS NULL OR assignment.valid_to > now())
    JOIN governance.capability_grants capability_grant
      ON capability_grant.principal_id = agent.id
     AND capability_grant.department_id = department.id
     AND capability_grant.policy_template_id = template.id
     AND capability_grant.capability_task_key = 'personal_context_retrieval'
     AND capability_grant.status = 'active'
     AND capability_grant.valid_from <= now()
     AND (capability_grant.valid_to IS NULL OR capability_grant.valid_to > now())
    JOIN identity.runtime_bindings binding
      ON binding.principal_id = agent.id
     AND binding.binding_kind = 'broker_client'
     AND binding.access_mode = 'brokered'
     AND binding.status = 'active'
     AND binding.valid_from <= now()
     AND (binding.valid_to IS NULL OR binding.valid_to > now())
     AND binding.metadata->>'credential_id' = credential.id::text
     AND binding.metadata->>'policy_hash' = credential.metadata->>'policy_hash'
    WHERE session_user = 'oam_broker_api'
      AND p_token_sha256 ~ '^[a-f0-9]{64}$'
      AND p_claimed_agent_key ~ '^agent:[a-z0-9][a-z0-9_.-]{1,118}$'
      AND credential.token_sha256 = p_token_sha256
      AND credential.status = 'active'
      AND (credential.expires_at IS NULL OR credential.expires_at > now())
      AND credential.metadata->>'policy_hash' ~ '^[a-f0-9]{64}$'
      AND agent.principal_key = p_claimed_agent_key
      AND NOT EXISTS (
        SELECT 1 FROM identity.explicit_permission_denials denial
        WHERE denial.principal_id IN (agent.id, human.id)
          AND denial.department_id = department.id
          AND denial.permission_key = 'memory.personal.read'
          AND denial.status = 'active'
          AND denial.valid_from <= now()
          AND (denial.valid_to IS NULL OR denial.valid_to > now())
      )
      AND EXISTS (
        SELECT 1 FROM identity.provisioning_jobs job
        WHERE job.principal_id = agent.id
          AND job.department_id = department.id
          AND job.status = 'succeeded'
          AND (
            job.id::text = credential.metadata->>'activation_job_id'
            OR job.id::text = credential.metadata->>'provisioning_job_id'
          )
      )
    ORDER BY credential.issued_at DESC
    LIMIT 1
$function$;

REVOKE ALL ON FUNCTION identity.resolve_personal_agent_broker_context(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.resolve_personal_agent_broker_context(text, text)
    TO oam_personal_memory_owner;

RESET ROLE;

SET LOCAL ROLE oam_personal_memory_owner;

CREATE OR REPLACE FUNCTION personal.retrieve_agent_context_for_broker(
    p_token_sha256 text,
    p_claimed_agent_key text,
    p_query text,
    p_limit integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, identity, personal, audit
AS $function$
DECLARE
    auth_context record;
    query_result jsonb;
    audit_key uuid;
    normalized_query text := regexp_replace(btrim(coalesce(p_query, '')), '\s+', ' ', 'g');
BEGIN
    IF session_user <> 'oam_broker_api'
       OR char_length(normalized_query) NOT BETWEEN 2 AND 200
       OR p_limit NOT BETWEEN 1 AND 10 THEN
        RAISE EXCEPTION 'invalid personal context request' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO auth_context
    FROM identity.resolve_personal_agent_broker_context(
      p_token_sha256, p_claimed_agent_key
    );
    IF NOT FOUND THEN
        audit_key := audit.record_employee_interaction(
          'agent.personal_context_denied', NULL, NULL,
          'personal_context', 'personal_context_retrieval', 'denied',
          jsonb_build_object('reason', 'authorization_failed')
        );
        RETURN jsonb_build_object(
          'schema_version', 1,
          'authorization', 'denied',
          'query', jsonb_build_object('text', normalized_query, 'limit', p_limit),
          'items', '[]'::jsonb,
          'citations', '[]'::jsonb,
          'audit_event_key', audit_key
        );
    END IF;
    query_result := personal.agent_context_document(
      auth_context.human_id,
      auth_context.agent_id,
      auth_context.department_id,
      normalized_query,
      p_limit
    );
    audit_key := audit.record_employee_interaction(
      'agent.personal_context_retrieved', auth_context.agent_id,
      auth_context.department_id, 'personal_context',
      'personal_context_retrieval', 'allowed',
      jsonb_build_object(
        'human_principal_id', auth_context.human_id,
        'capability_grant_id', auth_context.capability_grant_id,
        'matched_count', (query_result->>'matched_count')::integer
      )
    );
    RETURN jsonb_build_object(
      'schema_version', 1,
      'authorization', 'allowed',
      'principal', jsonb_build_object(
        'agent_id', auth_context.agent_id,
        'agent_key', auth_context.agent_key,
        'human_id', auth_context.human_id,
        'human_key', auth_context.human_key,
        'department_id', auth_context.department_id,
        'department_key', auth_context.department_key
      ),
      'query', query_result - 'items' - 'citations',
      'items', query_result->'items',
      'citations', query_result->'citations',
      'audit_event_key', audit_key
    );
END
$function$;

RESET ROLE;

SET LOCAL ROLE oam_security_owner;

CREATE OR REPLACE FUNCTION identity.resolve_employee_workspace_token(p_token_sha256 text)
RETURNS TABLE (
    principal_id uuid,
    principal_key text,
    display_name text,
    department_id uuid,
    department_key text,
    department_name text,
    membership_role text,
    agent_id uuid,
    agent_key text,
    agent_display_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, identity, audit
AS $function$
DECLARE
    resolved record;
BEGIN
    IF session_user <> 'oam_employee_api'
       OR p_token_sha256 !~ '^[a-f0-9]{64}$' THEN
        RAISE EXCEPTION 'employee workspace authentication failed' USING ERRCODE = '28000';
    END IF;
    SELECT human.id AS human_id,
           human.principal_key AS human_key,
           human.display_name AS human_display_name,
           department.id AS resolved_department_id,
           department.department_key AS resolved_department_key,
           department.display_name AS resolved_department_name,
           membership.membership_role AS resolved_membership_role,
           agent.id AS personal_agent_id,
           agent.principal_key AS personal_agent_key,
           agent.display_name AS personal_agent_display_name,
           credential.id AS credential_id
    INTO resolved
    FROM identity.employee_workspace_credentials credential
    JOIN identity.employee_personal_agents pair
      ON pair.human_principal_id = credential.human_principal_id
     AND pair.department_id = credential.department_id
     AND pair.status = 'active'
    JOIN identity.principals human
      ON human.id = credential.human_principal_id
     AND human.principal_kind = 'human' AND human.status = 'active'
    JOIN identity.principals agent
      ON agent.id = pair.agent_principal_id
     AND agent.principal_kind = 'agent' AND agent.status = 'active'
    JOIN identity.departments department
      ON department.id = credential.department_id AND department.status = 'active'
    JOIN identity.department_memberships membership
      ON membership.principal_id = human.id
     AND membership.department_id = department.id
     AND membership.status = 'active'
     AND membership.valid_from <= now()
     AND (membership.valid_to IS NULL OR membership.valid_to > now())
    WHERE credential.token_sha256 = p_token_sha256
      AND credential.status = 'active' AND credential.expires_at > now()
    ORDER BY membership.membership_role
    LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'employee workspace authentication failed' USING ERRCODE = '28000';
    END IF;

    UPDATE identity.employee_workspace_credentials
    SET last_used_at = now()
    WHERE id = resolved.credential_id;
    PERFORM audit.record_employee_interaction(
      'employee.workspace_authenticated', resolved.human_id, resolved.resolved_department_id,
      'employee_workspace', resolved.human_id::text, 'allowed',
      jsonb_build_object('agent_principal_id', resolved.personal_agent_id)
    );

    principal_id := resolved.human_id;
    principal_key := resolved.human_key;
    display_name := resolved.human_display_name;
    department_id := resolved.resolved_department_id;
    department_key := resolved.resolved_department_key;
    department_name := resolved.resolved_department_name;
    membership_role := resolved.resolved_membership_role;
    agent_id := resolved.personal_agent_id;
    agent_key := resolved.personal_agent_key;
    agent_display_name := resolved.personal_agent_display_name;
    RETURN NEXT;
END
$function$;

CREATE OR REPLACE FUNCTION identity.operator_can_onboard_employee(
    p_department_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, identity
AS $function$
    SELECT identity.current_operator_department_id() = p_department_id
       AND EXISTS (
         SELECT 1
         FROM identity.principals principal
         JOIN identity.department_memberships membership
           ON membership.principal_id = principal.id
          AND membership.department_id = p_department_id
          AND membership.membership_role = 'architect'
          AND membership.status = 'active'
          AND membership.valid_from <= now()
          AND (membership.valid_to IS NULL OR membership.valid_to > now())
         JOIN identity.policy_assignments assignment
           ON assignment.principal_id = principal.id
          AND assignment.department_id = p_department_id
          AND assignment.assignment_scope = 'principal'
          AND assignment.status = 'active'
          AND assignment.valid_from <= now()
          AND (assignment.valid_to IS NULL OR assignment.valid_to > now())
         JOIN identity.policy_templates template
           ON template.id = assignment.template_id AND template.status = 'active'
         JOIN identity.policy_template_rules rule
           ON rule.template_id = template.id
          AND rule.principal_kind = 'human'
          AND rule.membership_role = 'architect'
          AND rule.permission_key = 'provisioning.confirm'
          AND rule.effect = 'allow'
          AND rule.conditions = '{}'::jsonb
         WHERE principal.id = identity.current_operator_principal_id()
           AND principal.principal_kind = 'human' AND principal.status = 'active'
           AND NOT EXISTS (
             SELECT 1 FROM identity.explicit_permission_denials denial
             WHERE denial.principal_id = principal.id
               AND denial.department_id = p_department_id
               AND denial.permission_key = 'provisioning.confirm'
               AND denial.status = 'active'
               AND denial.valid_from <= now()
               AND (denial.valid_to IS NULL OR denial.valid_to > now())
           )
       )
$function$;

CREATE OR REPLACE FUNCTION identity.onboard_employee_bundle(
    p_human_principal_key text,
    p_display_name text,
    p_work_email text,
    p_job_title text,
    p_agent_principal_key text,
    p_agent_display_name text,
    p_workspace_token_sha256 text,
    p_workspace_expires_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, identity, governance, personal, audit
AS $function$
#variable_conflict use_variable
DECLARE
    actor_id uuid := identity.current_operator_principal_id();
    department_id uuid := identity.current_operator_department_id();
    human_id uuid := gen_random_uuid();
    agent_id uuid := gen_random_uuid();
    member_policy record;
    agent_policy record;
    agent_credential_id uuid;
    workspace_credential_id uuid;
    bootstrap_agent_hash text;
    policy_hash text;
    profile jsonb;
    audit_key uuid;
BEGIN
    IF session_user <> 'oam_operator_api'
       OR actor_id IS NULL OR department_id IS NULL
       OR NOT identity.operator_can_onboard_employee(department_id) THEN
        RAISE EXCEPTION 'employee onboarding denied' USING ERRCODE = '42501';
    END IF;
    IF p_human_principal_key !~ '^human:[a-z0-9][a-z0-9_.-]{1,118}$'
       OR p_agent_principal_key !~ '^agent:[a-z0-9][a-z0-9_.-]{1,118}$'
       OR char_length(btrim(coalesce(p_display_name, ''))) NOT BETWEEN 1 AND 200
       OR char_length(btrim(coalesce(p_agent_display_name, ''))) NOT BETWEEN 1 AND 200
       OR char_length(btrim(coalesce(p_job_title, ''))) NOT BETWEEN 1 AND 160
       OR lower(btrim(coalesce(p_work_email, ''))) !~
          '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'
       OR p_workspace_token_sha256 !~ '^[a-f0-9]{64}$'
       OR p_workspace_expires_at <= now() + interval '5 minutes'
       OR p_workspace_expires_at > now() + interval '90 days' THEN
        RAISE EXCEPTION 'invalid employee onboarding request' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM identity.departments department
      WHERE department.id = department_id AND department.status = 'active'
    ) THEN
        RAISE EXCEPTION 'employee onboarding department is inactive' USING ERRCODE = '55000';
    END IF;

    SELECT template.id, template.template_key, template.version
    INTO member_policy
    FROM identity.policy_templates template
    WHERE template.template_key = 'member' AND template.status = 'active'
    ORDER BY template.version DESC LIMIT 1;
    SELECT template.id, template.template_key, template.version
    INTO agent_policy
    FROM identity.policy_templates template
    WHERE template.template_key = 'memory_reuse_agent' AND template.status = 'active'
    ORDER BY template.version DESC LIMIT 1;
    IF member_policy.id IS NULL OR agent_policy.id IS NULL THEN
        RAISE EXCEPTION 'employee onboarding policy is unavailable' USING ERRCODE = '55000';
    END IF;

    INSERT INTO identity.principals (
      id, principal_key, principal_kind, display_name,
      external_issuer, external_subject, status, metadata
    ) VALUES (
      human_id, p_human_principal_key, 'human', btrim(p_display_name),
      'urn:oam:employee-workspace', lower(btrim(p_work_email)), 'active',
      jsonb_build_object('work_email', lower(btrim(p_work_email)), 'job_title', btrim(p_job_title))
    );
    INSERT INTO identity.department_memberships (
      principal_id, department_id, membership_role, status, approved_by_principal_id
    ) VALUES (human_id, department_id, 'member', 'active', actor_id);
    INSERT INTO identity.policy_assignments (
      assignment_key, assignment_scope, principal_id, department_id,
      template_id, status, assigned_by_principal_id, reason
    ) VALUES (
      'assignment:' || gen_random_uuid()::text, 'principal', human_id, department_id,
      member_policy.id, 'active', actor_id, 'Initial employee workspace policy'
    );

    INSERT INTO identity.principals (
      id, principal_key, principal_kind, display_name, status, metadata
    ) VALUES (
      agent_id, p_agent_principal_key, 'agent', btrim(p_agent_display_name),
      'draft', jsonb_build_object('personal_agent', true)
    );
    INSERT INTO identity.department_memberships (
      principal_id, department_id, membership_role, status, approved_by_principal_id
    ) VALUES (agent_id, department_id, 'member', 'active', actor_id);
    INSERT INTO identity.policy_assignments (
      assignment_key, assignment_scope, principal_id, department_id,
      template_id, status, assigned_by_principal_id, reason
    ) VALUES (
      'assignment:' || gen_random_uuid()::text, 'principal', agent_id, department_id,
      agent_policy.id, 'active', actor_id, 'Initial personal agent policy'
    );
    INSERT INTO identity.employee_personal_agents (
      human_principal_id, agent_principal_id, department_id,
      status, created_by_principal_id
    ) VALUES (human_id, agent_id, department_id, 'draft', actor_id);
    -- The one-to-one pair above is authoritative. The generic link is a
    -- compatibility projection for the existing physical provisioner, which
    -- continues to support non-personal linked agents through the same path.
    INSERT INTO identity.principal_links (
      source_principal_id, target_principal_id, link_kind, status, metadata
    ) VALUES (
      human_id, agent_id, 'linked_agent', 'active',
      jsonb_build_object(
        'permission_inheritance', false,
        'authority', 'employee_personal_agents',
        'compatibility_projection', true
      )
    );

    policy_hash := encode(public.digest(
      agent_policy.id::text || ':' || agent_policy.version::text,
      'sha256'
    ), 'hex');
    bootstrap_agent_hash := encode(public.digest(
      gen_random_uuid()::text || ':' || clock_timestamp()::text,
      'sha256'
    ), 'hex');
    INSERT INTO identity.broker_credentials (
      principal_id, token_sha256, policy_template_id, status,
      issued_by_principal_id, metadata
    ) VALUES (
      agent_id, bootstrap_agent_hash, agent_policy.id, 'draft', actor_id,
      jsonb_build_object(
        'bootstrap_unusable', true,
        'profile_key', 'personal-memory-agent-v1',
        'policy_hash', policy_hash
      )
    ) RETURNING id INTO agent_credential_id;
    INSERT INTO identity.runtime_bindings (
      principal_id, binding_kind, binding_value, access_mode, status, metadata
    ) VALUES (
      agent_id, 'broker_client', 'broker:' || agent_id::text, 'brokered', 'draft',
      jsonb_build_object(
        'credential_id', agent_credential_id,
        'policy_hash', policy_hash,
        'profile_key', 'personal-memory-agent-v1'
      )
    );
    INSERT INTO governance.capability_grants (
      principal_id, department_id, policy_template_id,
      capability_task_key, allowed_review_statuses, status, created_by_principal_id
    ) VALUES
      (agent_id, department_id, agent_policy.id, 'website_delivery_handoff',
       ARRAY['approved']::text[], 'draft', actor_id),
      (agent_id, department_id, agent_policy.id, 'personal_context_retrieval',
       ARRAY['approved']::text[], 'draft', actor_id);

    INSERT INTO identity.employee_workspace_credentials (
      token_sha256, human_principal_id, department_id, status,
      expires_at, issued_by_principal_id
    ) VALUES (
      p_workspace_token_sha256, human_id, department_id, 'active',
      p_workspace_expires_at, actor_id
    ) RETURNING id INTO workspace_credential_id;

    profile := personal.bootstrap_employee_profile(
      human_id, agent_id, department_id, p_job_title
    );
    audit_key := audit.record_employee_interaction(
      'employee.onboarded', actor_id, department_id,
      'employee_workspace', human_id::text, 'recorded',
      jsonb_build_object(
        'human_principal_id', human_id,
        'agent_principal_id', agent_id,
        'pair_status', 'draft'
      )
    );
    RETURN jsonb_build_object(
      'human', jsonb_build_object(
        'id', human_id,
        'principal_key', p_human_principal_key,
        'display_name', btrim(p_display_name),
        'status', 'active'
      ),
      'agent', jsonb_build_object(
        'id', agent_id,
        'principal_key', p_agent_principal_key,
        'display_name', btrim(p_agent_display_name),
        'status', 'draft'
      ),
      'pair', jsonb_build_object(
        'department_id', department_id,
        'status', 'draft'
      ),
      'workspace', jsonb_build_object(
        'credential_id', workspace_credential_id,
        'status', 'active',
        'expires_at', p_workspace_expires_at
      ),
      'profile', profile,
      'audit_event_key', audit_key
    );
END
$function$;

CREATE OR REPLACE FUNCTION identity.activate_employee_personal_agent(
    p_agent_principal_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, identity, governance
AS $function$
DECLARE
    actor_id uuid := identity.current_operator_principal_id();
    actor_department_id uuid := identity.current_operator_department_id();
    pair identity.employee_personal_agents%ROWTYPE;
BEGIN
    IF session_user <> 'oam_operator_api'
       OR actor_id IS NULL OR actor_department_id IS NULL
       OR NOT identity.operator_can_onboard_employee(actor_department_id) THEN
        RAISE EXCEPTION 'personal agent activation denied' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO pair
    FROM identity.employee_personal_agents binding
    WHERE binding.agent_principal_id = p_agent_principal_id
      AND binding.department_id = actor_department_id
      AND binding.status IN ('draft', 'suspended')
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'personal agent pair is not activatable' USING ERRCODE = '55000';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM identity.principals agent
      JOIN identity.principals human ON human.id = pair.human_principal_id
      JOIN identity.departments department ON department.id = pair.department_id
      JOIN identity.department_memberships agent_membership
        ON agent_membership.principal_id = agent.id
       AND agent_membership.department_id = department.id
       AND agent_membership.status = 'active'
      JOIN identity.department_memberships human_membership
        ON human_membership.principal_id = human.id
       AND human_membership.department_id = department.id
       AND human_membership.status = 'active'
      JOIN identity.policy_assignments assignment
        ON assignment.principal_id = agent.id
       AND assignment.department_id = department.id
       AND assignment.status = 'active'
      JOIN identity.broker_credentials credential
        ON credential.principal_id = agent.id AND credential.status = 'active'
       AND credential.policy_template_id = assignment.template_id
      JOIN identity.runtime_bindings runtime_binding
        ON runtime_binding.principal_id = agent.id
       AND runtime_binding.binding_kind = 'broker_client'
       AND runtime_binding.access_mode = 'brokered'
       AND runtime_binding.status = 'active'
       AND runtime_binding.metadata->>'credential_id' = credential.id::text
       AND runtime_binding.metadata->>'policy_hash' = credential.metadata->>'policy_hash'
      WHERE agent.id = p_agent_principal_id
        AND agent.principal_kind = 'agent' AND agent.status = 'active'
        AND human.principal_kind = 'human' AND human.status = 'active'
        AND department.status = 'active'
        AND EXISTS (
          SELECT 1 FROM identity.employee_workspace_credentials workspace
          WHERE workspace.human_principal_id = human.id
            AND workspace.department_id = department.id
            AND workspace.status = 'active' AND workspace.expires_at > now()
        )
        AND (
          SELECT count(*) FROM governance.capability_grants capability_grant
          WHERE capability_grant.principal_id = agent.id
            AND capability_grant.department_id = department.id
            AND capability_grant.policy_template_id = credential.policy_template_id
            AND capability_grant.status = 'active'
            AND capability_grant.capability_task_key IN (
              'website_delivery_handoff', 'personal_context_retrieval'
            )
        ) = 2
        AND EXISTS (
          SELECT 1 FROM identity.provisioning_jobs job
          WHERE job.principal_id = agent.id
            AND job.department_id = department.id
            AND job.status = 'succeeded'
            AND (
              job.id::text = credential.metadata->>'activation_job_id'
              OR job.id::text = credential.metadata->>'provisioning_job_id'
            )
        )
    ) THEN
        RAISE EXCEPTION 'physical personal agent provisioning is incomplete' USING ERRCODE = '55000';
    END IF;
    UPDATE identity.employee_personal_agents
    SET status = 'active', activated_at = now(), suspended_at = NULL
    WHERE human_principal_id = pair.human_principal_id;
    RETURN jsonb_build_object(
      'human_principal_id', pair.human_principal_id,
      'agent_principal_id', pair.agent_principal_id,
      'department_id', pair.department_id,
      'status', 'active',
      'activated_at', now()
    );
END
$function$;

CREATE OR REPLACE FUNCTION identity.cascade_employee_personal_agent_suspension()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, identity, governance
AS $function$
DECLARE
    terminal_status text;
BEGIN
    IF NEW.status IS NOT DISTINCT FROM OLD.status
       OR NEW.status NOT IN ('suspended', 'retired') THEN
        RETURN NEW;
    END IF;
    terminal_status := CASE WHEN NEW.status = 'retired' THEN 'retired' ELSE 'suspended' END;

    UPDATE identity.employee_personal_agents pair
    SET status = terminal_status,
        suspended_at = CASE WHEN terminal_status = 'suspended' THEN coalesce(pair.suspended_at, now()) ELSE pair.suspended_at END,
        updated_at = now()
    WHERE (pair.human_principal_id = NEW.id OR pair.agent_principal_id = NEW.id)
      AND pair.status IN ('draft', 'active', 'suspended');

    UPDATE identity.employee_workspace_credentials credential
    SET status = 'revoked', revoked_at = now()
    WHERE credential.human_principal_id IN (
      SELECT pair.human_principal_id
      FROM identity.employee_personal_agents pair
      WHERE pair.human_principal_id = NEW.id OR pair.agent_principal_id = NEW.id
    ) AND credential.status = 'active';

    IF NEW.principal_kind = 'human' THEN
      UPDATE identity.principals agent
      SET status = terminal_status,
          suspended_at = CASE WHEN terminal_status = 'suspended' THEN coalesce(agent.suspended_at, now()) ELSE NULL END,
          updated_at = now()
      FROM identity.employee_personal_agents pair
      WHERE pair.human_principal_id = NEW.id
        AND agent.id = pair.agent_principal_id
        AND agent.status IN ('draft', 'active', 'suspended');

      UPDATE identity.department_memberships membership
      SET status = 'suspended',
          valid_to = coalesce(
            membership.valid_to,
            greatest(clock_timestamp(), membership.valid_from + interval '1 microsecond')
          ),
          updated_at = clock_timestamp()
      FROM identity.employee_personal_agents pair
      WHERE pair.human_principal_id = NEW.id
        AND membership.principal_id = pair.agent_principal_id
        AND membership.status = 'active';
      UPDATE identity.runtime_bindings binding
      SET status = 'suspended',
          valid_to = coalesce(
            binding.valid_to,
            greatest(clock_timestamp(), binding.valid_from + interval '1 microsecond')
          ),
          updated_at = clock_timestamp()
      FROM identity.employee_personal_agents pair
      WHERE pair.human_principal_id = NEW.id
        AND binding.principal_id = pair.agent_principal_id
        AND binding.status IN ('draft', 'active');
      UPDATE identity.broker_credentials credential
      SET status = 'suspended'
      FROM identity.employee_personal_agents pair
      WHERE pair.human_principal_id = NEW.id
        AND credential.principal_id = pair.agent_principal_id
        AND credential.status IN ('draft', 'active');
      UPDATE identity.policy_assignments assignment
      SET status = 'suspended',
          valid_to = coalesce(
            assignment.valid_to,
            greatest(clock_timestamp(), assignment.valid_from + interval '1 microsecond')
          ),
          updated_at = clock_timestamp()
      FROM identity.employee_personal_agents pair
      WHERE pair.human_principal_id = NEW.id
        AND assignment.principal_id = pair.agent_principal_id
        AND assignment.status = 'active';
      UPDATE governance.capability_grants capability_grant
      SET status = 'suspended',
          valid_to = coalesce(
            capability_grant.valid_to,
            greatest(clock_timestamp(), capability_grant.valid_from + interval '1 microsecond')
          ),
          updated_at = clock_timestamp()
      FROM identity.employee_personal_agents pair
      WHERE pair.human_principal_id = NEW.id
        AND capability_grant.principal_id = pair.agent_principal_id
        AND capability_grant.status IN ('draft', 'active');
    END IF;
    RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS principals_personal_agent_suspension
    ON identity.principals;
CREATE TRIGGER principals_personal_agent_suspension
AFTER UPDATE OF status ON identity.principals
FOR EACH ROW EXECUTE FUNCTION identity.cascade_employee_personal_agent_suspension();

REVOKE ALL ON FUNCTION identity.resolve_employee_workspace_token(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.operator_can_onboard_employee(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.onboard_employee_bundle(text, text, text, text, text, text, text, timestamptz)
    FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.activate_employee_personal_agent(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.enforce_employee_personal_agent_pair() FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.enforce_personal_agent_membership_department() FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.validate_active_employee_personal_agent_pair() FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.cascade_employee_personal_agent_suspension() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.resolve_employee_workspace_token(text)
    TO oam_employee_runtime;
GRANT EXECUTE ON FUNCTION identity.onboard_employee_bundle(text, text, text, text, text, text, text, timestamptz),
    identity.activate_employee_personal_agent(uuid)
TO oam_operator_runtime;

RESET ROLE;

GRANT USAGE ON SCHEMA personal TO oam_security_owner;
GRANT EXECUTE ON FUNCTION personal.bootstrap_employee_profile(uuid, uuid, uuid, text)
    TO oam_security_owner;

SET LOCAL ROLE oam_personal_memory_owner;

REVOKE ALL ON FUNCTION personal.valid_json_string_array(jsonb, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION personal.reject_append_only_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION personal.record_domain_event(text, uuid, uuid, uuid, uuid, bigint, bigint, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION personal.bootstrap_employee_profile(uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION personal.employee_workspace() FROM PUBLIC;
REVOKE ALL ON FUNCTION personal.update_employee_profile(bigint, text, text, jsonb, text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION personal.change_employee_profile_sharing(bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION personal.share_employee_profile(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION personal.unshare_employee_profile(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION personal.build_memory_payload(text, text, text, text, text, jsonb, text[], text) FROM PUBLIC;
REVOKE ALL ON FUNCTION personal.create_employee_memory(text, text, text, text, text, jsonb, text[], text) FROM PUBLIC;
REVOKE ALL ON FUNCTION personal.update_employee_memory(uuid, bigint, text, text, text, text, text, jsonb, text[], text) FROM PUBLIC;
REVOKE ALL ON FUNCTION personal.change_employee_memory_sharing(uuid, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION personal.share_employee_memory(uuid, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION personal.unshare_employee_memory(uuid, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION personal.agent_context_document(uuid, uuid, uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION personal.employee_agent_context(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION personal.retrieve_agent_context_for_broker(text, text, text, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION personal.employee_workspace(),
    personal.update_employee_profile(bigint, text, text, jsonb, text, jsonb, text),
    personal.share_employee_profile(bigint),
    personal.unshare_employee_profile(bigint),
    personal.create_employee_memory(text, text, text, text, text, jsonb, text[], text),
    personal.update_employee_memory(uuid, bigint, text, text, text, text, text, jsonb, text[], text),
    personal.share_employee_memory(uuid, bigint),
    personal.unshare_employee_memory(uuid, bigint),
    personal.employee_agent_context(text, integer)
TO oam_employee_runtime;
GRANT EXECUTE ON FUNCTION personal.retrieve_agent_context_for_broker(text, text, text, integer)
    TO oam_broker_runtime;

RESET ROLE;

COMMIT;
