#!/usr/bin/env bash
set -euo pipefail

confirmation=BOOTSTRAP_ISOLATED_OAM_INTEGRATION_DATABASE
if [[ ${OAM_INTEGRATION_BOOTSTRAP_CONFIRM:-} != "${confirmation}" ]]; then
  printf 'Set OAM_INTEGRATION_BOOTSTRAP_CONFIRM=%s.\n' "${confirmation}" >&2
  exit 1
fi
if [[ ${OAM_INTEGRATION_BOOTSTRAP_ISOLATED_CLUSTER:-} != CONFIRM_ISOLATED_POSTGRESQL_CLUSTER ]]; then
  printf 'Confirm that this is an isolated disposable PostgreSQL cluster.\n' >&2
  exit 1
fi

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
: "${PGHOST:?Set PGHOST to the isolated PostgreSQL host}"
: "${PGPORT:?Set PGPORT to the isolated PostgreSQL port}"
: "${PGDATABASE:?Set PGDATABASE to the disposable database}"
: "${PGUSER:?Set PGUSER to the disposable cluster administrator}"

case "${PGHOST}" in
  127.0.0.1|localhost|::1) ;;
  *)
    printf 'Integration bootstrap accepts a loopback PostgreSQL host only.\n' >&2
    exit 1
    ;;
esac
if [[ ! ${PGDATABASE} =~ (ci|test|integration) ]]; then
  printf 'Disposable database name must contain ci, test, or integration.\n' >&2
  exit 1
fi

for command in node psql sha256sum; do
  command -v "${command}" >/dev/null || {
    printf 'Required integration command is unavailable: %s\n' "${command}" >&2
    exit 1
  }
done

run_psql() {
  psql -X -v ON_ERROR_STOP=1 "$@"
}

if [[ $(run_psql -Atqc "SELECT to_regnamespace('memory') IS NULL AND to_regnamespace('identity') IS NULL") != t ]]; then
  printf 'Integration database is not empty; refusing to modify it.\n' >&2
  exit 1
fi

run_psql -f "${repo_root}/sql/platform_schema_v1.sql"
run_psql -f "${repo_root}/sql/memory_schema_v1.sql"
run_psql -f "${repo_root}/sql/memory_public_mvp_indexes_v1.sql"
run_psql -f "${repo_root}/sql/capability_memory_schema_v1.sql"
run_psql -f "${repo_root}/sql/capability_memory_schema_v2.sql"

unset DATABASE_URL
export PLATFORM_ENV_PATH=/nonexistent
node "${repo_root}/scripts/demo/bootstrap_demo_corpora.mjs" >/dev/null
node "${repo_root}/scripts/demo/import_capability_pack.mjs" >/dev/null

run_psql -f "${repo_root}/sql/identity_data_plane_v1.sql"
run_psql -f "${repo_root}/sql/identity_data_plane_v2_public_asset_eligibility.sql"
run_psql -f "${repo_root}/sql/identity_data_plane_v3_capture_integrity.sql"
run_psql -f "${repo_root}/sql/identity_data_plane_v4_provisioning_scope.sql"
run_psql -f "${repo_root}/sql/identity_data_plane_v5_audit_scope.sql"
run_psql -f "${repo_root}/sql/identity_data_plane_v6_security_review.sql"
run_psql -f "${repo_root}/sql/identity_data_plane_v7_operator_context.sql"
run_psql -f "${repo_root}/sql/identity_data_plane_v8_personal_agents.sql"
run_psql -f "${repo_root}/sql/identity_policy_plane_v1.sql"
run_psql -f "${repo_root}/sql/identity_demo_seed_v1.sql"

architect_hash=$(printf '%s' 'ci-only-architect-context' | sha256sum | awk '{print $1}')
reviewer_hash=$(printf '%s' 'ci-only-reviewer-context' | sha256sum | awk '{print $1}')
run_psql \
  -v "architect_hash=${architect_hash}" \
  -v "reviewer_hash=${reviewer_hash}" \
  -f "${repo_root}/sql/identity_operator_context_seed_v1.sql"
run_psql \
  -v public_password=ci-only-public \
  -v operator_password=ci-only-operator \
  -v broker_password=ci-only-broker \
  -v employee_password=ci-only-employee \
  -f "${repo_root}/sql/identity_runtime_logins_v1.sql"

run_psql -Atqc "
  SELECT CASE WHEN
    to_regclass('identity.principals') IS NOT NULL
    AND to_regclass('personal.employee_memory_items') IS NOT NULL
    AND (SELECT count(*) FROM identity.operator_context_credentials WHERE status = 'active') = 2
  THEN 'integration database ready'
  ELSE pg_catalog.current_setting('integration_database_incomplete')
  END
"
