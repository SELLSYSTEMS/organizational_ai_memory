# Final Organizational AI Memory Hackathon MVP Handoff

Status: packaged and verified on the target instance at
`2026-07-10T12:27:25Z`; isolated generation was activated and reverified at
`2026-07-10T14:13:07Z`.

Public product: `https://memory.sellsystems.agency/`

Packaged source baseline:
`61cd2a4df248debd0163c00570cc61004a0562d7`

The final handoff is added in the immediately following local commit. There is
no configured Git remote and no source push or portal action was performed.

## 1. Result

A judge can open the public site, understand the capability-memory product,
run the canonical website-delivery task, inspect the selected prompt, workflow,
and decision pattern, follow governed source provenance, and query current and
superseded organizational facts.

The authoritative loop is:

```text
source turn
-> observation
-> governed capability asset
-> deterministic task mapping
-> stored starting point
-> optional non-authoritative adaptation
```

Postgres remains authoritative. Optional Codex Spark prose cannot select,
reorder, approve, or persist capability assets.

## 2. What changed

### Canonical judge path

- Home, Demo, and Method now share `website_delivery_handoff` as the canonical
  path.
- Demo defaults to `Prepare a new website delivery handoff`.
- The stored recommendation exposes all three selected assets before any model
  interaction.
- Every recommended asset row now shows review state, version, summary,
  `Why it worked`, and a governance/source-evidence affordance.
- The Method route shows the concrete task-to-assets-to-source chain.
- Recommendation links were browser-tested through to an open
  `asset -> observation -> source turn` path.

### Product clarity and accessibility

- Asset provenance was moved directly after governance in the inspector.
- The Method definition layout no longer crowds long labels.
- Compact asset and method links now have at least 44px hit height.
- Browser QA now fails on undersized controls, missing canonical lifecycle
  metadata, absent why-it-worked context, missing evidence links, broken
  temporal history, or a broken recommendation-to-provenance path.
- A dead client-only `/architecture` alias was removed; `/method` remains the
  documented architecture and authority surface.

### Submission package

- Added the deployed MVP architecture explanation.
- Added a factual known-gaps register.
- Added a 110-second video plan; no finished video is falsely claimed.
- Added five curated public-safe screenshots and a machine-readable capture
  report.
- Added safe source-publishing instructions.
- Replaced the stale continuity-only Open Graph image with a reproducible
  1200x630 capture of the capability-memory Home state.
- Replaced inherited package metadata and dead scripts with a project-specific
  Node package manifest.
- Added Apache-2.0 license text and a public-safety `.gitignore`.
- Added a placeholder-based nginx example while leaving the live
  target-specific ingress file untracked.
- Initialized local Git with a reviewed public allowlist and no remote.

### Design tooling

The existing bounded Google Stitch wave and its rejection rationale remain in
`artifacts/design/DESIGN_REVIEW.md`. Stitch candidates that invented content or
claims were not used as production sources. No API key was stored in the
project and no global MCP configuration was changed under this project-only
goal.

## 3. Verified runtime

### Service identity and isolation

| Component | Verified identity and state |
| --- | --- |
| Main application | `tgops:tgops`, active, Node.js on `127.0.0.1:3000` |
| Codex sidecar | `oam-codex:oam-codex`, active, Unix socket only |
| Sidecar home | `HOME=/var/lib/oam-codex` |
| Sidecar Codex home | `CODEX_HOME=/var/lib/oam-codex/.codex` |
| nginx | active; configuration test passed |
| Postgres | active; readiness database check passed |

Both application units report `NoNewPrivileges=yes` and an empty capability
bounding set. The sidecar socket is:

```text
srw-rw---- oam-codex:oam-codex /run/organizational-ai-memory-codex/assist.sock
```

The sidecar user retains `/usr/sbin/nologin`. A shell change is not required
for the documented `runuser` device-auth command.

The installed sidecar, Spark runner, and strict output schema match the
repository copies byte-for-byte.

### Public routes

All returned HTTP `200`:

```text
https://memory.sellsystems.agency/
https://memory.sellsystems.agency/assets
https://memory.sellsystems.agency/demo
https://memory.sellsystems.agency/method
https://memory.sellsystems.agency/evidence
https://memory.sellsystems.agency/api/readyz
```

Readiness returned:

```json
{
  "status": "ready",
  "checks": {
    "database": "available",
    "public_corpus": "available",
    "capability_pack": "available"
  }
}
```

### Capability memory

- 9 governed assets across 5 types
- 2 prompts, 4 workflows, 1 agent pattern, 1 decision pattern, 1 best practice
- 7 approved and 2 reviewed assets
- 5 stored tasks and 13 ranked task-to-asset mappings
- 1 supplied duplication signal and 3 supplied capability-gap signals

The canonical `website_delivery_handoff` recommendation returned:

```text
prompt:website_handoff_brief_v1                     reviewed
workflow:portfolio_site_delivery_v1                 reviewed
decision:source_first_before_generation_v1          approved
```

### Optional Spark interaction

The sidecar is pinned to `gpt-5.3-codex-spark`. The isolated account reports
`Logged in using ChatGPT`, and the public assist path now returns:

```text
interaction.status: generated
interaction.model: gpt-5.3-codex-spark
interaction.fallback_reason: null
selected assets: all three canonical deterministic records
HTTP status: 200
```

The generated explanation is labeled non-authoritative. The deterministic
recommendation remains complete and visible, and readiness does not depend on
model authentication.

The operator later completed device authorization directly under `oam-codex`.
The credential is owned by that isolated account; no credential was copied from
another user and root was not authenticated for the production assist path.

A runner-equivalent `gpt-5.3-spark` probe was also performed under that exact
isolated ChatGPT login. Codex returned HTTP `400`, stating that the model name
is not supported for ChatGPT-account Codex. The verified
`gpt-5.3-codex-spark` pin was restored immediately. Its next canonical public
request returned generated prose in `3.19` seconds with all three deterministic
asset keys unchanged.

### Temporal continuity

The canonical query returned four grounded facts:

```text
current budget:     4500 USD per month
previous budget:    3000 USD per month, superseded
current deadline:   August 29, 2026
previous deadline:  August 15, 2026, superseded
```

Each fact retains `fact -> observation -> source turn` provenance.

## 4. Verification results

| Check | Result |
| --- | --- |
| API and boundary tests | 51 passed, 0 failed |
| Internal isolated-corpus evaluation | passed; 4 temporal cases and 0 orphan sources |
| Public HTTPS browser QA | 35 passed, 0 failed |
| Canonical Demo default | `website_delivery_handoff` |
| Recommendation row contract | 3 rows, 3 review badges, 3 why-it-worked lines, 3 evidence links |
| Assist browser state | generated, non-authoritative, recommendation preserved |
| Temporal browser state | 2 current and 2 superseded fact rows |
| Recommendation provenance navigation | canonical prompt opened with 1 expanded evidence path |
| Curated screenshots | 5 captured, 0 browser errors |
| npm production audit | 0 vulnerabilities |
| JavaScript syntax checks | passed |
| nginx configuration | syntax and configuration test passed |
| Git staged-content audit | passed; no real credential, SSH material, or private topology found |

Raw browser QA remains ignored locally. The final live report is:

```text
artifacts/qa/submission-post-auth-live/report.json
generated_at: 2026-07-10T14:14:17.541Z
base_url: https://memory.sellsystems.agency
```

Curated public screenshots and their report are tracked under:

```text
artifacts/submission/screenshots/
captured_at: 2026-07-10T12:23:06.869Z
viewport: 1440x900
```

## 5. Exact final acceptance commands

The following commands were run from
`/home/admin/organizational-ai-memory` unless shown otherwise:

```bash
npm install --ignore-scripts
npm run app:test
npm run demo:eval:internal
npm audit --omit=dev
node --check app/public/app.js
node --check app/server.mjs
node --check app/codex-sidecar.mjs
node --check scripts/evaluation/capture_submission_screenshots.mjs
node --check scripts/evaluation/run_app_browser_qa.mjs

OAM_QA_BASE_URL=https://memory.sellsystems.agency \
  node scripts/evaluation/run_app_browser_qa.mjs \
  artifacts/qa/submission-post-auth-live

node scripts/evaluation/capture_submission_screenshots.mjs \
  artifacts/submission/screenshots

npm run design:og

systemctl is-active \
  organizational-ai-memory.service \
  organizational-ai-memory-codex.service \
  nginx.service \
  postgresql.service

systemctl show organizational-ai-memory.service \
  -p User -p Group -p MainPID -p NoNewPrivileges \
  -p CapabilityBoundingSet -p ExecStart

systemctl show organizational-ai-memory-codex.service \
  -p User -p Group -p MainPID -p NoNewPrivileges \
  -p CapabilityBoundingSet -p ExecStart

runuser -u oam-codex -- \
  env HOME=/var/lib/oam-codex \
  CODEX_HOME=/var/lib/oam-codex/.codex \
  codex login status

nginx -t

curl -fsS https://memory.sellsystems.agency/api/readyz
curl -fsS https://memory.sellsystems.agency/api/public/capability-analytics

curl -fsS -H 'content-type: application/json' \
  -d '{"task_key":"website_delivery_handoff"}' \
  https://memory.sellsystems.agency/api/public/recommendations

curl -fsS -H 'content-type: application/json' \
  -d '{"task_key":"website_delivery_handoff","request":"Adapt this starting point for a small agency team."}' \
  https://memory.sellsystems.agency/api/public/capability-assist

curl -fsS -H 'content-type: application/json' \
  -d '{"query":"What is the current budget and deadline, and what changed?"}' \
  https://memory.sellsystems.agency/api/public/query

git diff --cached --check
git diff --cached --stat
git diff --cached --name-status
git commit -m "Package Organizational AI Memory hackathon MVP"
```

Post-authentication activation also ran:

```bash
runuser -u oam-codex -- \
  env HOME=/var/lib/oam-codex \
  CODEX_HOME=/var/lib/oam-codex/.codex \
  codex login status

./scripts/deploy/install_codex_sidecar.sh
systemctl restart organizational-ai-memory-codex.service
systemctl is-active organizational-ai-memory-codex.service

curl -fsS -H 'content-type: application/json' \
  -d '{"task_key":"website_delivery_handoff","request":"Adapt this starting point for a small agency team preparing a client handoff."}' \
  https://memory.sellsystems.agency/api/public/capability-assist
```

Targeted staged scans were also run for private keys, bearer headers, API-key
and password assignments, the provided Stitch-key prefix, private-address
patterns, SSH material, and restricted host aliases. Matches were limited to
empty or `change-me` examples, a deliberate error-redaction test value, and the
publishing guide's own scan expressions.

## 6. Isolated authentication maintenance

If the isolated session expires, authenticate only the sidecar account:

```bash
sudo runuser -u oam-codex -- \
  env HOME=/var/lib/oam-codex \
  CODEX_HOME=/var/lib/oam-codex/.codex \
  codex login --device-auth
```

Then verify and restart:

```bash
sudo runuser -u oam-codex -- \
  env HOME=/var/lib/oam-codex \
  CODEX_HOME=/var/lib/oam-codex/.codex \
  codex login status

sudo systemctl restart organizational-ai-memory-codex.service
sudo systemctl restart organizational-ai-memory.service
```

Finally run the canonical assist request and confirm
`interaction.status = "generated"` with model `gpt-5.3-codex-spark`. Do not
authenticate as root and do not copy another user's Codex state.

## 7. Remaining work

Operator-only:

1. provide and confirm a Git remote, then push the local `main` branch
2. record the planned 110-second video or upload another factual recording
3. create the Builder Hub project draft
4. confirm the hackathon track
5. upload repository, video, and screenshots
6. review declarations and submit in the portal

Product gaps remain factual and documented in `docs/KNOWN_GAPS.md`:

- no semantic retrieval lane
- governance metadata without enforced RBAC or approval actions
- no historical growth time series
- no recommendation-outcome feedback
- authored, not autonomously inferred, duplication and gap signals
- compact seed and incomplete external lineage
- no broad ingestion, autonomous writeback, or multi-tenant administration
- authenticated CLI subprocess edge cases are not exhaustively unit-tested

## 8. Known degraded modes

| Failure | Public behavior |
| --- | --- |
| Codex unauthenticated | HTTP `200` fallback plus complete deterministic recommendation |
| Sidecar unavailable or timed out | same bounded fallback; readiness remains healthy |
| Invalid generated output | rejected; stored recommendation remains authoritative |
| Semantic lane unavailable | exact and lexical Postgres retrieval remains available |
| Postgres unavailable | readiness fails because canonical memory is unavailable |

## 9. Boundaries preserved

- No controller host or controller Node-RED change was made.
- The existing Node-RED listener on this target was observed only and not
  modified.
- No other instance was accessed or changed.
- No upstream domain or TLS proxy configuration was changed.
- No SSH key, SSH configuration, known-hosts state, or SSH agent state was
  changed.
- The live target-specific nginx file was not added to Git; only the sanitized
  `.example` is tracked.
- No Builder Hub or portal action was performed.
