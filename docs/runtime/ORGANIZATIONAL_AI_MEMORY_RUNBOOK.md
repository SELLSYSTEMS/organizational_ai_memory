# Organizational AI Memory Runbook

Status: factual target-instance runbook, verified on `2026-07-11`.

## Scope

Operate only `/home/admin/organizational-ai-memory` and the services installed
from it on this target. The upstream TLS/domain link is operator-managed and is
outside this repository. Node-RED, controller hosts, other instances, SSH keys,
and upstream proxy configuration are not part of this product path.

## Runtime inventory

| Workload | Linux identity | Endpoint | PostgreSQL login / authority |
| --- | --- | --- | --- |
| Public product | `oam-public:oam-public` | `127.0.0.1:3000` | `oam_public_api` -> exactly `oam_public_runtime` -> fixed `oam_public` views |
| Architect Console | shared `oam-operator:oam-operator` workload | `127.0.0.1:3010` | shared `oam_operator_api` -> exactly `oam_operator_runtime`; per-request human/department context + FORCE RLS |
| Memory broker | `oam-broker:oam-agent-broker` | protected Unix socket | `oam_broker_api` -> exactly `oam_broker_runtime` + FORCE RLS |
| Provisioner | `root:oam-operator` | protected Unix socket | no application database credential; exact root-operation allowlist |
| Spark sidecar | `oam-codex:oam-codex` | protected Unix socket | none |
| Linked agent | dedicated locked `oam-a-<runtime>` UID | no TCP listener; broker socket only | no direct role; brokered grant |

Units:

```text
organizational-ai-memory.service
organizational-ai-memory-operator.service
organizational-ai-memory-broker.service
organizational-ai-memory-provisioner.service
organizational-ai-memory-codex.service
organizational-ai-memory-agent@.service
organizational-ai-memory-agents.target
```

The public service is the only workload that belongs to the sidecar socket
group. `tgops` is not part of the deployed application or Codex group boundary.

### Human operator identity

Architect and reviewer are logical application principals. The MVP does not
create a Linux user or PostgreSQL login for each human. Their high-entropy,
root-provisioned console secrets map to one principal and one department in
`identity.operator_context_credentials`; PostgreSQL stores only the SHA-256
mapping. After application authentication, each repository operation opens a
transaction and calls the restricted context-establishment function. FORCE RLS
resolves that mapping under the exact shared `oam_operator_api` session user and
constrains operator-visible rows to the active human and department.

Do not treat a request principal ID, department ID, cookie value, arbitrary
custom PostgreSQL setting, shared Linux UID, or shared database login as human
authority by itself. Only the root-provisioned secret mapping plus active
principal, membership, policy, and database context establishes that scope.
Dedicated Linux identities are provisioned for linked agents, not ordinary
human principals; agents still receive no direct PostgreSQL login.

## Public routes

| Route | Purpose |
| --- | --- |
| `/` | Capability-first product and temporal history |
| `/demo` | Single-screen deterministic search, plan, analytics, and access proof |
| `/assets` | Typed/versioned capability inventory and provenance |
| `/method` | Architecture, authority, and safety contract |
| `/evidence` | Public continuity objects and source paths |
| `/architect/` | Protected operator console; token required |
| `/api/readyz` | Public service, database, public corpus, and pack readiness |
| `/api/public/access-proof` | Sanitized read-only 22-control proof projection |

Root operator APIs under `/api/v1` are not routed publicly. The console prefix
proxies only `/architect/` to the loopback operator service, which still
requires the configured Host/Origin contract, bounded token exchange,
path-scoped Secure/HttpOnly/SameSite cookie, and CSRF on mutation.

## Fixed public data boundaries

```text
brand:                 sell_systems_hackathon_demo
continuity thread:     oam_public_demo_v1
continuity corpus:     public_demo / public_safe
capability pack:       aihackathon_public_safe_asset_pack_2026_07_10
capability evidence:   oam_public_capability_assets_v1
publication status:    active
```

Clients cannot supply a tenant, brand, thread, corpus, pack, publication state,
or visibility. The internal regression scope has no public route.

## Idempotent install

Run from the repository root as root. The explicit phrase prevents accidental
host changes:

```bash
cd /home/admin/organizational-ai-memory
OAM_TRUSTED_PROXY_CIDR='<target proxy IPv4 address or CIDR>' \
OAM_INSTALL_CONFIRM=INSTALL_ORGANIZATIONAL_AI_MEMORY_IDENTITY_PLANE \
  scripts/deploy/install_identity_plane.sh
```

`OAM_TRUSTED_PROXY_CIDR` is required and must come from the target's trusted
runtime configuration. The repository intentionally contains no private proxy
address.

The installer:

1. creates the workload users and groups if absent
2. generates runtime secrets only when absent under root-only `.local-secrets`
3. applies memory, capability v1-v2, identity data-plane v1-v7, policy,
   operator-context, runtime-login, and seed SQL in fixed order
4. installs separate application trees and systemd units
5. writes root-managed service credentials outside the repository
6. records a root-owned SHA-256 over the deployed security/runtime source
7. validates workload role memberships and real public read/write denials
8. installs nginx, restarts workloads, and verifies readiness

It prints no credential value. Re-running the installer must finish with exit
code zero and preserve existing secret values.

## Codex authentication

The isolated identity uses:

```text
user:       oam-codex
HOME:       /var/lib/oam-codex
CODEX_HOME: /var/lib/oam-codex/.codex
model:      gpt-5.3-codex-spark
```

Check status without changing the nologin shell:

```bash
runuser -u oam-codex -- env \
  HOME=/var/lib/oam-codex \
  CODEX_HOME=/var/lib/oam-codex/.codex \
  codex login status
```

If authorization expires, the operator may perform device authentication under
that same identity. Do not authenticate the production path as root, copy
another user's Codex state, add the account to unrelated groups, or change SSH
keys.

## Service checks

```bash
systemctl is-active \
  organizational-ai-memory.service \
  organizational-ai-memory-operator.service \
  organizational-ai-memory-broker.service \
  organizational-ai-memory-provisioner.service \
  organizational-ai-memory-codex.service \
  nginx.service postgresql.service

ss -ltnup
nginx -t
curl -fsS http://127.0.0.1:3000/api/readyz | jq
curl -fsS https://memory.sellsystems.agency/api/readyz | jq
```

Expected public TCP listeners are nginx, PostgreSQL loopback, the public app
loopback, and the operator app loopback. Broker, provisioner, Codex, and agent
control paths are Unix sockets or local processes, not public listeners.

The obsolete target-local `aihackathon-vnc-root-2.service` is stopped and
disabled, and TCP 5902 must be absent. The unrelated pre-existing VNC `:1`
service and its 5901/6080 path are outside this project and were not changed.

Inspect recent logs without exposing environment or credentials:

```bash
journalctl -u organizational-ai-memory.service -n 80 --no-pager
journalctl -u organizational-ai-memory-operator.service -n 80 --no-pager
journalctl -u organizational-ai-memory-broker.service -n 80 --no-pager
journalctl -u organizational-ai-memory-provisioner.service -n 80 --no-pager
journalctl -u organizational-ai-memory-codex.service -n 80 --no-pager
```

## Live identity proof

The proof is intentionally mutating but bounded. It creates a logical human,
creates and confirms a linked-agent plan, starts the dedicated agent, executes
allow/deny probes, runs quarantine/review/draft promotion, then suspends the
agent and verifies revocation.

```bash
cd /home/admin/organizational-ai-memory
env \
  OAM_IDENTITY_PROOF_MODE=live \
  OAM_IDENTITY_PROOF_CONFIRM_MUTATIONS=RUN_ISOLATED_IDENTITY_PROOF \
  OAM_IDENTITY_PROOF_CREDENTIAL_FILE=/home/admin/organizational-ai-memory/.local-secrets/proof-operator-credentials.json \
  OAM_IDENTITY_PROOF_DB_CREDENTIAL_FILE=/home/admin/organizational-ai-memory/.local-secrets/public-db-probe.json \
  OAM_IDENTITY_PROOF_OPERATOR_URL=http://127.0.0.1:3010 \
  OAM_IDENTITY_PROOF_PUBLIC_URL=https://memory.sellsystems.agency \
  node scripts/evaluation/run_identity_plane_proof.mjs
```

Success is exactly:

```json
{"overall_status":"PASS","counts":{"pass":22,"fail":0,"not_run":0,"not_applicable":0}}
```

Verify bundle hashes offline:

```bash
node scripts/evaluation/verify_identity_proof.mjs \
  artifacts/evaluation/identity-plane-proof
```

Publish only the sanitized projection:

```bash
install -d -o root -g oam-public -m 0750 \
  /var/lib/organizational-ai-memory-proof
install -o root -g oam-public -m 0440 \
  artifacts/evaluation/identity-plane-proof/public-proof.json \
  /var/lib/organizational-ai-memory-proof/public-proof.json
```

Never publish `report.json`, credential files, runtime keys, OS usernames, or
raw agent proof files to a public route.

The public loader accepts the sanitized projection only when its
`source_sha256` equals the root-owned expected source digest, both paths have
secure ownership and modes with no symlinked component, and the proof is no
more than 24 hours old. Any mismatch or stale proof fails closed.

## Test and browser acceptance

```bash
cd /home/admin/organizational-ai-memory
npm run app:test

runuser -u postgres -- env \
  OAM_INTEGRATION_DATABASE_URL='postgresql://postgres@/tg_ops?host=%2Fvar%2Frun%2Fpostgresql' \
  node --test test/integration/*.test.mjs

env \
  OAM_QA_BASE_URL=https://memory.sellsystems.agency \
  OAM_QA_REQUIRE_OPERATOR=1 \
  OAM_QA_OPERATOR_CREDENTIAL_FILE=/home/admin/organizational-ai-memory/.local-secrets/proof-operator-credentials.json \
  npm run app:qa -- artifacts/qa/live

env \
  OAM_QA_BASE_URL=https://memory.sellsystems.agency \
  OAM_QA_OPERATOR_CREDENTIAL_FILE=/home/admin/organizational-ai-memory/.local-secrets/proof-operator-credentials.json \
  npm run submission:screenshots
```

Current verified acceptance:

- 193/193 API/security tests pass
- 3/3 current real PostgreSQL integration tests pass
- 9/9 fresh-install, upgraded-install, and clean-security PostgreSQL matrix
  cases pass
- 35/35 live browser QA checks pass
- positive and negative capability search behave deterministically
- Spark returns a generated structured plan with validated citations
- public proof renders `PASS 22/22`
- authenticated architect access includes `candidate.create` and explicitly
  denies `memory.canonical.write`
- desktop and mobile have no horizontal overflow or unexpected browser errors

The expected public `400` scope-injection response and initial operator `401`
session check are explained security probes, not unexpected console failures.

## Database safety probes

Do not print passwords. Use the root-owned probe file or run catalog checks as
the PostgreSQL administrator. Verify that the three application logins are not
superuser, cannot create roles/databases, cannot replicate, and cannot bypass
RLS. Verify each has exactly one workload membership.

The proof validates application and workload controls under the target's
trusted root and PostgreSQL-superuser administration boundary. It does not
claim resistance to those administrators.

Public and broker roles must fail:

```text
USAGE on memory schema
SELECT/INSERT/UPDATE/DELETE on memory.capability_assets
SET ROLE to another workload
```

The public role must succeed only through fixed `oam_public` views. The broker
must succeed only when credential, principal, membership, agent assignment,
sponsor assignment, explicit-denial absence, and active capability grant all
agree.

The shared operator login must also fail closed without a valid
transaction-local context. Test that a missing context, an unmapped
64-character hash, a caller-supplied department UUID, and an arbitrary
`oam.operator_context_sha256` setting cannot expose another department. Confirm
that a valid architect or reviewer context resolves exactly its mapped active
human and department, and that proof, audit, quarantine, and governance reads
remain department-scoped. Confirm UPDATE/DELETE is rejected for
`quarantine.scan_findings` and `quarantine.candidate_evidence`, and activated
policy templates/rules cannot be edited in place.

## Degraded operation

- **Spark unavailable:** assist returns HTTP `200` with the same deterministic
  recommendation and `interaction.status = fallback`; readiness remains green.
- **Proof projection absent/invalid:** the public proof rail reports unavailable
  or failed; it must not infer a pass.
- **Broker unavailable:** agents fail closed; public deterministic reads remain
  independent.
- **Provisioner unavailable:** no Linux or quarantine mutation occurs; queued
  plans remain unconfirmed or failed.
- **PostgreSQL unavailable:** readiness fails because canonical memory is not
  available.

## Rollback

`sql/identity_data_plane_v1_rollback.sql` removes the complete current v1-v7
identity, governance, and public-view plane plus its runtime roles. Later
migrations extend v1-owned schemas; this is a full removal, not a selective
downgrade. Test it on an isolated database before any production use:

```bash
psql -X -v ON_ERROR_STOP=1 -d isolated_test_database \
  -f sql/identity_data_plane_v1_rollback.sql
```

Do not run rollback on the live target unless the operator explicitly chooses
to remove the identity plane and has verified dependent data and service state.
