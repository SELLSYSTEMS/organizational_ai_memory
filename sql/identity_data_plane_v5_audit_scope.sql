\set ON_ERROR_STOP on

-- Persist department scope on operator-facing audit events. Public and
-- workload-level events may remain NULL and are excluded from department
-- console reads.

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('organizational-ai-memory:identity-data-plane:v5'));

SET LOCAL ROLE oam_audit_owner;

ALTER TABLE audit.security_events
    ADD COLUMN IF NOT EXISTS department_id uuid;

RESET ROLE;

UPDATE audit.security_events event
SET department_id = (event.payload->>'department_id')::uuid
WHERE event.department_id IS NULL
  AND event.payload->>'department_id' ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND EXISTS (
      SELECT 1 FROM identity.departments department
      WHERE department.id = (event.payload->>'department_id')::uuid
  );

UPDATE audit.security_events event
SET department_id = candidate.owning_department_id
FROM quarantine.candidates candidate
WHERE event.department_id IS NULL
  AND event.resource_type = 'candidate'
  AND event.resource_key IN (candidate.id::text, candidate.candidate_key);

UPDATE audit.security_events event
SET department_id = upload.owning_department_id
FROM quarantine.uploads upload
WHERE event.department_id IS NULL
  AND event.resource_type = 'quarantined_upload'
  AND event.resource_key IN (upload.id::text, upload.upload_key);

WITH unique_membership AS (
    SELECT membership.principal_id,
           min(membership.department_id::text)::uuid AS department_id
    FROM identity.department_memberships membership
    GROUP BY membership.principal_id
    HAVING count(DISTINCT membership.department_id) = 1
)
UPDATE audit.security_events event
SET department_id = unique_membership.department_id
FROM unique_membership
WHERE event.department_id IS NULL
  AND event.actor_principal_id = unique_membership.principal_id
  AND event.workload_role = 'oam_operator_api';

SET LOCAL ROLE oam_audit_owner;

CREATE INDEX IF NOT EXISTS security_events_department_time_idx
    ON audit.security_events (department_id, occurred_at DESC, id DESC);

COMMIT;
