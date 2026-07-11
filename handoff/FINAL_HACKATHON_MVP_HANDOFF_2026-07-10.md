# Organizational AI Memory Release Handoff

Status: final local release handoff for deployed code commit
`525ff861b3580365839f487ca0dca10d0bf791cd`. GitHub publication, public video
upload, and Builder Hub submission remain operator-only.

Public product: `https://memory.sellsystems.agency/`

Primary problem statement: **P5, Organizational AI Memory**. Human-AgentOS is
supporting enforcement architecture for independent agent identities, not a
second product.

Pre-enhancement baseline:
`860db5e15c6c556ed456d8263aed4f4732cd2363`

## Product statement

Organizational AI Memory preserves reviewed prompts, workflows, decisions,
agent patterns, and employee experience as typed, versioned, cited capability.
Every onboarded employee has exactly one distinct Personal Memory Agent. The
agent can retrieve only explicitly shared current personal-memory revisions
through its own policy and runtime identity; it is not a digital copy and does
not act as the employee's identity.

## Canonical capability path

```text
free-text task
-> deterministic PostgreSQL task mapping
-> reviewed capability assets
-> asset -> observation -> source turn
-> optional non-authoritative Spark adaptation
```

The stored `website_delivery_handoff` mapping selects:

```text
prompt:website_handoff_brief_v1
workflow:portfolio_site_delivery_v1
decision:source_first_before_generation_v1
```

Unsupported, underspecified, stop-word-only, and instruction-injection-shaped
queries return no match instead of unrelated memory.

## Exactly-one employee workflow

The protected release path is:

```text
architect onboarding
-> active human + exactly one draft Personal Memory Agent
-> hash-only employee workspace credential
-> confirmed physical Linux/systemd/broker provisioning
-> explicit pair activation
-> employee owner-only profile and memory versions
-> explicit current-revision agent access
-> cited employee preview
-> separate physical-agent broker retrieval
-> edit resets access
-> explicit re-share exposes only the new revision
-> suspension revokes workspace and physical retrieval
```

Important authority rules:

1. `identity.employee_personal_agents` is the authoritative one-to-one pair;
   one human cannot receive a second agent and one agent cannot serve a second
   human.
2. Onboarding does not prove or activate physical execution. Activation
   requires the succeeded provisioning job, runtime binding, broker credential,
   policy assignment, and active personal-context grant.
3. New and edited personal memories are `owner_only`. Editing always removes
   prior agent access until the employee explicitly shares the new revision.
4. Personal memory remains outside canonical organizational capability. It can
   reach organizational reuse only through the separate quarantine, evidence,
   independent-review, and draft-only promotion path.
5. Linked agents have locked Linux identities and no direct PostgreSQL login or
   canonical-memory write path.

## Preview and physical proof

The `/workspace/` context result is an **employee preview**. It executes in the
employee web workload under the employee's hash-bound PostgreSQL context and
shows what the linked agent is permitted to retrieve.

A **physical Personal Memory Agent proof** must come from the dedicated agent
process using its own broker credential. It must show the same allowed
`memory_id`, revision, and `content_sha256`, plus protected-resource and
direct-database denial. Cross-employee and wrong-agent denial are proved
separately by the real-PostgreSQL integration case. Preview success is not
physical-runtime evidence.

## Architecture summary

| Workload | Identity and authority |
| --- | --- |
| Public product | `oam-public`, fixed `oam_public` views, no protected write path |
| Architect Console | shared `oam-operator` workload; root-issued human context hash and FORCE RLS |
| Employee workspace | `oam-employee`; hash-only human/department/agent context and `personal` schema functions |
| Memory broker | `oam-broker`; independent agent credential, policy/grant intersection, FORCE RLS |
| Provisioner | root-owned allowlisted Unix-socket operations |
| Spark sidecar | isolated `oam-codex`; no database credential or repository access |
| Personal Memory Agent | dedicated locked UID and sandboxed systemd unit; broker only |

Host root and the PostgreSQL superuser are trusted administrative boundaries.
The release does not claim resistance to those administrators.

## Dated prior evidence

The following evidence belongs to the earlier public capability release and is
retained only with its date:

```text
deployed source SHA-256: d71ae5e50ce880e5e2be436ffbe0d96d017420d16c003897ea83c160cfea5687
proof time UTC:          2026-07-11T04:11:17.654Z
identity proof:          PASS 22/22
public browser QA:       35/35
public screenshots:      8/8 at 2026-07-11T04:12:59.529Z
```

This evidence predates the Personal Memory Agent release and must not be used
to substantiate the protected employee workflow.

## Fresh release evidence

| Field | Required value |
| --- | --- |
| Deployed code commit | `525ff861b3580365839f487ca0dca10d0bf791cd` |
| Published repository URL | Not configured; `git remote -v` is empty |
| Deployed source SHA-256 | `da4a85d2c50f0605f9bc43287c768edf2a113d00b69fe7ef0c8c36c62c0ce561` |
| Install completed UTC | `2026-07-11T13:40:58Z` |
| Public readiness URL/time/status | `/api/readyz`, `2026-07-11T13:52:47Z`, HTTP 200 `ready` |
| Employee readiness URL/time/status | `/workspace/api/readyz`, `2026-07-11T13:52:47Z`, HTTP 200 `ready` |
| API/security suite pass/total | 275/275 PASS |
| Real PostgreSQL integration pass/total | 5/5 PASS across full and provisioner invocations |
| V8 fresh/repeat migration pass/total | 2/2 PASS |
| Employee/personal-agent proof run ID | `0711-final-f` |
| Exactly-one duplicate-pair denial | PASS, real PostgreSQL |
| Cross-employee personal-memory denial | PASS, real PostgreSQL |
| Edit-reset and explicit re-share proof | PASS, revision 4 cited after re-consent |
| Suspension/revocation proof | PASS, 22-control proof plus integration coverage |
| Build-bound identity proof | 22/22 PASS at `2026-07-11T13:42:15.358Z` |
| Browser QA report and pass/total | `artifacts/qa/browser/report.json`, 35/35 PASS |
| Screenshot capture report and pass/total | public 8/8; protected browser 19/19 plus physical proof 1/1 |
| Video file SHA-256 | `5233af147e807b41452d67fa7d71dddf17f160841caa091f0034785bc1670bc3` |
| Public video URL | Not uploaded; operator-only |
| Final reviewer and UTC | Codex release audit, `2026-07-11T13:52:18Z` |

## Expected release URLs

These routes were freshly verified for the release:

```text
https://memory.sellsystems.agency/
https://memory.sellsystems.agency/capabilities
https://memory.sellsystems.agency/assets
https://memory.sellsystems.agency/method
https://memory.sellsystems.agency/evidence
https://memory.sellsystems.agency/architect/
https://memory.sellsystems.agency/workspace/
https://memory.sellsystems.agency/api/readyz
https://memory.sellsystems.agency/api/public/access-proof
```

The employee proof did not rely on a static-page check: it exercised login,
profile, capture, private no-match, share, cited preview, edit reset, re-share,
and the separate physical-agent broker path.

## Release command record

Run from `/home/admin/organizational-ai-memory`. The operator must supply the
trusted proxy value without recording it in public artifacts.

```bash
OAM_TRUSTED_PROXY_CIDR='<redacted target runtime value>' \
OAM_INSTALL_CONFIRM=INSTALL_ORGANIZATIONAL_AI_MEMORY_IDENTITY_PLANE \
  scripts/deploy/install_identity_plane.sh

npm run app:test

OAM_QA_BASE_URL=https://memory.sellsystems.agency \
OAM_QA_REQUIRE_OPERATOR=1 \
OAM_QA_OPERATOR_CREDENTIAL_FILE=/home/admin/organizational-ai-memory/.local-secrets/proof-operator-credentials.json \
  npm run app:qa -- artifacts/qa/live

OAM_QA_BASE_URL=https://memory.sellsystems.agency \
OAM_QA_OPERATOR_CREDENTIAL_FILE=/home/admin/organizational-ai-memory/.local-secrets/proof-operator-credentials.json \
  npm run submission:screenshots

OAM_MEDIA_CAPTURE_CONFIRM=CAPTURE_EMPLOYEE_PERSONAL_AGENT_WORKFLOW \
OAM_MEDIA_RUN_ID=0711-final-f \
OAM_MEDIA_ALLOW_OVERWRITE=1 \
OAM_QA_OPERATOR_CREDENTIAL_FILE=/home/admin/organizational-ai-memory/.local-secrets/proof-operator-credentials.json \
  node scripts/evaluation/capture_employee_workflow_media.mjs

systemctl set-environment OAM_AGENT_PERSONAL_CONTEXT_QUERY='website handoff provenance'
systemctl restart organizational-ai-memory-agent@f95eb147fed8.service
systemctl unset-environment OAM_AGENT_PERSONAL_CONTEXT_QUERY

OAM_PHYSICAL_PROOF_CONFIRM=SANITIZE_PERSONAL_AGENT_RUNTIME_PROOF \
OAM_PHYSICAL_PROOF_RUN_ID=0711-final-f \
OAM_PHYSICAL_PROOF_EMPLOYEE='Mai Nguyen' \
OAM_PHYSICAL_PROOF_AGENT="Mai Nguyen's Personal Memory Agent" \
  node scripts/evaluation/sanitize_personal_agent_runtime_proof.mjs \
  /var/lib/oam-agents/f95eb147fed8/agent-proof.json

node scripts/evaluation/render_personal_agent_runtime_proof.mjs \
  artifacts/evaluation/personal-agent-runtime-proof-sanitized.json \
  artifacts/submission/media/screenshots/employee-workflow/20-physical-agent-runtime-proof.png

OAM_RELEASE_VIDEO_CONFIRM=BUILD_EMPLOYEE_WORKFLOW_RELEASE_VIDEO \
  node scripts/evaluation/build_employee_workflow_release_video.mjs

OAM_RELEASE_MEDIA_REVIEW_CONFIRM=REVIEWED_PUBLIC_SAFE_RELEASE_MEDIA \
  node scripts/evaluation/build_release_media_manifest.mjs
```

The real-PostgreSQL cases were executed once against the target during release
verification; those tests persist synthetic records, so their active/draft
fixtures were suspended afterward. That invocation is deliberately omitted
from the reproduction block: future runs must use a migrated disposable
database, and the operator DSN must be supplied without placing a password in
process arguments.

The `0711-final-f` block records the completed state-changing capture and must
not be rerun with the same ID. A future capture needs a fresh synthetic run ID
and an explicit decision about overwriting release media. The remaining
commands reproduce checks already completed for this release. Copy future
counts from machine-readable reports, not terminal memory.

## Submission artifacts

| Artifact | Status |
| --- | --- |
| Factual runbook | complete with fresh release values |
| Architecture explanation | complete and deployment-aligned |
| Product story | complete; repository/public-video URLs remain manual |
| Personal Memory Agent screenshots | 20/20 captured and reviewed |
| Product walkthrough video | H.264 MP4 recorded, hashed, and locally reviewable |
| Source repository | local Git only until operator provides and verifies remote |
| Builder Hub entry and final upload | operator-only, not performed |

Canonical documents:

```text
docs/runtime/ORGANIZATIONAL_AI_MEMORY_RUNBOOK.md
docs/architecture/ORGANIZATIONAL_AI_MEMORY_MVP_ARCHITECTURE.md
docs/demo/ORGANIZATIONAL_AI_MEMORY_DEMO_SCRIPT.md
docs/demo/DEMO_VIDEO_PLAN.md
docs/submission/SCREENSHOT_MANIFEST.md
docs/submission/PUBLISHING.md
docs/submission/PROJECT_STORY.md
docs/KNOWN_GAPS.md
```

## Factual remaining gaps

- no enterprise SSO/SCIM, employee passkey, password reset, or self-service
  workspace-token recovery
- employee HTTP sessions are bounded and in-memory, not a distributed session
  service
- Personal Memory Agent suspension revokes all workspace credentials and is
  terminal in the product UI; no personal credential rotation/reissue exists,
  while generic-agent resume remains API-only
- no live semantic retrieval lane; deterministic PostgreSQL retrieval is
  authoritative
- no direct personal-to-organizational publication; review-gated quarantine is
  deliberately separate
- no recommendation outcome feedback or historical growth series
- duplication and gap signals are authored, not continuously inferred
- compact public-safe corpus and incomplete external version lineage
- no complete multi-tenant administration, federation, billing, or non-Linux
  physical-agent adapter

See `docs/KNOWN_GAPS.md` for the complete register.

## Manual operator work remaining

1. add an operator-provided GitHub remote and verify the push
2. upload the existing hashed video and record its public URL
3. create the Builder Hub entry, select P5, upload artifacts, and submit

No portal, Builder Hub, remote push, or final submission action is performed by
this handoff.

## Preserved boundaries

- Work is limited to `/home/admin/organizational-ai-memory` on this target.
- The controller host, controller Node-RED, other instances, and upstream proxy
  remain outside scope.
- No SSH key, SSH configuration, `known_hosts`, or SSH-agent state is changed.
- Tokens, cookies, broker credentials, secret-bearing paths, and raw proof
  artifacts are excluded from public release media. Synthetic runtime UID,
  unit, and workspace identifiers are intentionally visible as enforcement
  evidence.
- The target-specific nginx file remains local; only the sanitized repository
  configuration belongs in Git.
