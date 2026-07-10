# Organizational AI Memory MVP Architecture

Status: deployed MVP, verified on `2026-07-10`.

## Product boundary

Organizational AI Memory turns reviewed, public-safe work history into two
forms of reusable memory:

1. time-aware facts, observations, summaries, and reflections
2. governed prompts, workflows, agent patterns, decision patterns, and best
   practices

A known task retrieves a stored asset selection before any model is invoked.
Postgres is the canonical source of truth; generated prose is optional and
never authoritative.

## Deployed topology

```text
Public browser
    |
    v
Operator-managed TLS/domain boundary
    |
    v
nginx instance ingress :80
    |
    v
organizational-ai-memory.service
Node.js 22, 127.0.0.1:3000, user tgops
    |                                      |
    |                                      v
    |                              Unix domain socket
    |                                      |
    v                                      v
Postgres 17, 127.0.0.1:5432       organizational-ai-memory-codex.service
canonical memory store             user/group oam-codex:oam-codex
                                           |
                                           v
                                   local Codex CLI
                                   gpt-5.3-codex-spark, optional
```

The main application runs as `tgops:tgops` and has `oam-codex` as a
supplementary group so it can call the protected sidecar socket. The sidecar
runs as `oam-codex:oam-codex`, with `HOME=/var/lib/oam-codex` and
`CODEX_HOME=/var/lib/oam-codex/.codex`. It does not receive database
credentials or the application environment and it does not run from the
project source tree.

The instance terminates neither public TLS nor the outer domain link. Those
remain an operator-managed boundary outside this repository.

## Canonical data model

The continuity memory path stores ordered source turns, extracted
observations, atomic facts with validity intervals, summaries, and
reflections. Superseded facts remain available for audit.

```text
fact -> observation -> source turn
```

The capability path stores a pinned public-safe pack, typed assets, task
definitions, ranked task-to-asset mappings, lifecycle metadata, analytics
signals, and evidence edges.

```text
task key -> deterministic ranked asset mapping
asset -> observation -> source turn
```

These are independent provenance paths over the same canonical Postgres
memory foundation. The first explains an answer about current and historical
truth. The second explains why a reusable capability is present and where its
supporting narrative came from.

## Public request flows

### Deterministic task start

1. The browser posts exactly a `task_key` to the recommendation endpoint.
2. The server applies its fixed public pack scope.
3. Postgres returns the stored task reason and ranked asset mappings.
4. The UI shows the selected assets and their governance and evidence.

For `website_delivery_handoff`, the canonical stored selection is:

```text
prompt:website_handoff_brief_v1
workflow:portfolio_site_delivery_v1
decision:source_first_before_generation_v1
```

### Optional Spark adaptation

1. The application first retrieves the same deterministic recommendation.
2. It sends only a bounded projection of those selected public-safe assets and
   the short user request to the Unix-socket sidecar.
3. The sidecar invokes the local Codex CLI with the model fixed to
   `gpt-5.3-codex-spark`, a read-only empty workspace, disabled interactive
   tools, a strict output schema, and a short deadline.
4. A valid response is labeled non-authoritative and cannot change the stored
   asset selection or write to memory.

If authentication, model execution, schema validation, the socket, or the
deadline fails, the endpoint returns HTTP `200` with the complete
deterministic recommendation and an explicit fallback interaction. Application
readiness does not depend on optional generation.

As verified on `2026-07-10`, the isolated `oam-codex` account is authenticated
and the live assist path returns bounded generated prose. The fallback contract
remains active for any authentication, model, schema, socket, or deadline
failure.

### Continuity query

1. The browser posts exactly a bounded public query.
2. The server pins the public thread and classification.
3. Deterministic Postgres retrieval returns current and relevant superseded
   facts.
4. The response includes observation and source-turn references for each
   claim.

Semantic retrieval is reported as unavailable. It is not required for the
working exact and lexical Postgres path.

## Safety and authority

The public continuity corpus and public capability pack are fixed on the
server. Browser clients cannot select another tenant, corpus, thread, pack,
publication state, or visibility. The richer regression corpus is isolated
and has no public route.

Capability records expose `visibility`, `review_status`, `version`, owner
role, consumer roles, validation date, lineage, and evidence. These are
descriptive governance metadata retained from the simulated source
organization. They are not an enforced RBAC or approval system. The MVP has no
authenticated user roles, role-based route authorization, or approval-action
UI.

The public-safe source classification and an asset's simulated `internal`
governance visibility describe different concerns. Public routes expose only
the sanitized demonstration records while preserving the source metadata
truthfully.

## Analytics contract

The analytics endpoint derives current inventory counts from canonical asset
rows and returns stored duplication and missing-capability signals. The live
seed contains 9 assets across 5 types, with 7 approved and 2 reviewed records.

Historical growth analytics are not implemented. There is no time-series
inventory, recommendation-success metric, or automatic trend calculation.
Duplication and gap entries are authored pack signals, not live inference over
all organizational work.

## Failure properties

- Postgres availability gates readiness because it holds the authoritative
  memory.
- Sidecar or Codex authentication failure does not gate readiness.
- Generation cannot replace, reorder, or persist the deterministic selection.
- Public APIs do not accept scope selectors.
- Internal memory has no public UI or API route.
- The system has no autonomous writeback path.

Operational commands and recovery steps are maintained in the operator
runbook. The judge path is maintained in the demo script and video plan.
