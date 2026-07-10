# Organizational AI Memory Runbook

## Runtime

- public host: `memory.sellsystems.agency`
- instance ingress: nginx on port `80`
- application: Node.js on `127.0.0.1:3000`
- canonical store: Postgres on `127.0.0.1:5432`
- application account: `tgops`
- application unit: `organizational-ai-memory.service`
- optional generation account: `oam-codex`
- generation unit: `organizational-ai-memory-codex.service`
- generation socket: `/run/organizational-ai-memory-codex/assist.sock`
- generation model: `gpt-5.3-codex-spark`

Node-RED is not part of the product path and must not be restarted for this
application.

## Public route map

| Route | Purpose |
| --- | --- |
| `/` | Capability-first explanation and live stored recommendation |
| `/assets` | Governed asset inventory, filters, analytics, and source paths |
| `/demo` | Deterministic task recommendation, optional adaptation, and continuity query |
| `/method` | Formation, governance, recommendation, adaptation, and safety |
| `/evidence` | Continuity memory and provenance inspector |
| `/api/healthz` | Main process liveness |
| `/api/readyz` | Database, public corpus, and capability-pack readiness |

## Fixed data boundaries

The continuity API fixes this scope server-side:

```text
brand_key=sell_systems_hackathon_demo
thread_key=oam_public_demo_v1
metadata.corpus=public_demo
metadata.visibility=public_safe
```

The capability API separately fixes:

```text
pack_key=aihackathon_public_safe_asset_pack_2026_07_10
evidence_thread_key=oam_public_capability_assets_v1
brand_key=sell_systems_hackathon_demo
corpus=public_demo
source_classification=public_safe
publication_status=active
```

Clients cannot provide a brand, tenant, thread, corpus, pack, publication
status, or visibility selector.

The internal regression corpus is
`sell_systems_hackathon_internal / oam_internal_eval_v1`, marked
`internal_demo + internal_demo_only`. It has no public UI or API route. nginx
returns `404` for `/internal`.

## Reproduce canonical data

Install dependencies and apply all schemas on a new database:

```bash
cd /home/admin/organizational-ai-memory
npm install
psql "$DATABASE_URL" -f sql/platform_schema_v1.sql
psql "$DATABASE_URL" -f sql/memory_schema_v1.sql
psql "$DATABASE_URL" -f sql/memory_public_mvp_indexes_v1.sql
psql "$DATABASE_URL" -f sql/capability_memory_schema_v1.sql
```

Import the synthetic continuity corpora, then the fixed public-safe capability
pack:

```bash
npm run demo:seed
npm run demo:capabilities:import
npm run demo:eval:internal
```

The capability importer accepts no alternate source path. It validates and
reads only the four JSON files in the fixed handoff directory. It never reads
or persists handoff Markdown.

The import creates 9 capability assets, 5 task definitions, 13 ranked
task-to-asset mappings, 9 sanitized source turns, and evidence edges that make
`asset -> observation -> source turn` inspectable. Re-running it replaces rows
for this pinned pack transactionally.

Both bootstrap paths skip vector synchronization. Do not use `memory:pipeline`
while Qdrant/TEI are unavailable because that command ends with vector sync.

## Capability pack qualifications

Keep the source record exact:

1. Seven assets are `approved`; two are only `reviewed`.
2. `risk_note` is not present in the source pack. It is stored as null and not
   displayed as a fabricated risk assessment.
3. `prompt:lead_research_brief_v1`,
   `workflow:linkedin_comment_research_v1`, and
   `workflow:b2b_outreach_triage_v1` are external lineage or usage references.
   Preserve the strings; do not create placeholder capability records.
4. Asset governance visibility is `internal`, while the sanitized pack source
   classification is `public_safe`. These fields describe different concerns.
5. The source analytics timestamp is `2026-07-10T04:00:00Z`; source turns run
   through `04:08:00Z`. Preserve the timestamp as supplied and derive displayed
   inventory counts from canonical asset rows.
6. The `asset_version_timeline` gap signal says only one asset supersedes an
   older asset, while two asset rows contain external `supersedes` keys. Keep
   the signal verbatim as authored analytics; do not use it as a live count.

## Local application operation

```bash
cd /home/admin/organizational-ai-memory
npm run app:start
```

The server binds only to `127.0.0.1:3000` unless explicitly overridden. Local
generation is disabled unless `OAM_CODEX_ASSIST_ENABLED=true`; disabled or
unavailable generation still returns the deterministic recommendation in an
HTTP `200` assist response.

## Install instance services

Install the main nginx site first. Supply the verified upstream proxy address
for the target environment; do not trust arbitrary proxy ranges:

```bash
test -n "$OAM_TRUSTED_PROXY_CIDR"
sed "s|__TRUSTED_PROXY_CIDR__|${OAM_TRUSTED_PROXY_CIDR}|g" \
  deploy/nginx/organizational-ai-memory.conf.example \
  | sudo tee /etc/nginx/sites-available/organizational-ai-memory >/dev/null

sudo ln -sfn \
  /etc/nginx/sites-available/organizational-ai-memory \
  /etc/nginx/sites-enabled/organizational-ai-memory

sudo nginx -t
sudo systemctl reload nginx
```

The site config trusts `X-Forwarded-For` only from the operator-supplied
upstream proxy range. That restores the original client address before nginx
and the application apply per-IP limits. Do not broaden `set_real_ip_from`
without first verifying a changed operator-managed proxy path.

From the repository root, run the sidecar installer exactly as root:

```bash
cd /home/admin/organizational-ai-memory
sudo ./scripts/deploy/install_codex_sidecar.sh
```

Then enable and restart the main application so its new unit and supplementary
`oam-codex` group are active:

```bash
sudo systemctl enable organizational-ai-memory.service
sudo systemctl restart organizational-ai-memory.service
```

The installer creates the `oam-codex` system user and group, adds `tgops` to
that supplementary group, copies only the sidecar runner and output schema to
`/opt/organizational-ai-memory-codex`, installs both systemd units, and starts
the sidecar. It does not copy root's Codex credentials.

Provision a separate login only through the command printed by the installer:

```bash
sudo runuser -u oam-codex -- env HOME=/var/lib/oam-codex CODEX_HOME=/var/lib/oam-codex/.codex codex login --device-auth
```

Authentication has not yet been provisioned for `oam-codex`. Do not report
Spark generation as available until that command is completed and an actual
assist response returns `interaction.status = "generated"`.

After the login is provisioned, restart both units so group membership and
credentials are read cleanly:

```bash
sudo systemctl restart organizational-ai-memory-codex.service
sudo systemctl restart organizational-ai-memory.service
```

The upstream TLS/domain link is operator-managed. This instance only serves
HTTP on port `80` and must not invent or modify upstream routing.

## Sidecar security and failure contract

The main process sends only the selected public-safe asset projection over the
Unix socket. The sidecar:

- runs as `oam-codex`, not root or `tgops`
- has no Postgres or application environment file
- has no repository or home-directory access outside its private state
- runs Codex with approval disabled, an ephemeral session, ignored local rules
  and config, a read-only empty workspace, and interactive tools disabled
- pins `gpt-5.3-codex-spark` at low reasoning effort
- validates a strict `{ "explanation": "..." }` output with a 1,800-character
  cap
- allows one active generation and terminates it after 7 seconds
- applies a sidecar-wide budget of 12 generation attempts per minute, including
  direct local socket traffic
- exposes no TCP listener

nginx and the application each cap public assist traffic at 6 requests per IP
per minute. The nginx upstream timeout is 12 seconds; the sidecar runner
deadline is 7 seconds.

If authentication, the socket, the model, output validation, or the deadline
fails, `POST /api/public/capability-assist` still returns HTTP `200` with:

```json
{
  "interaction": {
    "status": "fallback",
    "authoritative": false,
    "model": "gpt-5.3-codex-spark",
    "explanation": null,
    "selected_asset_keys": [
      "prompt:website_handoff_brief_v1",
      "workflow:portfolio_site_delivery_v1",
      "decision:source_first_before_generation_v1"
    ],
    "fallback_reason": "unavailable"
  }
}
```

The same response still includes the authoritative deterministic task and
asset selection. `/api/readyz` intentionally does not depend on sidecar health
or authentication; it checks the database, public continuity corpus, and
capability pack only.

## Verification

Run automated tests and verify fixed-scope endpoints:

```bash
cd /home/admin/organizational-ai-memory
npm run app:test
npm run demo:eval:internal

curl -fsS http://127.0.0.1:3000/api/healthz
curl -fsS http://127.0.0.1:3000/api/readyz
curl -fsS http://127.0.0.1:3000/api/public/corpus
curl -fsS http://127.0.0.1:3000/api/public/assets
curl -fsS http://127.0.0.1:3000/api/public/capability-analytics
curl -fsS http://127.0.0.1:3000/api/public/recommendations

curl -fsS \
  -H 'content-type: application/json' \
  -d '{"task_key":"website_delivery_handoff"}' \
  http://127.0.0.1:3000/api/public/recommendations

curl -fsS \
  -H 'content-type: application/json' \
  -d '{"task_key":"website_delivery_handoff","request":"Adapt this starting point for a small agency team."}' \
  http://127.0.0.1:3000/api/public/capability-assist

curl -fsS \
  -H 'content-type: application/json' \
  -d '{"query":"What is the current budget and deadline, and what changed?"}' \
  http://127.0.0.1:3000/api/public/query
```

Inspect the isolated service without treating process liveness as proof of
model authentication:

```bash
systemctl status organizational-ai-memory --no-pager --full
systemctl status organizational-ai-memory-codex --no-pager --full
sudo runuser -u oam-codex -- env HOME=/var/lib/oam-codex CODEX_HOME=/var/lib/oam-codex/.codex codex login status
ss -ltnp
```

Expected application listener: `127.0.0.1:3000`, not `0.0.0.0:3000`. The
Codex sidecar appears as a Unix socket, not a TCP port. At present, the login
status command is expected to report that `oam-codex` is not logged in, and the
assist call should return a deterministic fallback.

Verify nginx and public routing:

```bash
sudo nginx -t
curl -fsS -H 'Host: memory.sellsystems.agency' http://127.0.0.1/assets
curl -fsS -H 'Host: memory.sellsystems.agency' http://127.0.0.1/demo
curl -fsS https://memory.sellsystems.agency/api/readyz
```

## Honest runtime limits

1. Deterministic Postgres records, not generated prose, are authoritative.
2. The optional Spark account is unprovisioned and currently follows the
   fallback path.
3. `pgvector` is installed, but no semantic retrieval lane is live.
4. The asset pack is a compact sanitized seed, not a complete enterprise
   capability catalog.
5. Role-aware approval, recommendation feedback, and complete external lineage
   are not implemented.
6. This MVP does not provide generalized connector ingestion, autonomous
   writeback, or multi-tenant administration.
