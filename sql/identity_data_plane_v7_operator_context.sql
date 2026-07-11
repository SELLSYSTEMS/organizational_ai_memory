\set ON_ERROR_STOP on

-- Bind the shared operator workload login to one authenticated human and one
-- department with an unguessable root-managed credential hash. RLS never
-- trusts caller-supplied UUIDs or custom GUC values by themselves.

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('organizational-ai-memory:identity-data-plane:v7'));

SET LOCAL ROLE oam_security_owner;

CREATE TABLE IF NOT EXISTS identity.operator_context_credentials (
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
REVOKE ALL ON TABLE identity.operator_context_credentials
    FROM oam_operator_runtime, oam_broker_runtime, oam_public_runtime;
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

ALTER TABLE identity.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.departments FORCE ROW LEVEL SECURITY;
ALTER TABLE identity.principals ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.principals FORCE ROW LEVEL SECURITY;
ALTER TABLE identity.department_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.department_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE identity.principal_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.principal_links FORCE ROW LEVEL SECURITY;
ALTER TABLE identity.runtime_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.runtime_bindings FORCE ROW LEVEL SECURITY;
ALTER TABLE identity.policy_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.policy_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE identity.policy_template_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.policy_template_rules FORCE ROW LEVEL SECURITY;
ALTER TABLE identity.provisioning_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.provisioning_jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE identity.provisioning_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.provisioning_events FORCE ROW LEVEL SECURITY;
ALTER TABLE identity.proof_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.proof_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE quarantine.uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE quarantine.uploads FORCE ROW LEVEL SECURITY;
ALTER TABLE quarantine.scan_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE quarantine.scan_findings FORCE ROW LEVEL SECURITY;
ALTER TABLE quarantine.candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE quarantine.candidates FORCE ROW LEVEL SECURITY;
ALTER TABLE quarantine.candidate_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE quarantine.candidate_evidence FORCE ROW LEVEL SECURITY;
ALTER TABLE governance.candidate_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance.candidate_reviews FORCE ROW LEVEL SECURITY;
ALTER TABLE governance.promotion_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance.promotion_drafts FORCE ROW LEVEL SECURITY;
ALTER TABLE governance.promotion_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance.promotion_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS departments_operator_scope ON identity.departments;
CREATE POLICY departments_operator_scope ON identity.departments
    FOR ALL TO oam_operator_runtime
    USING (id = identity.current_operator_department_id())
    WITH CHECK (id = identity.current_operator_department_id());
DROP POLICY IF EXISTS departments_owner_scope ON identity.departments;
CREATE POLICY departments_owner_scope ON identity.departments
    FOR ALL TO oam_security_owner USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS departments_broker_read ON identity.departments;
CREATE POLICY departments_broker_read ON identity.departments
    FOR SELECT TO oam_broker_runtime USING (true);

DROP POLICY IF EXISTS principals_operator_scope ON identity.principals;
CREATE POLICY principals_operator_scope ON identity.principals
    FOR ALL TO oam_operator_runtime
    USING (
      id = identity.current_operator_principal_id()
      OR EXISTS (
        SELECT 1 FROM identity.department_memberships membership
        WHERE membership.principal_id = principals.id
          AND membership.department_id = identity.current_operator_department_id()
        )
    )
    WITH CHECK (identity.current_operator_principal_id() IS NOT NULL);
DROP POLICY IF EXISTS principals_owner_scope ON identity.principals;
CREATE POLICY principals_owner_scope ON identity.principals
    FOR ALL TO oam_security_owner USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS principals_broker_read ON identity.principals;
CREATE POLICY principals_broker_read ON identity.principals
    FOR SELECT TO oam_broker_runtime USING (true);

DROP POLICY IF EXISTS memberships_operator_scope ON identity.department_memberships;
CREATE POLICY memberships_operator_scope ON identity.department_memberships
    FOR ALL TO oam_operator_runtime
    USING (department_id = identity.current_operator_department_id())
    WITH CHECK (department_id = identity.current_operator_department_id());
DROP POLICY IF EXISTS memberships_owner_scope ON identity.department_memberships;
CREATE POLICY memberships_owner_scope ON identity.department_memberships
    FOR ALL TO oam_security_owner USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS memberships_broker_read ON identity.department_memberships;
CREATE POLICY memberships_broker_read ON identity.department_memberships
    FOR SELECT TO oam_broker_runtime USING (true);

DROP POLICY IF EXISTS links_operator_scope ON identity.principal_links;
CREATE POLICY links_operator_scope ON identity.principal_links
    FOR ALL TO oam_operator_runtime
    USING (EXISTS (
      SELECT 1 FROM identity.department_memberships membership
      WHERE membership.department_id = identity.current_operator_department_id()
        AND membership.principal_id = principal_links.source_principal_id
    ) AND EXISTS (
      SELECT 1 FROM identity.department_memberships membership
      WHERE membership.department_id = identity.current_operator_department_id()
        AND membership.principal_id = principal_links.target_principal_id
    ))
    WITH CHECK (EXISTS (
      SELECT 1 FROM identity.department_memberships membership
      WHERE membership.department_id = identity.current_operator_department_id()
        AND membership.principal_id = principal_links.source_principal_id
    ) AND EXISTS (
      SELECT 1 FROM identity.department_memberships membership
      WHERE membership.department_id = identity.current_operator_department_id()
        AND membership.principal_id = principal_links.target_principal_id
    ));
DROP POLICY IF EXISTS links_owner_scope ON identity.principal_links;
CREATE POLICY links_owner_scope ON identity.principal_links
    FOR ALL TO oam_security_owner USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS links_broker_read ON identity.principal_links;
CREATE POLICY links_broker_read ON identity.principal_links
    FOR SELECT TO oam_broker_runtime USING (true);

DROP POLICY IF EXISTS bindings_operator_scope ON identity.runtime_bindings;
CREATE POLICY bindings_operator_scope ON identity.runtime_bindings
    FOR ALL TO oam_operator_runtime
    USING (EXISTS (
      SELECT 1 FROM identity.department_memberships membership
      WHERE membership.principal_id = runtime_bindings.principal_id
        AND membership.department_id = identity.current_operator_department_id()
    ))
    WITH CHECK (EXISTS (
      SELECT 1 FROM identity.department_memberships membership
      WHERE membership.principal_id = runtime_bindings.principal_id
        AND membership.department_id = identity.current_operator_department_id()
    ));
DROP POLICY IF EXISTS bindings_owner_scope ON identity.runtime_bindings;
CREATE POLICY bindings_owner_scope ON identity.runtime_bindings
    FOR ALL TO oam_security_owner USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS bindings_broker_read ON identity.runtime_bindings;
CREATE POLICY bindings_broker_read ON identity.runtime_bindings
    FOR SELECT TO oam_broker_runtime USING (true);

DROP POLICY IF EXISTS templates_operator_scope ON identity.policy_templates;
CREATE POLICY templates_operator_scope ON identity.policy_templates
    FOR ALL TO oam_operator_runtime
    USING (EXISTS (
      SELECT 1 FROM identity.policy_assignments assignment
      WHERE assignment.template_id = policy_templates.id
        AND assignment.department_id = identity.current_operator_department_id()
    ))
    WITH CHECK (identity.current_operator_principal_id() IS NOT NULL);
DROP POLICY IF EXISTS templates_owner_scope ON identity.policy_templates;
CREATE POLICY templates_owner_scope ON identity.policy_templates
    FOR ALL TO oam_security_owner USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS templates_broker_read ON identity.policy_templates;
CREATE POLICY templates_broker_read ON identity.policy_templates
    FOR SELECT TO oam_broker_runtime USING (true);

DROP POLICY IF EXISTS rules_operator_scope ON identity.policy_template_rules;
CREATE POLICY rules_operator_scope ON identity.policy_template_rules
    FOR ALL TO oam_operator_runtime
    USING (EXISTS (
      SELECT 1 FROM identity.policy_assignments assignment
      WHERE assignment.template_id = policy_template_rules.template_id
        AND assignment.department_id = identity.current_operator_department_id()
    ))
    WITH CHECK (identity.current_operator_principal_id() IS NOT NULL);
DROP POLICY IF EXISTS rules_owner_scope ON identity.policy_template_rules;
CREATE POLICY rules_owner_scope ON identity.policy_template_rules
    FOR ALL TO oam_security_owner USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS rules_broker_read ON identity.policy_template_rules;
CREATE POLICY rules_broker_read ON identity.policy_template_rules
    FOR SELECT TO oam_broker_runtime USING (true);

DROP POLICY IF EXISTS broker_credentials_operator_policy ON identity.broker_credentials;
CREATE POLICY broker_credentials_operator_policy ON identity.broker_credentials
    FOR ALL TO oam_operator_runtime
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
DROP POLICY IF EXISTS broker_credentials_owner_policy ON identity.broker_credentials;
CREATE POLICY broker_credentials_owner_policy ON identity.broker_credentials
    FOR ALL TO oam_security_owner USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS policy_assignments_operator_policy ON identity.policy_assignments;
CREATE POLICY policy_assignments_operator_policy ON identity.policy_assignments
    FOR ALL TO oam_operator_runtime
    USING (department_id = identity.current_operator_department_id())
    WITH CHECK (department_id = identity.current_operator_department_id());
DROP POLICY IF EXISTS policy_assignments_owner_policy ON identity.policy_assignments;
CREATE POLICY policy_assignments_owner_policy ON identity.policy_assignments
    FOR ALL TO oam_security_owner USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS explicit_permission_denials_operator_policy
    ON identity.explicit_permission_denials;
CREATE POLICY explicit_permission_denials_operator_policy
    ON identity.explicit_permission_denials
    FOR ALL TO oam_operator_runtime
    USING (department_id = identity.current_operator_department_id())
    WITH CHECK (department_id = identity.current_operator_department_id());
DROP POLICY IF EXISTS explicit_permission_denials_owner_policy
    ON identity.explicit_permission_denials;
CREATE POLICY explicit_permission_denials_owner_policy
    ON identity.explicit_permission_denials
    FOR ALL TO oam_security_owner USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS jobs_operator_scope ON identity.provisioning_jobs;
CREATE POLICY jobs_operator_scope ON identity.provisioning_jobs
    FOR ALL TO oam_operator_runtime
    USING (department_id = identity.current_operator_department_id())
    WITH CHECK (department_id = identity.current_operator_department_id());
DROP POLICY IF EXISTS jobs_owner_scope ON identity.provisioning_jobs;
CREATE POLICY jobs_owner_scope ON identity.provisioning_jobs
    FOR ALL TO oam_security_owner USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS jobs_broker_read ON identity.provisioning_jobs;
CREATE POLICY jobs_broker_read ON identity.provisioning_jobs
    FOR SELECT TO oam_broker_runtime USING (true);

DROP POLICY IF EXISTS provisioning_events_operator_scope ON identity.provisioning_events;
CREATE POLICY provisioning_events_operator_scope ON identity.provisioning_events
    FOR ALL TO oam_operator_runtime
    USING (EXISTS (
      SELECT 1 FROM identity.provisioning_jobs job
      WHERE job.id = provisioning_events.job_id
        AND job.department_id = identity.current_operator_department_id()
    ))
    WITH CHECK (EXISTS (
      SELECT 1 FROM identity.provisioning_jobs job
      WHERE job.id = provisioning_events.job_id
        AND job.department_id = identity.current_operator_department_id()
    ));
DROP POLICY IF EXISTS provisioning_events_owner_scope ON identity.provisioning_events;
CREATE POLICY provisioning_events_owner_scope ON identity.provisioning_events
    FOR ALL TO oam_security_owner USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS proof_runs_operator_scope ON identity.proof_runs;
CREATE POLICY proof_runs_operator_scope ON identity.proof_runs
    FOR ALL TO oam_operator_runtime
    USING (department_id = identity.current_operator_department_id())
    WITH CHECK (department_id = identity.current_operator_department_id());
DROP POLICY IF EXISTS proof_runs_owner_scope ON identity.proof_runs;
CREATE POLICY proof_runs_owner_scope ON identity.proof_runs
    FOR ALL TO oam_security_owner USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS uploads_operator_scope ON quarantine.uploads;
CREATE POLICY uploads_operator_scope ON quarantine.uploads
    FOR ALL TO oam_operator_runtime
    USING (owning_department_id = identity.current_operator_department_id())
    WITH CHECK (owning_department_id = identity.current_operator_department_id());
DROP POLICY IF EXISTS uploads_owner_scope ON quarantine.uploads;
CREATE POLICY uploads_owner_scope ON quarantine.uploads
    FOR ALL TO oam_security_owner USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS scans_operator_scope ON quarantine.scan_findings;
CREATE POLICY scans_operator_scope ON quarantine.scan_findings
    FOR ALL TO oam_operator_runtime
    USING (EXISTS (
      SELECT 1 FROM quarantine.uploads upload
      WHERE upload.id = scan_findings.upload_id
        AND upload.owning_department_id = identity.current_operator_department_id()
    ))
    WITH CHECK (EXISTS (
      SELECT 1 FROM quarantine.uploads upload
      WHERE upload.id = scan_findings.upload_id
        AND upload.owning_department_id = identity.current_operator_department_id()
    ));
DROP POLICY IF EXISTS scans_owner_scope ON quarantine.scan_findings;
CREATE POLICY scans_owner_scope ON quarantine.scan_findings
    FOR ALL TO oam_security_owner USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS candidates_operator_scope ON quarantine.candidates;
CREATE POLICY candidates_operator_scope ON quarantine.candidates
    FOR SELECT TO oam_operator_runtime
    USING (owning_department_id = identity.current_operator_department_id());
DROP POLICY IF EXISTS candidates_insert_scope ON quarantine.candidates;
CREATE POLICY candidates_insert_scope ON quarantine.candidates
    FOR INSERT TO oam_operator_runtime
    WITH CHECK (owning_department_id = identity.current_operator_department_id());
DROP POLICY IF EXISTS candidates_owner_scope ON quarantine.candidates;
CREATE POLICY candidates_owner_scope ON quarantine.candidates
    FOR ALL TO oam_security_owner USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS candidate_evidence_operator_scope ON quarantine.candidate_evidence;
CREATE POLICY candidate_evidence_operator_scope ON quarantine.candidate_evidence
    FOR SELECT TO oam_operator_runtime
    USING (EXISTS (
      SELECT 1 FROM quarantine.candidates candidate
      WHERE candidate.id = candidate_evidence.candidate_id
        AND candidate.owning_department_id = identity.current_operator_department_id()
    ));
DROP POLICY IF EXISTS candidate_evidence_insert_scope ON quarantine.candidate_evidence;
CREATE POLICY candidate_evidence_insert_scope ON quarantine.candidate_evidence
    FOR INSERT TO oam_operator_runtime
    WITH CHECK (EXISTS (
      SELECT 1 FROM quarantine.candidates candidate
      WHERE candidate.id = candidate_evidence.candidate_id
        AND candidate.owning_department_id = identity.current_operator_department_id()
    ));
DROP POLICY IF EXISTS candidate_evidence_owner_scope ON quarantine.candidate_evidence;
CREATE POLICY candidate_evidence_owner_scope ON quarantine.candidate_evidence
    FOR ALL TO oam_security_owner USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS reviews_operator_scope ON governance.candidate_reviews;
CREATE POLICY reviews_operator_scope ON governance.candidate_reviews
    FOR SELECT TO oam_operator_runtime
    USING (EXISTS (
      SELECT 1 FROM quarantine.candidates candidate
      WHERE candidate.id = candidate_reviews.candidate_id
        AND candidate.owning_department_id = identity.current_operator_department_id()
    ));
DROP POLICY IF EXISTS reviews_owner_scope ON governance.candidate_reviews;
CREATE POLICY reviews_owner_scope ON governance.candidate_reviews
    FOR ALL TO oam_security_owner USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS drafts_operator_scope ON governance.promotion_drafts;
CREATE POLICY drafts_operator_scope ON governance.promotion_drafts
    FOR SELECT TO oam_operator_runtime
    USING (EXISTS (
      SELECT 1 FROM quarantine.candidates candidate
      WHERE candidate.id = promotion_drafts.candidate_id
        AND candidate.owning_department_id = identity.current_operator_department_id()
    ));
DROP POLICY IF EXISTS drafts_owner_scope ON governance.promotion_drafts;
CREATE POLICY drafts_owner_scope ON governance.promotion_drafts
    FOR ALL TO oam_security_owner USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS promotion_events_operator_scope ON governance.promotion_events;
CREATE POLICY promotion_events_operator_scope ON governance.promotion_events
    FOR SELECT TO oam_operator_runtime
    USING (EXISTS (
      SELECT 1 FROM quarantine.candidates candidate
      WHERE candidate.id = promotion_events.candidate_id
        AND candidate.owning_department_id = identity.current_operator_department_id()
    ));
DROP POLICY IF EXISTS promotion_events_owner_scope ON governance.promotion_events;
CREATE POLICY promotion_events_owner_scope ON governance.promotion_events
    FOR ALL TO oam_security_owner USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS capability_grants_operator_policy ON governance.capability_grants;
CREATE POLICY capability_grants_operator_policy ON governance.capability_grants
    FOR ALL TO oam_operator_runtime
    USING (department_id = identity.current_operator_department_id())
    WITH CHECK (department_id = identity.current_operator_department_id());
DROP POLICY IF EXISTS capability_grants_owner_policy ON governance.capability_grants;
CREATE POLICY capability_grants_owner_policy ON governance.capability_grants
    FOR ALL TO oam_security_owner USING (true) WITH CHECK (true);

-- Policy definitions and departments are installer-owned. The operator API
-- can read their scoped projections but cannot manufacture or rewrite them.
REVOKE INSERT, UPDATE, DELETE ON TABLE
    identity.departments,
    identity.policy_templates,
    identity.policy_template_rules
FROM oam_operator_runtime;

RESET ROLE;
GRANT USAGE ON SCHEMA identity TO oam_audit_owner;
GRANT EXECUTE ON FUNCTION identity.current_operator_department_id()
    TO oam_audit_owner;
SET LOCAL ROLE oam_audit_owner;

ALTER TABLE audit.security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.security_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS security_events_operator_scope ON audit.security_events;
CREATE POLICY security_events_operator_scope ON audit.security_events
    FOR ALL TO oam_operator_runtime
    USING (department_id = identity.current_operator_department_id())
    WITH CHECK (department_id = identity.current_operator_department_id());
DROP POLICY IF EXISTS security_events_owner_scope ON audit.security_events;
CREATE POLICY security_events_owner_scope ON audit.security_events
    FOR ALL TO oam_audit_owner USING (true) WITH CHECK (true);

COMMIT;
