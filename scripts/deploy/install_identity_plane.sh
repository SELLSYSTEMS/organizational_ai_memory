#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  printf 'Run this installer as root.\n' >&2
  exit 1
fi
if [[ ${OAM_INSTALL_CONFIRM:-} != INSTALL_ORGANIZATIONAL_AI_MEMORY_IDENTITY_PLANE ]]; then
  printf 'Set OAM_INSTALL_CONFIRM=INSTALL_ORGANIZATIONAL_AI_MEMORY_IDENTITY_PLANE.\n' >&2
  exit 1
fi

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
database=${OAM_DATABASE:-tg_ops}
db_host=${OAM_DATABASE_HOST:-127.0.0.1}
db_port=${OAM_DATABASE_PORT:-5432}
trusted_proxy_cidr=${OAM_TRUSTED_PROXY_CIDR:-}
secret_root=${repo_root}/.local-secrets
secret_state=${secret_root}/runtime-secrets.json
config_root=/etc/organizational-ai-memory

if [[ -z ${trusted_proxy_cidr} ]]; then
  printf 'Set OAM_TRUSTED_PROXY_CIDR to the target proxy IPv4 address or CIDR.\n' >&2
  exit 1
fi
if [[ ! ${trusted_proxy_cidr} =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}(/[0-9]{1,2})?$ ]]; then
  printf 'OAM_TRUSTED_PROXY_CIDR must be an IPv4 address or CIDR.\n' >&2
  exit 1
fi

for command in curl getent grep install jq nginx node openssl psql rsync runuser sed systemctl; do
  command -v "${command}" >/dev/null || {
    printf 'Required command is unavailable: %s\n' "${command}" >&2
    exit 1
  }
done

run_psql() {
  runuser -u postgres -- psql -X -d "${database}" -v ON_ERROR_STOP=1 "$@"
}

if [[ $(run_psql -Atqc "SELECT to_regclass('memory.threads') IS NOT NULL") != t ]]; then
  printf 'The existing memory foundation is missing from database %s.\n' "${database}" >&2
  exit 1
fi

ensure_group() {
  getent group "$1" >/dev/null || groupadd --system "$1"
}

ensure_user() {
  local user=$1
  local group=$2
  ensure_group "${group}"
  if ! id "${user}" >/dev/null 2>&1; then
    useradd --system --gid "${group}" --home-dir /nonexistent --no-create-home \
      --shell /usr/sbin/nologin "${user}"
  fi
}

ensure_user oam-public oam-public
ensure_user oam-operator oam-operator
ensure_user oam-broker oam-broker
ensure_user oam-employee oam-employee
ensure_group oam-agent-broker
ensure_group oam-codex
usermod --append --groups oam-agent-broker oam-broker
usermod --append --groups oam-codex oam-public

install -d -o root -g root -m 0700 "${secret_root}"
umask 077
if [[ ! -f ${secret_state} ]]; then
  public_password=$(openssl rand -hex 32)
  operator_password=$(openssl rand -hex 32)
  broker_password=$(openssl rand -hex 32)
  employee_password=$(openssl rand -hex 32)
  architect_token=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')
  reviewer_token=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')
  temporary_state=${secret_state}.tmp
  PUBLIC_DB_PASSWORD=${public_password} \
  OPERATOR_DB_PASSWORD=${operator_password} \
  BROKER_DB_PASSWORD=${broker_password} \
  EMPLOYEE_DB_PASSWORD=${employee_password} \
  ARCHITECT_TOKEN=${architect_token} \
  REVIEWER_TOKEN=${reviewer_token} \
  jq -n \
    '{schema_version:2,public_db_password:env.PUBLIC_DB_PASSWORD,operator_db_password:env.OPERATOR_DB_PASSWORD,broker_db_password:env.BROKER_DB_PASSWORD,employee_db_password:env.EMPLOYEE_DB_PASSWORD,architect_token:env.ARCHITECT_TOKEN,reviewer_token:env.REVIEWER_TOKEN}' \
    > "${temporary_state}"
  install -o root -g root -m 0600 "${temporary_state}" "${secret_state}"
  rm -f "${temporary_state}"
else
  public_password=$(jq -er '.public_db_password' "${secret_state}")
  operator_password=$(jq -er '.operator_db_password' "${secret_state}")
  broker_password=$(jq -er '.broker_db_password' "${secret_state}")
  employee_password=$(jq -er '.employee_db_password // empty' "${secret_state}" || true)
  if [[ -z ${employee_password} ]]; then
    employee_password=$(openssl rand -hex 32)
    temporary_state=${secret_state}.tmp
    EMPLOYEE_DB_PASSWORD=${employee_password} jq \
      '.schema_version = 2 | .employee_db_password = env.EMPLOYEE_DB_PASSWORD' \
      "${secret_state}" > "${temporary_state}"
    install -o root -g root -m 0600 "${temporary_state}" "${secret_state}"
    rm -f "${temporary_state}"
  fi
  architect_token=$(jq -er '.architect_token' "${secret_state}")
  reviewer_token=$(jq -er '.reviewer_token' "${secret_state}")
fi

for value in "${public_password}" "${operator_password}" "${broker_password}" "${employee_password}"; do
  [[ ${value} =~ ^[a-f0-9]{64}$ ]] || { printf 'Stored database secret is invalid.\n' >&2; exit 1; }
done
for value in "${architect_token}" "${reviewer_token}"; do
  [[ ${value} =~ ^[A-Za-z0-9_-]{43}$ ]] || { printf 'Stored operator token is invalid.\n' >&2; exit 1; }
done

install -d -o root -g oam-operator -m 0750 "${config_root}"
write_db_env() {
  local destination=$1
  local group=$2
  local user=$3
  local password=$4
  local temporary=${secret_root}/$(basename "${destination}").tmp
  printf 'PGHOST=%s\nPGPORT=%s\nPGDATABASE=%s\nPGUSER=%s\nPGPASSWORD=%s\n' \
    "${db_host}" "${db_port}" "${database}" "${user}" "${password}" > "${temporary}"
  install -o root -g "${group}" -m 0640 "${temporary}" "${destination}"
  rm -f "${temporary}"
}

write_db_env "${config_root}/public-db.env" oam-public oam_public_api "${public_password}"
write_db_env "${config_root}/operator-db.env" oam-operator oam_operator_api "${operator_password}"
write_db_env "${config_root}/broker-db.env" oam-broker oam_broker_api "${broker_password}"
write_db_env "${config_root}/employee-db.env" oam-employee oam_employee_api "${employee_password}"

architect_hash=$(printf %s "${architect_token}" | sha256sum | cut -d' ' -f1)
reviewer_hash=$(printf %s "${reviewer_token}" | sha256sum | cut -d' ' -f1)
credential_tmp=${secret_root}/operator-credentials.tmp
ARCHITECT_HASH=${architect_hash} REVIEWER_HASH=${reviewer_hash} jq -n \
  '{schema_version:1,credentials:[{token_sha256:env.ARCHITECT_HASH,principal_key:"human:ai_architect",department_key:"digital_delivery"},{token_sha256:env.REVIEWER_HASH,principal_key:"human:capability_reviewer",department_key:"digital_delivery"}]}' \
  > "${credential_tmp}"
install -o root -g oam-operator -m 0440 "${credential_tmp}" "${config_root}/operator-credentials.json"
rm -f "${credential_tmp}"

ARCHITECT_TOKEN=${architect_token} REVIEWER_TOKEN=${reviewer_token} jq -n \
  '{schema_version:1,architect_token:env.ARCHITECT_TOKEN,reviewer_token:env.REVIEWER_TOKEN}' \
  > "${secret_root}/proof-operator-credentials.tmp"
install -o root -g root -m 0600 "${secret_root}/proof-operator-credentials.tmp" \
  "${secret_root}/proof-operator-credentials.json"
rm -f "${secret_root}/proof-operator-credentials.tmp"

DB_HOST=${db_host} DB_PORT=${db_port} DB_NAME=${database} PUBLIC_DB_PASSWORD=${public_password} jq -n \
  '{schema_version:1,host:env.DB_HOST,port:(env.DB_PORT|tonumber),database:env.DB_NAME,user:"oam_public_api",password:env.PUBLIC_DB_PASSWORD}' \
  > "${secret_root}/public-db-probe.tmp"
install -o root -g root -m 0600 "${secret_root}/public-db-probe.tmp" \
  "${secret_root}/public-db-probe.json"
rm -f "${secret_root}/public-db-probe.tmp"

run_psql -f "${repo_root}/sql/memory_public_mvp_indexes_v1.sql"
run_psql -f "${repo_root}/sql/capability_memory_schema_v1.sql"
run_psql -f "${repo_root}/sql/capability_memory_schema_v2.sql"

runuser -u postgres -- env \
  PGHOST=/var/run/postgresql PGPORT="${db_port}" PGDATABASE="${database}" PGUSER=postgres \
  PLATFORM_ENV_PATH=/nonexistent \
  node "${repo_root}/scripts/demo/bootstrap_demo_corpora.mjs" >/dev/null
runuser -u postgres -- env \
  PGHOST=/var/run/postgresql PGPORT="${db_port}" PGDATABASE="${database}" PGUSER=postgres \
  PLATFORM_ENV_PATH=/nonexistent \
  node "${repo_root}/scripts/demo/import_capability_pack.mjs" >/dev/null

if [[ $(run_psql -Atqc "SELECT to_regclass('identity.principals') IS NOT NULL") != t ]]; then
  run_psql -f "${repo_root}/sql/identity_data_plane_v1.sql"
fi
run_psql -f "${repo_root}/sql/identity_data_plane_v2_public_asset_eligibility.sql"
run_psql -f "${repo_root}/sql/identity_data_plane_v3_capture_integrity.sql"
run_psql -f "${repo_root}/sql/identity_data_plane_v4_provisioning_scope.sql"
run_psql -f "${repo_root}/sql/identity_data_plane_v5_audit_scope.sql"
run_psql -f "${repo_root}/sql/identity_data_plane_v6_security_review.sql"
run_psql -f "${repo_root}/sql/identity_data_plane_v7_operator_context.sql"
run_psql -f "${repo_root}/sql/identity_data_plane_v8_personal_agents.sql"
run_psql -f "${repo_root}/sql/identity_policy_plane_v1.sql"
run_psql -f "${repo_root}/sql/identity_demo_seed_v1.sql"
{
  printf "\\set architect_hash '%s'\n" "${architect_hash}"
  printf "\\set reviewer_hash '%s'\n" "${reviewer_hash}"
  cat "${repo_root}/sql/identity_operator_context_seed_v1.sql"
} | run_psql -f -
{
  printf "\\set public_password '%s'\n" "${public_password}"
  printf "\\set operator_password '%s'\n" "${operator_password}"
  printf "\\set broker_password '%s'\n" "${broker_password}"
  printf "\\set employee_password '%s'\n" "${employee_password}"
  cat "${repo_root}/sql/identity_runtime_logins_v1.sql"
} | run_psql -f -

PGHOST="${db_host}" PGPORT="${db_port}" PGDATABASE="${database}" \
  PGUSER=oam_public_api PGPASSWORD="${public_password}" \
  psql -X -v ON_ERROR_STOP=1 -Atqc 'SELECT count(*) FROM oam_public.capability_assets' >/dev/null
if PGHOST="${db_host}" PGPORT="${db_port}" PGDATABASE="${database}" \
  PGUSER=oam_public_api PGPASSWORD="${public_password}" \
  psql -X -v ON_ERROR_STOP=1 -Atqc 'SELECT count(*) FROM memory.capability_assets' \
  >/dev/null 2>&1; then
  printf 'Restricted public role unexpectedly read canonical memory.\n' >&2
  exit 1
fi

sync_runtime() {
  local destination=$1
  local group=$2
  install -d -o root -g "${group}" -m 0750 "${destination}"
  rsync -a --delete --chown="root:${group}" "${repo_root}/app/" "${destination}/app/"
  rsync -a --delete --chown="root:${group}" "${repo_root}/node_modules/" "${destination}/node_modules/"
  install -o root -g "${group}" -m 0640 "${repo_root}/package.json" "${destination}/package.json"
}

sync_runtime /opt/organizational-ai-memory oam-public
sync_runtime /opt/organizational-ai-memory-operator oam-operator
sync_runtime /opt/organizational-ai-memory-broker oam-broker
sync_runtime /opt/organizational-ai-memory-employee oam-employee

install -d -o root -g oam-operator -m 0750 /opt/organizational-ai-memory-security/app/lib
install -o root -g oam-operator -m 0640 "${repo_root}/app/provisioner.mjs" \
  /opt/organizational-ai-memory-security/app/provisioner.mjs
install -o root -g oam-operator -m 0640 "${repo_root}/app/lib/provisioner-contract.mjs" \
  /opt/organizational-ai-memory-security/app/lib/provisioner-contract.mjs
install -d -o root -g root -m 0755 /opt/organizational-ai-memory-agent/app
install -o root -g root -m 0644 "${repo_root}/app/agent-runtime.mjs" \
  /opt/organizational-ai-memory-agent/app/agent-runtime.mjs

install -d -o root -g oam-operator -m 1730 /var/lib/organizational-ai-memory-quarantine
install -d -o oam-operator -g oam-operator -m 0700 /var/lib/organizational-ai-memory-operator
install -d -o root -g oam-public -m 0750 /var/lib/organizational-ai-memory-proof
source_build_sha256=$(node "${repo_root}/app/lib/source-build-digest.mjs" "${repo_root}")
if [[ ! ${source_build_sha256} =~ ^[a-f0-9]{64}$ ]]; then
  printf 'Source build digest generation failed.\n' >&2
  exit 1
fi
printf '%s\n' "${source_build_sha256}" > "${secret_root}/expected-source.sha256.tmp"
install -o root -g oam-public -m 0440 "${secret_root}/expected-source.sha256.tmp" \
  /var/lib/organizational-ai-memory-proof/expected-source.sha256
rm -f "${secret_root}/expected-source.sha256.tmp"
install -d -o root -g root -m 0711 /var/lib/oam-agents
install -d -o root -g root -m 0711 /etc/oam-agents
install -d -o root -g root -m 0755 \
  /etc/systemd/system/organizational-ai-memory-agents.target.wants

for unit in \
  organizational-ai-memory.service \
  organizational-ai-memory-operator.service \
  organizational-ai-memory-broker.service \
  organizational-ai-memory-employee.service \
  organizational-ai-memory-provisioner.service \
  organizational-ai-memory-agent@.service \
  organizational-ai-memory-agents.target; do
  install -o root -g root -m 0644 "${repo_root}/deploy/systemd/${unit}" \
    "/etc/systemd/system/${unit}"
done
for dropin in \
  organizational-ai-memory.service.d \
  organizational-ai-memory-operator.service.d \
  organizational-ai-memory-broker.service.d \
  organizational-ai-memory-employee.service.d \
  organizational-ai-memory-provisioner.service.d \
  organizational-ai-memory-agent@.service.d; do
  install -d -o root -g root -m 0755 "/etc/systemd/system/${dropin}"
  install -o root -g root -m 0644 "${repo_root}/deploy/systemd/${dropin}/zzzz-oam-hardening.conf" \
    "/etc/systemd/system/${dropin}/zzzz-oam-hardening.conf"
done

"${repo_root}/scripts/deploy/install_codex_sidecar.sh"
systemctl daemon-reload
systemd-analyze verify \
  /etc/systemd/system/organizational-ai-memory.service \
  /etc/systemd/system/organizational-ai-memory-operator.service \
  /etc/systemd/system/organizational-ai-memory-broker.service \
  /etc/systemd/system/organizational-ai-memory-employee.service \
  /etc/systemd/system/organizational-ai-memory-provisioner.service \
  /etc/systemd/system/organizational-ai-memory-agent@.service

systemctl enable organizational-ai-memory-broker.service
systemctl enable organizational-ai-memory-provisioner.service
systemctl enable organizational-ai-memory-agents.target
systemctl enable organizational-ai-memory-operator.service
systemctl enable organizational-ai-memory-employee.service
systemctl enable organizational-ai-memory.service
systemctl restart organizational-ai-memory-broker.service
systemctl restart organizational-ai-memory-provisioner.service
systemctl restart organizational-ai-memory-operator.service
systemctl restart organizational-ai-memory-employee.service
systemctl restart organizational-ai-memory.service

nginx_temporary=${secret_root}/organizational-ai-memory.nginx.tmp
sed "s|__TRUSTED_PROXY_CIDR__|${trusted_proxy_cidr}|g" \
  "${repo_root}/deploy/nginx/organizational-ai-memory.conf.example" > "${nginx_temporary}"
if grep -q '__TRUSTED_PROXY_CIDR__' "${nginx_temporary}"; then
  printf 'Nginx trusted proxy template was not resolved.\n' >&2
  exit 1
fi
install -o root -g root -m 0644 "${nginx_temporary}" \
  /etc/nginx/sites-available/organizational-ai-memory
rm -f "${nginx_temporary}"
ln -sfn /etc/nginx/sites-available/organizational-ai-memory \
  /etc/nginx/sites-enabled/organizational-ai-memory
nginx -t
systemctl reload nginx.service

for _ in $(seq 1 30); do
  if curl --silent --show-error --fail --max-time 2 http://127.0.0.1:3000/api/readyz 2>/dev/null \
    | jq -e '.status == "ready"' >/dev/null \
    && curl --silent --show-error --fail --max-time 2 \
      -H 'Host: memory.sellsystems.agency' \
      http://127.0.0.1:3020/api/readyz 2>/dev/null \
      | jq -e '.status == "ready"' >/dev/null; then
    break
  fi
  sleep 1
done
curl --silent --show-error --fail --max-time 3 http://127.0.0.1:3000/api/readyz \
  | jq -e '.status == "ready"' >/dev/null
curl --silent --show-error --fail --max-time 3 -H 'Host: memory.sellsystems.agency' \
  http://127.0.0.1:3010/ >/dev/null
curl --silent --show-error --fail --max-time 3 -H 'Host: memory.sellsystems.agency' \
  http://127.0.0.1:3020/api/readyz | jq -e '.status == "ready"' >/dev/null

if id tgops >/dev/null 2>&1; then
  gpasswd --delete tgops oam-codex >/dev/null 2>&1 || true
fi

printf '%s\n' \
  'Organizational AI Memory identity plane installed.' \
  "Operator proof credentials: ${secret_root}/proof-operator-credentials.json" \
  "Public database proof credential: ${secret_root}/public-db-probe.json" \
  'No credential value was printed.'
