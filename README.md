# Organizational AI Memory

Built for AABW P5, Organizational AI Memory turns bounded, public-safe work
history into governed prompts, workflows, decisions, and agent patterns that
people and linked agents can retrieve, inspect, and safely reuse.

The application turns bounded, public-safe work history into distinct memory
objects and reusable AI capability assets. A known task retrieves a stored,
governed starting point; optional Codex Spark prose can adapt that selection
without changing the authoritative record.

```text
source turns
-> observations and time-valid memory
-> governed prompts, workflows, agents, decisions, and practices
-> deterministic task mapping
-> sourced starting point
-> optional non-authoritative adaptation
```

This is not an autonomous agent or a general-purpose chatbot. Postgres remains
canonical throughout both provenance paths:

```text
fact -> observation -> source turn
asset -> observation -> source turn
```

## Live product

- Home: `https://memory.sellsystems.agency/`
- Assets: `https://memory.sellsystems.agency/assets`
- Demo: `https://memory.sellsystems.agency/demo`
- Method: `https://memory.sellsystems.agency/method`
- Evidence: `https://memory.sellsystems.agency/evidence`
- Architect Console: `https://memory.sellsystems.agency/architect/` (private operator token required)
- Readiness: `https://memory.sellsystems.agency/api/readyz`
- Sanitized access proof: `https://memory.sellsystems.agency/api/public/access-proof`

## What is live

1. Postgres 17 is the canonical memory and capability store.
2. The public capability pack contains 9 assets across 5 types, 5 task-start
   definitions, and 13 deterministic task-to-asset mappings.
3. `/assets` exposes governance, version, role, lineage, usage, analytics, and
   source evidence without inventing missing metadata.
4. Task recommendations are stored records and remain authoritative before,
   during, and after any generated interaction.
5. Deterministic free-text search resolves the five stored task-start intents,
   exact assets, ambiguity, and explicit no-match behavior without a model.
6. `POST /api/public/capability-assist` accepts exactly `task_key` and `request`.
   It can ask `gpt-5.3-codex-spark` to adapt only the already selected assets.
7. Codex runs through a Unix-socket sidecar under the isolated `oam-codex`
   account. It has no database credentials, application environment, or
   repository access.
8. The isolated account is authenticated and the generated path is verified.
   Any model or sidecar failure still returns the deterministic recommendation
   with an HTTP `200` fallback; application readiness does not depend on Codex.
9. A four-plane identity system aligns application principals, immutable
   department policy, dedicated agent Linux/systemd identities, and separate
   PostgreSQL authority. The current live proof passes 22/22 controls.
10. A protected Architect Console implements logical humans, independent linked
    agents, confirmed provisioning, quarantine, independent review, draft-only
    promotion, effective-access inspection, proof records, and audit.
11. The original public continuity corpus remains `public_demo + public_safe`.
   Its internal regression counterpart is a separate tenant with no public
   route.

Architect and reviewer identities are application-level human principals, not
per-human Linux users or PostgreSQL logins. They authenticate to the console with
root-provisioned secrets while the service runs as the shared, least-privileged
`oam-operator` / `oam_operator_api` workload. For each authenticated operation,
the service establishes a transaction-local database context from that secret's
SHA-256 mapping. PostgreSQL independently resolves the active human and
department, then FORCE RLS constrains identity, quarantine, governance, proof,
and audit rows. Caller-supplied principal IDs, department IDs, or custom session
settings do not establish authority. Linked agents are different: each receives
a dedicated locked Linux identity and brokered grant, but no direct PostgreSQL
login.

The installer records a root-owned SHA-256 over the deployed security and
runtime source. The public proof loader accepts the sanitized 22-control
projection only when its `source_sha256` matches that expected digest, the
proof files have secure ownership and modes with no symlinked path component,
and the proof is no more than 24 hours old.

## Demo paths

For reusable capability, open `/demo`. The single-screen judge path starts with
the deterministic free-text query `Prepare a website delivery handoff`, resolves
`website_delivery_handoff`, and returns these assets before optional generation:

```text
prompt:website_handoff_brief_v1
workflow:portfolio_site_delivery_v1
decision:source_first_before_generation_v1
```

The home page also renders the canonical temporal query result:

```text
What is the current budget and deadline, and what changed?
```

Expected grounded facts include the current and superseded budget and deadline.
Every selected fact and asset exposes its own source path.

## Routes and API

| Route | Contract |
| --- | --- |
| `/` | Capability-first product explanation and live stored recommendation |
| `/assets` | Filterable governed asset ledger and source inspector |
| `/demo` | Single-screen search, stored recommendation, cited Spark adaptation, analytics, and access proof |
| `/method` | Formation, governance, recommendation, adaptation, temporal truth, and safety |
| `/evidence` | Live fact, observation, turn, summary, and reflection inspector |
| `/architect/` | Protected identity, policy, provisioning, quarantine, review, proof, and audit console |
| `GET /api/healthz` | Process liveness |
| `GET /api/readyz` | Database, public corpus, and capability-pack readiness |
| `GET /api/public/corpus` | Public continuity corpus metadata and counts |
| `POST /api/public/query` | Grounded query; body is exactly `{ "query": "..." }` |
| `GET /api/public/evidence?type=fact` | Public memory objects by allowed type |
| `GET /api/public/assets` | Capability assets; optional `type`, `capability_area`, and `review_status` filters |
| `GET /api/public/assets/:key` | One asset with governance, lineage, relations, and source evidence |
| `POST /api/public/capability-search` | Deterministic free-text capability search; body is exactly `{ "query": "..." }` |
| `GET /api/public/recommendations` | The five stored task definitions and their assets |
| `POST /api/public/recommendations` | Deterministic selection; body is exactly `{ "task_key": "..." }` |
| `GET /api/public/capability-analytics` | Live inventory counts plus stored duplication and gap signals |
| `POST /api/public/capability-assist` | Optional adaptation; body is exactly `{ "task_key": "...", "request": "..." }` |
| `GET /api/public/access-proof` | Sanitized schema-validated projection of the executed 22-control identity proof |

Clients cannot select a tenant, brand, thread, corpus, visibility, or pack.

## Architecture

```text
memory.sellsystems.agency
        |
operator-managed TLS/domain link
        |
nginx :80
  |-- public app 127.0.0.1:3000, oam-public, oam_public_api
  |     |-- fixed oam_public views in Postgres 17
  |     `-- Unix socket -> oam-codex -> gpt-5.3-codex-spark
  `-- /architect/ -> operator 127.0.0.1:3010, oam-operator
        |-- app human -> DB-bound secret context -> FORCE RLS
        |-- shared oam_operator_api role -> identity/governance data plane
        `-- Unix socket -> root allowlisted provisioner

linked agent UID -> sandboxed systemd unit -> broker Unix socket
                                         -> oam-broker -> FORCE RLS
```

The sidecar receives a bounded projection of the deterministic public-safe
selection, uses a strict structured plan schema, validates every asset and
source-turn citation, allows one active generation, and enforces a bounded
deadline. Failure never changes or hides the stored recommendation.

`pgvector` is installed, but semantic retrieval is not live on this target.
Qdrant and TEI are not running. The API reports semantic retrieval as
`unavailable`; deterministic Postgres retrieval remains usable.

## Repository map

```text
app/
  server.mjs                       Node HTTP entrypoint
  operator-server.mjs              protected Architect Console backend
  memory-broker.mjs                broker-only agent retrieval boundary
  provisioner.mjs                  root allowlisted host operations
  agent-runtime.mjs                linked-agent runtime proof and broker client
  codex-sidecar.mjs                isolated Unix-socket generation service
  lib/capability-*.mjs             capability storage, selection, and assist boundary
  lib/codex-*.mjs                  bounded Spark client and runner
  lib/public-memory-*.mjs          continuity memory repository and service
  public/                          responsive product UI
config/demo/
  public_demo_seed.json            synthetic public-safe continuity thread
  internal_demo_seed.json          isolated internal regression thread
handoff/aihackathon_public_safe_asset_pack_2026-07-10/
  assets.json                      capability seed records
  asset_bodies_v2.json             exact typed/versioned asset bodies
  recommendations.json             deterministic task mappings
  analytics.json                   compact analytics signals
  source_turns.json                sanitized evidence narratives
scripts/demo/
  bootstrap_demo_corpora.mjs       reproducible continuity bootstrap
  import_capability_pack.mjs       strict five-JSON capability importer
scripts/deploy/
  install_identity_plane.sh        idempotent full target installer
scripts/evaluation/
  run_identity_plane_proof.mjs     live 22-control allow/deny proof
sql/
  memory_schema_v1.sql             canonical memory model
  capability_memory_schema_v1.sql  governed capability records and public views
  capability_memory_schema_v2.sql  typed content and deterministic search support
  identity_data_plane_v1.sql       core principals, policy, RLS, quarantine, and drafts
  identity_data_plane_v2_*.sql     approved-only public asset eligibility
  identity_data_plane_v3_*.sql     sealed-source and review-hash integrity
  identity_data_plane_v4_*.sql     department-scoped provisioning and compensation
  identity_data_plane_v5_*.sql     department-scoped operator audit
  identity_data_plane_v6_*.sql     immutable policy, append-only evidence, proof scope
  identity_data_plane_v7_*.sql     DB-bound operator context and FORCE RLS
  identity_operator_context_seed_v1.sql  root-provisioned human/department mappings
deploy/
  nginx/                           instance-side routing and rate limits
  systemd/                         application and isolated sidecar units
```

## Local start

Prerequisites for the public application:

- Node.js 22+
- Postgres with `platform` and `memory` schemas applied
- `/etc/tg_ops/platform.env` or standard `PG*`/`DATABASE_URL` variables

```bash
cd /home/admin/organizational-ai-memory
npm install
psql "$DATABASE_URL" -f sql/capability_memory_schema_v1.sql
psql "$DATABASE_URL" -f sql/capability_memory_schema_v2.sql
npm run demo:seed
npm run demo:capabilities:import
npm run demo:eval:internal
npm run app:test
npm run app:start
```

The app defaults to `http://127.0.0.1:3000`. Without
`OAM_CODEX_ASSIST_ENABLED=true` and a working isolated sidecar, capability
assist intentionally returns the deterministic HTTP `200` fallback.

The protected four-plane identity system also requires identity data-plane
v1-v7, policy, operator-context seed, demo-seed, and runtime-login migrations in
installer order.
Use `scripts/deploy/install_identity_plane.sh` on this target; a manual
database build must apply the same ordered SQL chain and is intended only for
isolated test databases.

## Data safety and pack fidelity

The public continuity scope and public capability scope are fixed separately:

```text
continuity thread: oam_public_demo_v1
capability pack:   aihackathon_public_safe_asset_pack_2026_07_10
evidence thread:  oam_public_capability_assets_v1
brand:            sell_systems_hackathon_demo
corpus:           public_demo
classification:   public_safe
```

`public_safe` classifies the sanitized source pack. Asset-level `visibility`
describes the simulated source organization's governance state and is retained
as `internal`; it is not a public routing selector.

The importer reads only `assets.json`, `asset_bodies_v2.json`,
`recommendations.json`, `analytics.json`, and `source_turns.json` from the
fixed handoff directory. Handoff Markdown is never ingested or served because
it contains operator context outside the public product record.

Known source-pack qualifications are preserved rather than repaired with
fabricated objects:

- All 9 assets are `approved`. Public views require the exact `approved`
  state plus an explicit public-eligibility decision in sanitized pack
  metadata.
- `risk_note` is absent for all 9 assets, so the field remains null and the UI
  omits it.
- Prior-version references `prompt:lead_research_brief_v1` and
  `workflow:linkedin_comment_research_v1`, plus usage reference
  `workflow:b2b_outreach_triage_v1`, are external references not included in
  this pack.
- The supplied analytics timestamp is `2026-07-10T04:00:00Z`, while source
  turns continue through `04:08:00Z`. The timestamp is retained as source
  metadata; inventory counts are derived live from canonical asset rows.
- The supplied version-timeline gap signal says one asset supersedes an older
  asset, while two asset rows carry external `supersedes` keys. The signal is
  retained as authored analytics, not treated as a live inventory count.

No raw archives, credentials, cookies, session exports, private URLs, customer
secrets, or private financial/legal material were imported into the demo.

## Verification and operations

See:

- [Operator runbook](docs/runtime/ORGANIZATIONAL_AI_MEMORY_RUNBOOK.md)
- [Demo script](docs/demo/ORGANIZATIONAL_AI_MEMORY_DEMO_SCRIPT.md)
- [MVP architecture](docs/architecture/ORGANIZATIONAL_AI_MEMORY_MVP_ARCHITECTURE.md)
- [Known gaps](docs/KNOWN_GAPS.md)
- [Demo video plan](docs/demo/DEMO_VIDEO_PLAN.md)
- [Submission screenshot manifest](docs/submission/SCREENSHOT_MANIFEST.md)
- [Safe publishing guide](docs/submission/PUBLISHING.md)
- [Design contract](DESIGN.md)
- [Design review](artifacts/design/DESIGN_REVIEW.md)

## Known limits

1. Deterministic Postgres selection is authoritative; Spark prose is optional
   and non-authoritative.
2. The isolated generated path is live, but remains optional and bounded by a
   7-second deadline, concurrency 1, and strict rate limits. The deployed
   ChatGPT-account login supports the exact `gpt-5.3-codex-spark` pin; a direct
   `gpt-5.3-spark` probe was rejected for that authentication type.
3. Semantic retrieval is intentionally non-gating and unavailable.
4. The asset seed is intentionally compact: 9 assets and 5 tasks, not a broad
   enterprise catalog.
5. Role-aware identity, independent review, confirmed provisioning, and
   draft-only promotion are live. Human operators remain application principals
   carried through a DB-bound context on a shared workload; the MVP does not
   create a Linux user or PostgreSQL login per human. Enterprise SSO/SCIM,
   recommendation outcome feedback, and a complete external version catalog are
   not.
6. The MVP has no autonomous canonical writeback, broad connector library,
   historical growth series, or multi-tenant administration surface.
7. Per-agent physical enforcement currently targets Linux/systemd; other
   workload platforms need equivalent adapters.
