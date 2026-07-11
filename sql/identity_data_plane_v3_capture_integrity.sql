\set ON_ERROR_STOP on

-- Upgrade existing v1 deployments to the immutable capture/review contract.
-- This migration is safe to re-run and deliberately preserves the public API
-- function signatures introduced by v1.

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('organizational-ai-memory:identity-data-plane:v3'));

DO $migration$
BEGIN
    IF to_regclass('quarantine.uploads') IS NULL
       OR to_regclass('quarantine.candidates') IS NULL
       OR to_regclass('governance.candidate_reviews') IS NULL
       OR to_regclass('governance.promotion_events') IS NULL THEN
        RAISE EXCEPTION 'identity data plane v1 must exist before v3';
    END IF;
END
$migration$;

SET LOCAL ROLE oam_security_owner;

-- A sealed content-addressed object may be referenced by more than one
-- authorized upload record. Identity and department authorization remain on
-- the upload row, not on the shared storage key.
DO $drop_storage_uniqueness$
DECLARE
    constraint_row record;
BEGIN
    FOR constraint_row IN
        SELECT constraint_def.conname
        FROM pg_constraint constraint_def
        JOIN pg_attribute attribute_def
          ON attribute_def.attrelid = constraint_def.conrelid
         AND attribute_def.attnum = constraint_def.conkey[1]
        WHERE constraint_def.conrelid = 'quarantine.uploads'::regclass
          AND constraint_def.contype = 'u'
          AND cardinality(constraint_def.conkey) = 1
          AND attribute_def.attname = 'storage_key'
    LOOP
        EXECUTE format(
            'ALTER TABLE quarantine.uploads DROP CONSTRAINT %I',
            constraint_row.conname
        );
    END LOOP;
END
$drop_storage_uniqueness$;

CREATE INDEX IF NOT EXISTS quarantine_uploads_storage_key_idx
    ON quarantine.uploads (storage_key);

-- Rescans must be append-only so a later adverse verdict can revoke an
-- earlier clean decision for the same scanner and content hash.
DO $drop_scan_finding_uniqueness$
DECLARE
    constraint_row record;
BEGIN
    FOR constraint_row IN
        SELECT constraint_def.conname
        FROM pg_constraint constraint_def
        WHERE constraint_def.conrelid = 'quarantine.scan_findings'::regclass
          AND constraint_def.contype = 'u'
          AND pg_get_constraintdef(constraint_def.oid) LIKE '%(upload_id, scanner_key, content_sha256)%'
    LOOP
        EXECUTE format(
            'ALTER TABLE quarantine.scan_findings DROP CONSTRAINT %I',
            constraint_row.conname
        );
    END LOOP;
END
$drop_scan_finding_uniqueness$;

CREATE INDEX IF NOT EXISTS quarantine_scan_findings_latest_idx
    ON quarantine.scan_findings (upload_id, scanned_at DESC, id DESC);

DO $upload_binding_key$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'quarantine.uploads'::regclass
          AND conname = 'quarantine_uploads_capture_binding_key'
    ) THEN
        ALTER TABLE quarantine.uploads
            ADD CONSTRAINT quarantine_uploads_capture_binding_key
            UNIQUE (id, submitted_by_principal_id, owning_department_id, sha256);
    END IF;
END
$upload_binding_key$;

ALTER TABLE quarantine.candidates
    ADD COLUMN IF NOT EXISTS submitted_by_principal_id uuid,
    ADD COLUMN IF NOT EXISTS source_upload_sha256 text,
    ADD COLUMN IF NOT EXISTS approved_content_hash text;

UPDATE quarantine.candidates candidate
SET submitted_by_principal_id = upload.submitted_by_principal_id,
    source_upload_sha256 = upload.sha256
FROM quarantine.uploads upload
WHERE upload.id = candidate.upload_id
  AND (
      candidate.submitted_by_principal_id IS NULL
      OR candidate.source_upload_sha256 IS NULL
  );

-- A v1 review did not persist the reviewed hash. Do not bless current mutable
-- bytes during upgrade. Reviewed candidates return to review_pending. A
-- promoted candidate is retained only when its immutable draft proves the
-- current payload hash.
DO $legacy_approval_guard$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM quarantine.candidates candidate
        LEFT JOIN governance.promotion_drafts draft ON draft.candidate_id = candidate.id
        WHERE candidate.status = 'promoted_to_draft'
          AND (
              draft.id IS NULL
              OR draft.content_hash IS DISTINCT FROM candidate.content_hash
              OR encode(digest(draft.draft_payload::text, 'sha256'), 'hex')
                   IS DISTINCT FROM candidate.content_hash
          )
    ) THEN
        RAISE EXCEPTION 'legacy promoted candidate cannot prove immutable content';
    END IF;
END
$legacy_approval_guard$;

UPDATE quarantine.candidates
SET status = 'review_pending',
    approved_content_hash = NULL,
    revision = revision + 1,
    updated_at = now()
WHERE status = 'reviewed';

UPDATE quarantine.candidates candidate
SET approved_content_hash = CASE
    WHEN candidate.status = 'promoted_to_draft' THEN candidate.content_hash
    ELSE NULL
END
WHERE candidate.approved_content_hash IS DISTINCT FROM CASE
    WHEN candidate.status = 'promoted_to_draft' THEN candidate.content_hash
    ELSE NULL
END;

DO $candidate_binding_guard$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM quarantine.candidates candidate
        LEFT JOIN quarantine.uploads upload
          ON upload.id = candidate.upload_id
         AND upload.submitted_by_principal_id = candidate.submitted_by_principal_id
         AND upload.owning_department_id = candidate.owning_department_id
         AND upload.sha256 = candidate.source_upload_sha256
        WHERE upload.id IS NULL
    ) THEN
        RAISE EXCEPTION 'existing candidate is not bound to its source upload';
    END IF;
END
$candidate_binding_guard$;

ALTER TABLE quarantine.candidates
    ALTER COLUMN submitted_by_principal_id SET NOT NULL,
    ALTER COLUMN source_upload_sha256 SET NOT NULL;

DO $candidate_constraints$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'quarantine.candidates'::regclass
          AND conname = 'quarantine_candidates_submitted_by_fkey'
    ) THEN
        ALTER TABLE quarantine.candidates
            ADD CONSTRAINT quarantine_candidates_submitted_by_fkey
            FOREIGN KEY (submitted_by_principal_id)
            REFERENCES identity.principals(id) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'quarantine.candidates'::regclass
          AND conname = 'quarantine_candidates_source_hash_check'
    ) THEN
        ALTER TABLE quarantine.candidates
            ADD CONSTRAINT quarantine_candidates_source_hash_check
            CHECK (source_upload_sha256 ~ '^[a-f0-9]{64}$');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'quarantine.candidates'::regclass
          AND conname = 'quarantine_candidates_approved_hash_check'
    ) THEN
        ALTER TABLE quarantine.candidates
            ADD CONSTRAINT quarantine_candidates_approved_hash_check
            CHECK (approved_content_hash IS NULL OR approved_content_hash ~ '^[a-f0-9]{64}$');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'quarantine.candidates'::regclass
          AND conname = 'quarantine_candidates_approval_integrity_check'
    ) THEN
        ALTER TABLE quarantine.candidates
            ADD CONSTRAINT quarantine_candidates_approval_integrity_check CHECK (
                (
                    status IN ('reviewed', 'promoted_to_draft')
                    AND approved_content_hash = content_hash
                ) OR (
                    status NOT IN ('reviewed', 'promoted_to_draft')
                    AND approved_content_hash IS NULL
                )
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'quarantine.candidates'::regclass
          AND conname = 'quarantine_candidates_upload_binding_fkey'
    ) THEN
        ALTER TABLE quarantine.candidates
            ADD CONSTRAINT quarantine_candidates_upload_binding_fkey FOREIGN KEY (
                upload_id,
                submitted_by_principal_id,
                owning_department_id,
                source_upload_sha256
            ) REFERENCES quarantine.uploads (
                id,
                submitted_by_principal_id,
                owning_department_id,
                sha256
            ) ON DELETE RESTRICT;
    END IF;
END
$candidate_constraints$;

ALTER TABLE governance.candidate_reviews
    ADD COLUMN IF NOT EXISTS candidate_content_hash text;

UPDATE governance.candidate_reviews review
SET candidate_content_hash = candidate.content_hash
FROM quarantine.candidates candidate
WHERE candidate.id = review.candidate_id
  AND review.candidate_content_hash IS NULL;

ALTER TABLE governance.candidate_reviews
    ALTER COLUMN candidate_content_hash SET NOT NULL;

DO $review_constraints$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'governance.candidate_reviews'::regclass
          AND conname = 'candidate_reviews_content_hash_check'
    ) THEN
        ALTER TABLE governance.candidate_reviews
            ADD CONSTRAINT candidate_reviews_content_hash_check
            CHECK (candidate_content_hash ~ '^[a-f0-9]{64}$');
    END IF;
END
$review_constraints$;

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
GRANT EXECUTE ON FUNCTION governance.record_candidate_review(uuid, uuid, text, text, integer)
    TO oam_operator_runtime, oam_reviewer_runtime;
GRANT EXECUTE ON FUNCTION governance.promote_candidate_to_draft(uuid, uuid, integer, uuid)
    TO oam_operator_runtime, oam_promoter_runtime;

GRANT INSERT ON TABLE quarantine.candidates TO oam_operator_runtime;
REVOKE UPDATE ON TABLE quarantine.candidates FROM oam_operator_runtime;

COMMIT;
