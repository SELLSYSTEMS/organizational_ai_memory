#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  printf 'Run this installer as root.\n' >&2
  exit 1
fi

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
install_root=/opt/organizational-ai-memory-codex

if ! getent group oam-codex >/dev/null; then
  groupadd --system oam-codex
fi

if ! id oam-codex >/dev/null 2>&1; then
  useradd \
    --system \
    --gid oam-codex \
    --home-dir /var/lib/oam-codex \
    --no-create-home \
    --shell /usr/sbin/nologin \
    oam-codex
fi

if id oam-public >/dev/null 2>&1; then
  usermod --append --groups oam-codex oam-public
fi

install -d -o root -g root -m 0755 \
  "${install_root}/app/lib" \
  "${install_root}/deploy/codex" \
  /var/empty/oam-codex \
  /etc/systemd/system/organizational-ai-memory-codex.service.d
install -d -o oam-codex -g oam-codex -m 0700 /var/lib/oam-codex/.codex

install -o root -g root -m 0644 \
  "${repo_root}/app/codex-sidecar.mjs" \
  "${install_root}/app/codex-sidecar.mjs"
install -o root -g root -m 0644 \
  "${repo_root}/app/lib/codex-spark-runner.mjs" \
  "${install_root}/app/lib/codex-spark-runner.mjs"
install -o root -g root -m 0644 \
  "${repo_root}/app/lib/structured-capability-plan.mjs" \
  "${install_root}/app/lib/structured-capability-plan.mjs"
install -o root -g root -m 0644 \
  "${repo_root}/deploy/codex/explanation.schema.json" \
  "${install_root}/deploy/codex/explanation.schema.json"

install -o root -g root -m 0644 \
  "${repo_root}/deploy/systemd/organizational-ai-memory-codex.service" \
  /etc/systemd/system/organizational-ai-memory-codex.service
install -o root -g root -m 0644 \
  "${repo_root}/deploy/systemd/organizational-ai-memory-codex.service.d/zzzz-oam-hardening.conf" \
  /etc/systemd/system/organizational-ai-memory-codex.service.d/zzzz-oam-hardening.conf
systemctl daemon-reload
systemctl enable organizational-ai-memory-codex.service
systemctl restart organizational-ai-memory-codex.service

printf '%s\n' \
  'Codex sidecar installed.' \
  'Generation uses only the isolated oam-codex login under /var/lib/oam-codex/.codex.'
