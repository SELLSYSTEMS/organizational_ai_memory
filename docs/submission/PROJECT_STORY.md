# Organizational AI Memory

**Elevator pitch:** Organizational AI Memory turns proven prompts, workflows,
decisions, and agent practices into governed, searchable capability that
employees and AI agents can safely reuse with full provenance.

**Primary challenge:** P5, Organizational AI Memory. Independent agent
identities are part of its enforcement architecture, ensuring that agent reuse
remains bounded by explicit policy.

## Inspiration

We started from a live memory foundation that could preserve facts and their
sources. The brief exposed a harder gap: organizations also lose the reusable
method behind those facts, including the prompt, workflow, decision context,
failure lesson, and access boundary that made the work effective.

Organizations are investing in AI training, prompt engineering, automation, and
agents, but much of the resulting capability still lives in personal prompt
histories, local workflows, and individual operating habits. When someone changes
roles or leaves, the organization may keep the final document while losing the
prompt, decision context, failure lessons, and evidence that made the work
effective. The next team then starts again.

We were also dissatisfied with a common shortcut: calling a vector database a
company memory while giving every agent the same broad service credential. A
useful enterprise memory must preserve *why* something worked, distinguish
current truth from history, and enforce who or what can retrieve, review,
promote, or change it.

## What it does

Organizational AI Memory captures reusable capability as typed, versioned
prompts, workflows, agent patterns, decision patterns, and best practices. Each
asset records its purpose, constraints, review state, intended consumers, why it
worked, relationships, and an inspectable
`asset -> observation -> source turn` path.

When a person starts a task, deterministic free-text search retrieves an
approved starting point from PostgreSQL before any model runs. In the canonical
website-delivery scenario, the system returns a prompt, workflow, and
source-first decision pattern. Codex Spark can adapt only those selected
public-safe records into a cited plan. It cannot choose different assets or
change authoritative memory, and the complete stored recommendation remains
available if generation fails.

The protected Architect Console demonstrates the governed path from quarantined
input to a reviewed promotion draft:

```text
quarantined text
-> sealed source bytes
-> service-produced candidate
-> independent human review
-> architect promotion
-> draft only
```

Canonical publication deliberately remains outside the MVP's autonomous write
path; public reuse operates only on already approved assets.

Architect and reviewer are logical application principals. They share a
hardened operator workload, but PostgreSQL binds each authenticated operation to
that human's root-provisioned secret context and department before FORCE RLS
permits data access. The MVP does not claim a Linux or PostgreSQL account per
human. Linked agents are different: each receives an independent policy
assignment, dedicated locked Linux user, sandboxed systemd unit, brokered
capability grant, and no direct PostgreSQL authority.

The public experience exposes inventory, task coverage, source evidence, and
clearly labeled authored duplication and capability-gap signals. It does not
invent outcome or ROI claims.

## How we built it

We extended an existing Node.js and PostgreSQL memory foundation instead of
rebuilding from zero. PostgreSQL 17 remains canonical for source turns,
observations, time-valid facts, capability assets, policy assignments,
quarantine records, reviews, promotion drafts, proofs, and audit events.
Deterministic lexical retrieval runs over fixed public views and stored task
mappings.

The runtime is divided into least-privileged workloads: a public service,
operator API, Unix-socket memory broker, root-owned allowlisted provisioner,
isolated Codex sidecar, and per-agent systemd services. Each application
database login has exactly one workload membership. PostgreSQL grants, FORCE
RLS, and security-barrier views protect the data plane; Linux ownership,
inaccessible paths, private workspaces, locked accounts, systemd sandboxing, and
broker credentials protect the runtime plane.

The four enforcement planes are:

1. **Application identity:** human, agent, and service principals.
2. **Policy:** department membership, immutable templates, sponsor ceilings,
   and explicit denials.
3. **Runtime identity:** dedicated agent UIDs, systemd units, private
   workspaces, and broker bindings.
4. **Data authority:** fixed public views, DB-bound operator context, and
   brokered capability grants.

PostgreSQL resolves the authenticated human and department inside every
protected transaction and applies FORCE RLS across identity, governance, proof,
and audit records. Caller-provided IDs cannot widen that scope. Scan findings
and candidate evidence are append-only, activated policy content is immutable,
and every proof run carries a department scope.

`gpt-5.3-codex-spark` runs under the isolated `oam-codex` account. It receives a
bounded projection of the already selected assets and must return a strict
structured plan. Every asset and source-turn citation is validated before the
result reaches the browser. The responsive interface uses semantic HTML, CSS,
and browser-native JavaScript behind nginx.

## Challenges we ran into

The hardest product challenge was keeping generated assistance useful without
letting it become the source of truth. We made deterministic selection
authoritative, validated every generated citation against the selected records,
and built an explicit fallback that never hides or replaces the stored result.

Search required equally careful negative behavior. Unrelated, underspecified,
and instruction-injection-shaped queries must return no match instead of a
plausible but unsupported capability. We added stable scoring, ambiguity
handling, Vietnamese and diacritic normalization, and regression cases for
false-positive queries.

The identity plane exposed a subtler problem: a shared operator database login
must not become shared human authority. We bound each authenticated application
human to an unguessable, root-provisioned database context and made PostgreSQL
RLS enforce the department boundary independently of request IDs. We also bound
capture review to sealed bytes and immutable evidence so an approved candidate
cannot be silently changed afterward.

Live infrastructure proof uncovered concrete edge cases, including inherited
systemd drop-ins that could weaken unit settings, an agent process that exited
after its first proof, idempotent PostgreSQL upgrade ordering, and an initially
over-restrictive sponsor-policy intersection. We fixed these issues and converted
them into regression coverage rather than hiding them in the demo.

## Accomplishments that we're proud of

- One public judge screen connects deterministic search, governed source
  records, cited adaptation, analytics, and live access evidence.
- The public capability pack contains 9 approved assets across 5 types, 5 task
  definitions, and 13 stored recommendation mappings, all connected to
  sanitized source turns.
- The deployed proof harness passes 22 explicit allow/deny controls defined in
  our release contract, covering application
  identity, policy, Linux runtime, PostgreSQL authority, brokered reuse,
  quarantine, independent review, draft-only promotion, and suspension
  revocation.
- The proof validates application and workload controls under trusted host-root
  and PostgreSQL-superuser administration; it does not claim resistance to those
  administrators.
- The public proof is build-bound: its source digest must match the root-owned
  digest of the deployed security/runtime source, while stale, unsafe,
  symlinked, or substituted proof files fail closed.
- The live Spark path returns structured plans from `gpt-5.3-codex-spark`, while
  the deterministic recommendation remains independently usable.
- Automated API/security, real PostgreSQL integration, and browser
  route/viewport suites cover the product and its allow/deny boundaries without
  relying on a slide-only demonstration.

## What we learned

Organizational memory is not just similarity search. It needs typed objects,
temporal truth, provenance, review state, explicit authority, and a reliable way
to say, "no supporting memory found."

Application RBAC alone is also not a sufficient agent boundary. For humans, the
application principal must survive into a database-validated,
transaction-local context on a shared workload; the product should not pretend
that the MVP creates a host and database account per employee. For a linked
agent, the Linux process, broker credential, policy assignment, and data path
must all refer to the same independent principal.

Finally, transparent limits made the product more credible. The interface
distinguishes stored facts from authored analytics signals, reports optional
semantic retrieval as unavailable, and labels generated plans as
non-authoritative.

## What's next for Organizational AI Memory

Next, we would replace the root-managed human credential map with enterprise
SSO/SCIM while preserving the DB-bound human and department context. We would
also add controlled ingestion connectors, recommendation acceptance and outcome
feedback, time-series capability-growth analytics, automated duplicate/gap
detection, broader version history, and a non-gating semantic retrieval lane.

The longer-term direction is a portable capability protocol with equivalent
runtime-identity adapters for container platforms: every authorized human or
agent can ask for relevant prior work, while the broker returns only approved
assets allowed by the principal's policy and, for linked agents, the sponsor's
ceiling.

## Built with

- Node.js 22 and browser-native JavaScript
- PostgreSQL 17, FORCE RLS, security-barrier views, and temporal facts
- Linux system users, groups, file ownership, and locked service accounts
- systemd sandboxing and Unix-domain sockets
- nginx
- OpenAI Codex CLI with `gpt-5.3-codex-spark`
- Playwright and system Chrome
- Google Stitch for bounded design exploration

## Optional Links

- [Live product](https://memory.sellsystems.agency/)
- [Single-screen judge demo](https://memory.sellsystems.agency/demo)
- [Architecture and authority method](https://memory.sellsystems.agency/method)
- [Public evidence inspector](https://memory.sellsystems.agency/evidence)
- [Sanitized 22-control proof](https://memory.sellsystems.agency/api/public/access-proof)

The source-repository URL and final video URL should be added only after the
operator publishes and verifies those artifacts.
