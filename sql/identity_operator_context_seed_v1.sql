\set ON_ERROR_STOP on

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('organizational-ai-memory:operator-context-seed:v1'));

CREATE TEMP TABLE expected_operator_context_hashes (
    token_sha256 text PRIMARY KEY
) ON COMMIT DROP;
INSERT INTO expected_operator_context_hashes (token_sha256)
VALUES (:'architect_hash'), (:'reviewer_hash');

INSERT INTO identity.operator_context_credentials (
    token_sha256,
    principal_id,
    department_id,
    status
)
SELECT :'architect_hash',
       principal.id,
       department.id,
       'active'
FROM identity.principals principal
JOIN identity.departments department
  ON department.department_key = 'digital_delivery'
WHERE principal.principal_key = 'human:ai_architect'
ON CONFLICT (principal_id, department_id) DO UPDATE
SET token_sha256 = EXCLUDED.token_sha256,
    status = 'active',
    updated_at = now();

INSERT INTO identity.operator_context_credentials (
    token_sha256,
    principal_id,
    department_id,
    status
)
SELECT :'reviewer_hash',
       principal.id,
       department.id,
       'active'
FROM identity.principals principal
JOIN identity.departments department
  ON department.department_key = 'digital_delivery'
WHERE principal.principal_key = 'human:capability_reviewer'
ON CONFLICT (principal_id, department_id) DO UPDATE
SET token_sha256 = EXCLUDED.token_sha256,
    status = 'active',
    updated_at = now();

UPDATE identity.operator_context_credentials
SET status = 'retired', updated_at = now()
WHERE token_sha256 NOT IN (
    SELECT token_sha256 FROM expected_operator_context_hashes
)
  AND status = 'active';

DO $mapping_guard$
BEGIN
    IF (
      SELECT count(*)
      FROM identity.operator_context_credentials
      WHERE token_sha256 IN (
        SELECT token_sha256 FROM expected_operator_context_hashes
      )
        AND status = 'active'
    ) <> 2 THEN
        RAISE EXCEPTION 'operator database context mapping is incomplete';
    END IF;
END
$mapping_guard$;

COMMIT;
