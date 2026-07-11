#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

APP_ROOT="${APP_ROOT:-${REPO_ROOT}}"
APP_DATA_ROOT="${APP_DATA_ROOT:-/var/lib/tg_ops}"
APP_CACHE_ROOT="${APP_CACHE_ROOT:-/var/cache/tg_ops}"
APP_LOG_ROOT="${APP_LOG_ROOT:-/var/log/tg_ops}"
APP_ETC_ROOT="${APP_ETC_ROOT:-/etc/tg_ops}"
APP_USER="${APP_USER:-tgops}"
APP_GROUP="${APP_GROUP:-tgops}"

install -d -m 0755 "${APP_ROOT}"

if ! getent group "${APP_GROUP}" >/dev/null; then
  groupadd --system "${APP_GROUP}"
fi

if ! id -u "${APP_USER}" >/dev/null 2>&1; then
  useradd --system --gid "${APP_GROUP}" --home-dir "${APP_ROOT}" --shell /usr/sbin/nologin "${APP_USER}"
fi

install -d -o "${APP_USER}" -g "${APP_GROUP}" -m 0755 \
  "${APP_DATA_ROOT}" \
  "${APP_DATA_ROOT}/qdrant" \
  "${APP_DATA_ROOT}/qdrant/storage" \
  "${APP_DATA_ROOT}/qdrant/snapshots" \
  "${APP_DATA_ROOT}/qdrant/tmp" \
  "${APP_CACHE_ROOT}" \
  "${APP_CACHE_ROOT}/huggingface" \
  "${APP_LOG_ROOT}" \
  "${APP_ETC_ROOT}"

if [ ! -f "${APP_ETC_ROOT}/platform.env" ]; then
  cp "${REPO_ROOT}/deploy/systemd/env/platform.env.example" "${APP_ETC_ROOT}/platform.env"
fi

if [ ! -f "${APP_ETC_ROOT}/qdrant.yaml" ]; then
  cp "${REPO_ROOT}/deploy/config/qdrant.yaml.example" "${APP_ETC_ROOT}/qdrant.yaml"
fi

chown -R "${APP_USER}:${APP_GROUP}" "${APP_DATA_ROOT}" "${APP_CACHE_ROOT}" "${APP_LOG_ROOT}"

echo "Prepared layout:"
echo "  APP_ROOT=${APP_ROOT}"
echo "  APP_DATA_ROOT=${APP_DATA_ROOT}"
echo "  APP_CACHE_ROOT=${APP_CACHE_ROOT}"
echo "  APP_LOG_ROOT=${APP_LOG_ROOT}"
echo "  APP_ETC_ROOT=${APP_ETC_ROOT}"
