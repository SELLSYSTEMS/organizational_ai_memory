\set ON_ERROR_STOP on

-- Close the final adversarial-review gaps in policy immutability, proof scope,
-- and append-only capture evidence. Existing proof rows are accepted only when
-- their recorder resolves to exactly one department.

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('organizational-ai-memory:identity-data-plane:v6'));

SET LOCAL ROLE oam_security_owner;

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
        RAISE EXCEPTION 'activated policy template cannot return to draft' USING ERRCODE = '55000';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status IN ('superseded', 'retired')
       AND NEW.status IS DISTINCT FROM OLD.status THEN
        RAISE EXCEPTION 'terminal policy template status is immutable' USING ERRCODE = '55000';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END
$function$;

ALTER TABLE identity.proof_runs
    ADD COLUMN IF NOT EXISTS department_id uuid;

RESET ROLE;

WITH inferred AS (
    SELECT proof.id,
           min(membership.department_id::text)::uuid AS department_id,
           count(DISTINCT membership.department_id) AS department_count
    FROM identity.proof_runs proof
    JOIN identity.department_memberships membership
      ON membership.principal_id = proof.recorded_by_principal_id
    WHERE proof.department_id IS NULL
    GROUP BY proof.id
)
UPDATE identity.proof_runs proof
SET department_id = inferred.department_id
FROM inferred
WHERE proof.id = inferred.id
  AND inferred.department_count = 1;

DO $proof_scope_guard$
BEGIN
    IF EXISTS (SELECT 1 FROM identity.proof_runs WHERE department_id IS NULL) THEN
        RAISE EXCEPTION 'existing proof run has ambiguous department scope';
    END IF;
END
$proof_scope_guard$;

SET LOCAL ROLE oam_security_owner;

ALTER TABLE identity.proof_runs
    ALTER COLUMN department_id SET NOT NULL;

DO $proof_department_foreign_key$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'identity.proof_runs'::regclass
          AND conname = 'proof_runs_department_id_fkey'
    ) THEN
        ALTER TABLE identity.proof_runs
            ADD CONSTRAINT proof_runs_department_id_fkey
            FOREIGN KEY (department_id)
            REFERENCES identity.departments(id) ON DELETE RESTRICT;
    END IF;
END
$proof_department_foreign_key$;

CREATE INDEX IF NOT EXISTS proof_runs_department_time_idx
    ON identity.proof_runs (department_id, executed_at DESC, id);

CREATE OR REPLACE FUNCTION identity.reject_capture_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
    RAISE EXCEPTION 'capture evidence is append-only' USING ERRCODE = '55000';
END
$function$;

DROP TRIGGER IF EXISTS scan_findings_append_only
    ON quarantine.scan_findings;
CREATE TRIGGER scan_findings_append_only
BEFORE UPDATE OR DELETE ON quarantine.scan_findings
FOR EACH ROW EXECUTE FUNCTION identity.reject_capture_evidence_mutation();

DROP TRIGGER IF EXISTS candidate_evidence_append_only
    ON quarantine.candidate_evidence;
CREATE TRIGGER candidate_evidence_append_only
BEFORE UPDATE OR DELETE ON quarantine.candidate_evidence
FOR EACH ROW EXECUTE FUNCTION identity.reject_capture_evidence_mutation();

REVOKE UPDATE ON TABLE
    quarantine.scan_findings,
    quarantine.candidate_evidence
FROM oam_operator_runtime;

CREATE OR REPLACE FUNCTION identity.reject_security_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
    RAISE EXCEPTION 'security history is append-only' USING ERRCODE = '55000';
END
$function$;

DROP TRIGGER IF EXISTS provisioning_events_append_only
    ON identity.provisioning_events;
CREATE TRIGGER provisioning_events_append_only
BEFORE UPDATE OR DELETE ON identity.provisioning_events
FOR EACH ROW EXECUTE FUNCTION identity.reject_security_history_mutation();

DROP TRIGGER IF EXISTS proof_runs_append_only
    ON identity.proof_runs;
CREATE TRIGGER proof_runs_append_only
BEFORE UPDATE OR DELETE ON identity.proof_runs
FOR EACH ROW EXECUTE FUNCTION identity.reject_security_history_mutation();

REVOKE UPDATE ON TABLE
    identity.provisioning_events,
    identity.proof_runs
FROM oam_operator_runtime;

COMMIT;
