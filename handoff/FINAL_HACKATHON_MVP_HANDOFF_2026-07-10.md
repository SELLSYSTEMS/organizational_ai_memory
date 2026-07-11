# Final Organizational AI Memory Hackathon MVP Handoff

Status: deployed, packaged, and release-tested on the target instance on
`2026-07-11`.

Public product: `https://memory.sellsystems.agency/`

Primary problem statement: **P5, Organizational AI Memory**. Human-AgentOS is
used as supporting enforcement architecture for independent linked-agent
identities; it is not presented as a second product.

## Release identity

- Pre-package baseline commit:
  `860db5e15c6c556ed456d8263aed4f4732cd2363`
- Deployed source/dependency digest:
  `d71ae5e50ce880e5e2be436ffbe0d96d017420d16c003897ea83c160cfea5687`
- Final live proof time: `2026-07-11T04:11:17.654Z`
- Final live proof: `PASS 22/22`

The proof was generated before this repository's first package commit. Its
`source_commit` therefore records the pre-package baseline, while
`source_sha256` binds the exact deployed application, security, migration,
service, dependency-lock, and installed-dependency tree. Obtain the package
commit after completion with `git rev-parse HEAD`; no self-referential commit
hash is embedded here.

## Delivered product

A judge can use one public screen to:

1. describe a task in free text
2. receive a deterministic approved capability selection from PostgreSQL
3. inspect typed/versioned prompt, workflow, and decision content
4. see why each asset worked and follow source provenance
5. optionally generate a strictly cited Spark adaptation
6. see inventory, coverage, authored duplication/gap signals, and a sanitized
   live access proof

The authoritative capability path is:

```text
free-text task
-> deterministic task mapping
-> approved capability assets
-> asset -> observation -> source turn
-> optional non-authoritative Spark adaptation
```

The canonical `website_delivery_handoff` result is:

```text
prompt:website_handoff_brief_v1
workflow:portfolio_site_delivery_v1
decision:source_first_before_generation_v1
```

All three selected assets are approved. Unsupported, underspecified,
stop-word-only, and instruction-injection-shaped queries return no match rather
than unrelated memory.

## Governed capture path

The protected Architect Console demonstrates:

```text
bounded text upload
-> root-owned read-only quarantine seal
-> service-produced candidate
-> independent reviewer decision
-> architect promotion
-> reviewed draft only
```

Canonical publication is deliberately outside the autonomous MVP path. Public
reuse operates only on the 9 already approved public-safe assets.

Capture decisions bind sealed source bytes, scan evidence, source SHA-256,
candidate content hash, reviewer-observed hash, and approved content hash.
Scan findings, candidate evidence, provisioning events, and proof runs are
append-only. Activated policy content cannot be edited in place.

## Identity and authority

The implementation aligns four independent planes:

1. application identity: human, agent, and service principals
2. policy: department membership, immutable assignment, sponsor ceiling, and
   explicit denial
3. runtime identity: dedicated linked-agent UID, systemd unit, private
   workspace, and broker binding
4. data authority: fixed public views, DB-bound operator context, or a brokered
   capability grant

Architect and reviewer are logical application principals. They use one
hardened operator Linux workload and PostgreSQL login, while a root-provisioned
secret-hash mapping resolves the authenticated human and department inside each
transaction. FORCE RLS scopes protected identity, quarantine, governance,
proof, and audit rows. The MVP does not claim one Linux user or database login
per human.

Linked agents are separate principals with dedicated locked Linux users and
sandboxed systemd units. Their effective access is the intersection of their
own assignment, own membership, broker binding, active grant, sponsor ceiling,
and explicit-denial absence. They have no direct PostgreSQL login or canonical
write path.

The proof validates application and workload controls under the target's
trusted host-root and PostgreSQL-superuser administration boundary. It does not
claim resistance to those administrators.

## Runtime state

| Service | Linux identity | Boundary |
| --- | --- | --- |
| `organizational-ai-memory.service` | `oam-public:oam-public` | public fixed views and sanitized proof |
| `organizational-ai-memory-operator.service` | `oam-operator:oam-operator` | protected console and DB-bound human context |
| `organizational-ai-memory-broker.service` | `oam-broker:oam-agent-broker` | read-only brokered agent retrieval |
| `organizational-ai-memory-provisioner.service` | `root:oam-operator` | exact allowlisted host mutations over a protected socket |
| `organizational-ai-memory-codex.service` | `oam-codex:oam-codex` | isolated structured generation, no database or repository access |

Per-agent instances use
`organizational-ai-memory-agent@.service`; they are distinct from the five
always-on product services.

The isolated Codex account uses:

```text
HOME=/var/lib/oam-codex
CODEX_HOME=/var/lib/oam-codex/.codex
model=gpt-5.3-codex-spark
```

The generated browser path is live. Spark receives only the deterministic
public-safe projection. Every asset/source-turn citation is validated; invalid
output, timeout, unavailable auth, or unavailable sidecar returns the complete
stored recommendation with an explicit fallback.

## Verified release evidence

| Gate | Final result |
| --- | --- |
| API/security suite | `193/193` passed |
| Current real PostgreSQL integration suite | `3/3` passed |
| Fresh/upgraded/clean PostgreSQL security matrix | `9/9` passed |
| Live identity/access proof | `22/22`, overall `PASS` |
| Live Playwright/system-Chrome QA | `35/35` passed |
| Curated screenshot capture | `8/8` passed |
| Production dependency audit | 0 vulnerabilities |
| Offline proof bundle verification | passed |

Evidence paths:

```text
artifacts/evaluation/identity-plane-proof/report.json
artifacts/evaluation/identity-plane-proof/report.html
artifacts/evaluation/identity-plane-proof/junit.xml
artifacts/evaluation/identity-plane-proof/manifest.sha256
artifacts/evaluation/identity-plane-proof/public-proof.json
artifacts/qa/browser/report.json
artifacts/submission/screenshots/capture-report.json
artifacts/evaluation/gpt-5.3-codex-spark-xhigh-release-review.md
```

The Browser plugin was unavailable on this target. Repository Playwright used
system Chrome and records that fallback in both reports.

## Exact release commands

The principal final commands were run from
`/home/admin/organizational-ai-memory`:

```bash
OAM_TRUSTED_PROXY_CIDR='<redacted target runtime value>' \
OAM_INSTALL_CONFIRM=INSTALL_ORGANIZATIONAL_AI_MEMORY_IDENTITY_PLANE \
  scripts/deploy/install_identity_plane.sh

env \
  OAM_IDENTITY_PROOF_MODE=live \
  OAM_IDENTITY_PROOF_CONFIRM_MUTATIONS=RUN_ISOLATED_IDENTITY_PROOF \
  OAM_IDENTITY_PROOF_CREDENTIAL_FILE=/home/admin/organizational-ai-memory/.local-secrets/proof-operator-credentials.json \
  OAM_IDENTITY_PROOF_DB_CREDENTIAL_FILE=/home/admin/organizational-ai-memory/.local-secrets/public-db-probe.json \
  OAM_IDENTITY_PROOF_OPERATOR_URL=http://127.0.0.1:3010 \
  OAM_IDENTITY_PROOF_PUBLIC_URL=https://memory.sellsystems.agency \
  node scripts/evaluation/run_identity_plane_proof.mjs

node scripts/evaluation/verify_identity_proof.mjs \
  artifacts/evaluation/identity-plane-proof

npm run app:test

OAM_INTEGRATION_DATABASE_URL='postgresql://postgres@/oam_root_clean_0711d?host=%2Ftmp%2Foam-pgtest-17&port=55432' \
  node --test test/integration/*.test.mjs

OAM_QA_BASE_URL=https://memory.sellsystems.agency \
OAM_QA_OPERATOR_CREDENTIAL_FILE=/home/admin/organizational-ai-memory/.local-secrets/proof-operator-credentials.json \
OAM_QA_REQUIRE_OPERATOR=1 \
  npm run app:qa

OAM_QA_BASE_URL=https://memory.sellsystems.agency \
OAM_QA_OPERATOR_CREDENTIAL_FILE=/home/admin/organizational-ai-memory/.local-secrets/proof-operator-credentials.json \
  npm run submission:screenshots

npm audit --omit=dev --json

codex exec -C /home/admin/organizational-ai-memory \
  -m gpt-5.3-codex-spark \
  -c 'model_reasoning_effort="xhigh"' \
  -s danger-full-access --ephemeral \
  -o artifacts/evaluation/gpt-5.3-codex-spark-xhigh-release-review.md \
  '<read-only bounded release-review prompt>'
```

Private credential values were never printed or written to tracked artifacts.
The target proxy value was supplied at runtime and is deliberately redacted
from this public-safe handoff.
The real-PostgreSQL command used an isolated temporary cluster and database for
testing; that cluster is stopped after packaging.

## URLs verified

All public page and readiness routes returned HTTP `200`:

```text
https://memory.sellsystems.agency/
https://memory.sellsystems.agency/assets
https://memory.sellsystems.agency/demo
https://memory.sellsystems.agency/method
https://memory.sellsystems.agency/evidence
https://memory.sellsystems.agency/api/readyz
https://memory.sellsystems.agency/api/public/access-proof
```

The final browser suite also exercised deterministic capability search,
negative-query behavior, the canonical recommendation, generated structured
assist, analytics, asset provenance, architect authentication, effective
access, mobile navigation, focus management, and responsive layout.

## Known degraded modes

| Failure | Behavior |
| --- | --- |
| Spark unavailable, timed out, or unauthenticated | HTTP `200` deterministic fallback; readiness remains healthy |
| Generated schema or citation invalid | output rejected; stored selection remains authoritative |
| Public proof missing, stale, unsafe, or build-mismatched | proof rail fails closed; no inferred pass |
| Broker unavailable | linked agents fail closed; public deterministic reads remain available |
| Provisioner unavailable or uncertain | no activation is accepted; compensation queues host suspension |
| PostgreSQL unavailable | readiness fails because canonical memory is unavailable |

## Factual remaining gaps

- no live semantic retrieval lane; deterministic lexical PostgreSQL retrieval
  is authoritative
- no enterprise SSO/SCIM; human console credentials are root-managed
- no per-human Linux or PostgreSQL account
- no historical capability-growth series or recommendation outcome feedback
- duplication and gap signals are authored, not continuously inferred
- compact 9-asset seed and incomplete external version lineage
- bounded text/Markdown ingestion only; no connector library or autonomous
  canonical writeback
- no complete multi-tenant administration, federation, or billing surface
- only the pinned Codex ChatGPT-authenticated model/runtime is proven
- Linux linked-agent enforcement has no Kubernetes, macOS, or Windows adapter

See `docs/KNOWN_GAPS.md` for the complete judge-facing register.

## Manual work remaining

1. add and verify a repository remote, then publish the package commit
2. record or upload the factual demo video
3. create the Builder Hub project entry
4. select P5 as the problem statement
5. add repository/video URLs and upload the final screenshots
6. review declarations and submit

No portal, Builder Hub, remote push, or submission action was performed.

## Preserved boundaries

- Only `/home/admin/organizational-ai-memory` and this target's product runtime
  were changed.
- No controller host, controller Node-RED, other instance, or upstream proxy was
  changed.
- No SSH key, SSH configuration, `known_hosts`, or SSH-agent state was changed.
- The live target-specific nginx file remains ignored; only the sanitized
  `.example` belongs in Git.
- Host root and PostgreSQL-superuser administration remain explicitly trusted.
