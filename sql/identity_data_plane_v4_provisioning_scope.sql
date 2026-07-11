\set ON_ERROR_STOP on

-- Bind every provisioning authorization and state transition to one
-- department. Existing jobs are migrated only when the requester and target
-- share exactly one department, so ambiguous history fails closed.

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('organizational-ai-memory:identity-data-plane:v4'));

SET LOCAL ROLE oam_security_owner;

ALTER TABLE identity.provisioning_jobs
    ADD COLUMN IF NOT EXISTS department_id uuid;

WITH inferred AS (
    SELECT job.id,
           min(target_membership.department_id::text)::uuid AS department_id,
           count(DISTINCT target_membership.department_id) AS department_count
    FROM identity.provisioning_jobs job
    JOIN identity.department_memberships target_membership
      ON target_membership.principal_id = job.principal_id
    JOIN identity.department_memberships requester_membership
      ON requester_membership.principal_id = job.requested_by_principal_id
     AND requester_membership.department_id = target_membership.department_id
    WHERE job.department_id IS NULL
    GROUP BY job.id
)
UPDATE identity.provisioning_jobs job
SET department_id = inferred.department_id
FROM inferred
WHERE job.id = inferred.id
  AND inferred.department_count = 1;

DO $scope_guard$
BEGIN
    IF EXISTS (SELECT 1 FROM identity.provisioning_jobs WHERE department_id IS NULL) THEN
        RAISE EXCEPTION 'existing provisioning job has ambiguous department scope';
    END IF;
END
$scope_guard$;

ALTER TABLE identity.provisioning_jobs
    ALTER COLUMN department_id SET NOT NULL;

DO $department_foreign_key$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'identity.provisioning_jobs'::regclass
          AND conname = 'provisioning_jobs_department_id_fkey'
    ) THEN
        ALTER TABLE identity.provisioning_jobs
            ADD CONSTRAINT provisioning_jobs_department_id_fkey
            FOREIGN KEY (department_id)
            REFERENCES identity.departments(id) ON DELETE RESTRICT;
    END IF;
END
$department_foreign_key$;

DROP INDEX IF EXISTS identity.provisioning_jobs_principal_status_idx;
CREATE INDEX provisioning_jobs_principal_status_idx
    ON identity.provisioning_jobs (
        department_id, principal_id, status, requested_at DESC
    );

GRANT SELECT ON TABLE identity.provisioning_jobs TO oam_broker_runtime;

COMMIT;
