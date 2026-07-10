# Organizational AI Memory

A provenance-first organizational capability and continuity MVP for the AABW
2026 hackathon.

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
- Readiness: `https://memory.sellsystems.agency/api/readyz`

## What is live

1. Postgres 17 is the canonical memory and capability store.
2. The public capability pack contains 9 assets across 5 types, 5 task-start
   definitions, and 13 deterministic task-to-asset mappings.
3. `/assets` exposes governance, version, role, lineage, usage, analytics, and
   source evidence without inventing missing metadata.
4. Task recommendations are stored records and remain authoritative before,
   during, and after any generated interaction.
5. `POST /api/public/capability-assist` accepts exactly `task_key` and `request`.
   It can ask `gpt-5.3-codex-spark` to adapt only the already selected assets.
6. Codex runs through a Unix-socket sidecar under the isolated `oam-codex`
   account. It has no database credentials, application environment, or
   repository access.
7. Codex authentication is not currently provisioned for that account. The
   assist API therefore returns its deterministic recommendation with an HTTP
   `200` fallback interaction; application readiness does not depend on Codex.
8. The original public continuity corpus remains `public_demo + public_safe`.
   Its internal regression counterpart is a separate tenant with no public
   route.

## Demo paths

For reusable capability, open `/demo`; `website_delivery_handoff` is the
canonical default. The stored mapping returns these assets before optional
generation:

```text
prompt:website_handoff_brief_v1
workflow:portfolio_site_delivery_v1
decision:source_first_before_generation_v1
```

For temporal memory, use:

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
| `/demo` | Deterministic task recommendation, optional Spark adaptation, and evidence query |
| `/method` | Formation, governance, recommendation, adaptation, temporal truth, and safety |
| `/evidence` | Live fact, observation, turn, summary, and reflection inspector |
| `GET /api/healthz` | Process liveness |
| `GET /api/readyz` | Database, public corpus, and capability-pack readiness |
| `GET /api/public/corpus` | Public continuity corpus metadata and counts |
| `POST /api/public/query` | Grounded query; body is exactly `{ "query": "..." }` |
| `GET /api/public/evidence?type=fact` | Public memory objects by allowed type |
| `GET /api/public/assets` | Capability assets; optional `type`, `capability_area`, and `review_status` filters |
| `GET /api/public/assets/:key` | One asset with governance, lineage, relations, and source evidence |
| `GET /api/public/recommendations` | The five stored task definitions and their assets |
| `POST /api/public/recommendations` | Deterministic selection; body is exactly `{ "task_key": "..." }` |
| `GET /api/public/capability-analytics` | Live inventory counts plus stored duplication and gap signals |
| `POST /api/public/capability-assist` | Optional adaptation; body is exactly `{ "task_key": "...", "request": "..." }` |

Clients cannot select a tenant, brand, thread, corpus, visibility, or pack.

## Architecture

```text
memory.sellsystems.agency
        |
operator-managed TLS/domain link
        |
nginx :80
        |
Node 22 application 127.0.0.1:3000
        |                         |
        |                         +-> Unix socket
        |                             isolated oam-codex sidecar
        |                             gpt-5.3-codex-spark, optional
        |
Postgres 17 127.0.0.1:5432
        |
threads -> turns -> observations -> facts/summaries/reflections
        |
capability packs -> assets -> tasks -> recommendation mappings
```

The sidecar receives a bounded projection of the deterministic public-safe
selection, uses a strict one-field output schema, allows one active generation,
and stops the Codex process after 7 seconds. Failure never changes or hides the
stored recommendation.

`pgvector` is installed, but semantic retrieval is not live on this target.
Qdrant and TEI are not running. The API reports semantic retrieval as
`unavailable`; deterministic Postgres retrieval remains usable.

## Repository map

```text
app/
  server.mjs                       Node HTTP entrypoint
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
  recommendations.json             deterministic task mappings
  analytics.json                   compact analytics signals
  source_turns.json                sanitized evidence narratives
scripts/demo/
  bootstrap_demo_corpora.mjs       reproducible continuity bootstrap
  import_capability_pack.mjs       strict four-JSON capability importer
scripts/deploy/
  install_codex_sidecar.sh         isolated account and service installer
sql/
  memory_schema_v1.sql             canonical memory model
  capability_memory_schema_v1.sql  capability, recommendation, and evidence model
deploy/
  nginx/                           instance-side routing and rate limits
  systemd/                         application and isolated sidecar units
```

## Local start

Prerequisites:

- Node.js 22+
- Postgres with `platform` and `memory` schemas applied
- `/etc/tg_ops/platform.env` or standard `PG*`/`DATABASE_URL` variables

```bash
cd /home/admin/organizational-ai-memory
npm install
psql "$DATABASE_URL" -f sql/capability_memory_schema_v1.sql
npm run demo:seed
npm run demo:capabilities:import
npm run demo:eval:internal
npm run app:test
npm run app:start
```

The app defaults to `http://127.0.0.1:3000`. Without
`OAM_CODEX_ASSIST_ENABLED=true` and a working isolated sidecar, capability
assist intentionally returns the deterministic HTTP `200` fallback.

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

The importer reads only `assets.json`, `recommendations.json`, `analytics.json`,
and `source_turns.json` from the fixed handoff directory. Handoff Markdown is
never ingested or served because it contains operator context outside the
public product record.

Known source-pack qualifications are preserved rather than repaired with
fabricated objects:

- 7 assets are `approved`; 2 are `reviewed`.
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
2. The isolated `oam-codex` account is not authenticated yet, so generation
   currently exercises the documented fallback path.
3. Semantic retrieval is intentionally non-gating and unavailable.
4. The asset seed is intentionally compact: 9 assets and 5 tasks, not a broad
   enterprise catalog.
5. There is no role-aware approval UI, recommendation outcome feedback loop,
   or complete external version catalog yet.
6. The MVP has no autonomous writeback, broad connector library, full ACL
   administration, or multi-tenant product surface.
