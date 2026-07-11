# Organizational AI Memory MVP Architecture

Status: deployed and verified on `2026-07-11`.

## Product boundary

Organizational AI Memory turns reviewed work history into two reusable forms:

1. time-aware facts, observations, summaries, and reflections
2. typed prompts, workflows, agent patterns, decision patterns, and best
   practices

A task retrieves stored capability records before any model is invoked.
PostgreSQL is canonical; generated plans are optional and non-authoritative.

## Deployed topology

```text
public browser
    |
operator-managed TLS and domain boundary
    |
nginx :80
    |
    +-- /, /demo, /assets, /method, /evidence
    |      -> public service 127.0.0.1:3000, oam-public
    |      -> oam_public_api -> oam_public_runtime -> fixed oam_public views
    |
    +-- /architect/
           -> operator service 127.0.0.1:3010, oam-operator
           -> authenticated app human + root-provisioned context hash
           -> shared oam_operator_api -> oam_operator_runtime -> FORCE RLS

operator service -> root-owned provisioner Unix socket
                 -> explicit plan + revision confirmation
                 -> allowlisted Linux/systemd/quarantine operations

linked agent UID -> agent service -> broker Unix socket
                                  -> broker service, oam-broker
                                  -> oam_broker_api -> oam_broker_runtime + FORCE RLS

public service -> Codex Unix socket -> oam-codex sidecar
                                      -> gpt-5.3-codex-spark

all canonical records -> PostgreSQL 17
```

The public, operator, and broker services use distinct non-login Linux
identities and distinct PostgreSQL logins. Each database login has exactly one
runtime-role membership and is rejected at startup if it is superuser,
`BYPASSRLS`, missing its required membership, or has a cross-workload
membership.

The provisioner runs as root because it creates Linux users, changes ownership,
seals quarantine files, and starts units. It accepts a small exact JSON contract
over a protected Unix socket, derives identifiers from principal keys, uses
fixed binary paths and argument arrays, serializes operations, and requires an
operator-created plan plus exact revision confirmation.

These controls constrain application and workload paths. Host root and the
PostgreSQL superuser remain trusted administrative boundaries and are not
subjects the 22-control proof claims to defeat.

## Four-plane identity model

Every effective decision aligns four independent planes:

| Plane | Canonical record | Enforcement point |
| --- | --- | --- |
| Application identity | human, agent, or service principal | authenticated operator session or broker credential |
| Policy | department membership, immutable template assignment, explicit denial | effective-permission evaluator and broker authorization query |
| Runtime identity | Linux UID, systemd unit, private workspace, broker binding | kernel ownership and systemd sandbox |
| Data authority | public view, DB-bound operator context, or brokered capability grant | PostgreSQL grants, FORCE RLS, and security-barrier views |

Humans are logical application principals. The architect and reviewer do not
receive per-human Linux accounts or PostgreSQL logins. Both use the shared,
least-privileged `oam-operator` Linux workload and `oam_operator_api` database
login. Their root-provisioned application secrets map to one active human and
one department in PostgreSQL. Each authenticated service operation establishes
that mapping as a transaction-local database context through a SECURITY DEFINER
function; FORCE RLS then applies it to identity, policy, provisioning,
quarantine, governance, proof, and audit records. A caller-supplied UUID or
custom GUC value is not sufficient authority.

A linked agent is independent from its human sponsor: it needs its own active
membership, policy assignment, broker binding, and capability grant. Its
permission set is intersected with the sponsor's ceiling and always explicitly
denies `memory.canonical.write`.

Provisioned agents run as locked system users named from a bounded runtime key.
Their systemd units expose only a private workspace and broker socket. Project
source, installed application source, platform environment, Codex credentials,
and direct PostgreSQL access are denied.

## Canonical memory

The continuity path stores ordered source turns, observations, atomic facts
with validity intervals, summaries, and reflections. Superseded facts remain
auditable.

```text
fact -> observation -> source turn
```

The capability path stores a pinned public-safe pack, exact typed/versioned
asset bodies, task definitions, deterministic mappings, lifecycle metadata,
analytics signals, and evidence edges.

```text
free-text task -> deterministic task mapping -> ranked assets
asset -> observation -> source turn
```

The capture path is deliberately separate from canonical memory:

```text
bounded text upload
-> root-owned read-only quarantine seal
-> service-produced candidate
-> independent human review
-> architect promotion
-> draft only
```

No public, agent, reviewer, architect, operator service, or provisioner path in
this MVP writes a promoted candidate directly into `memory.capability_assets`.

Capture decisions are bound to bytes, not caller assertions. The operator
service reopens the sealed regular file without following symlinks, verifies
root ownership, mode, link count, size, and SHA-256, and derives candidate
evidence from those bytes. Review and promotion bind the source upload hash,
current candidate content hash, reviewer-observed hash, and approved content
hash. The newest scan result must be clean and current; a later adverse rescan
revokes approval eligibility. Scan findings and candidate evidence are
append-only at both the privilege and trigger layers: operator UPDATE is revoked,
and UPDATE or DELETE is rejected by PostgreSQL.

## Ordered identity migrations

The current identity plane is an ordered, idempotent v1-v7 chain:

1. **v1:** principals, department policy, runtime bindings, broker grants,
   quarantine, independent review, draft promotion, audit, RLS, and public
   projections
2. **v2:** exact `approved` plus explicit public-eligibility gating
3. **v3:** sealed upload provenance and candidate/review content-hash integrity
4. **v4:** department-bound provisioning jobs, activation leases, and
   fail-closed host suspension after uncertain execution
5. **v5:** department-scoped operator security events and audit reads
6. **v6:** activated-policy immutability, append-only scan/candidate evidence,
   and non-null department scope on proof runs
7. **v7:** root-provisioned operator context mappings, transaction-bound human
   and department resolution, and FORCE RLS across operator-visible identity,
   quarantine, governance, proof, and audit tables

## Public task flow

1. The browser submits exactly one bounded free-text query.
2. The server applies its fixed public pack and review-state scope.
3. Deterministic lexical search returns a stable task or asset resolution, an
   ambiguity result, or an explicit no-match.
4. A resolved task hydrates stored ranked assets and their provenance.
5. Optional Spark generation receives only the selected public-safe projection.
6. The returned structured plan is accepted only if every asset and source-turn
   citation belongs to that projection.

The canonical `website_delivery_handoff` task selects:

```text
prompt:website_handoff_brief_v1
workflow:portfolio_site_delivery_v1
decision:source_first_before_generation_v1
```

Search normalization covers punctuation, diacritics, aliases, and bounded
Vietnamese phrases. Unrelated, underspecified, stop-word-only, and
instruction-injection-shaped queries do not fall through to unrelated facts or
assets.

## Spark boundary

The `oam-codex` sidecar has a private home and Codex state but no database
credential, application environment, or repository access. It runs one
generation at a time with a global attempt budget, a fixed model, disabled
interactive approval, a read-only empty workspace, and a strict structured
output schema.

The validator requires bounded summary, steps, missing context, limitations,
and citations. Unsupported, omitted, cross-step, duplicate, or citation-shaped
identifiers hidden in prose cause deterministic fallback. A model, socket,
authentication, deadline, or schema failure returns HTTP `200` with the complete
stored recommendation and an explicit fallback state. Readiness does not depend
on model availability.

## Public safety

Public clients cannot choose a tenant, brand, thread, corpus, capability pack,
publication status, or visibility. Public reads use fixed security-barrier
views. The internal regression corpus has no public route. Raw policy tables,
canonical memory tables, operator APIs, credentials, and provisioner sockets are
not exposed by nginx.

The public access-proof endpoint reads only a root-published, schema-validated,
sanitized projection. The installer records a root-owned SHA-256 over every
deployed security and runtime source. The loader accepts a proof only when its
`source_sha256` matches that expected digest, the expected/projection paths
are securely owned and not symlinks, and the proof is no more than 24 hours
old. The current projection reports 22 required controls and contains no
principal IDs, OS usernames, paths, credentials, PostgreSQL names, cookies, or
free-form internal errors.

## Analytics contract

The live UI derives inventory and coverage from current canonical rows. It
shows reuse, evidence, and task coverage plus stored duplication and gap
signals. The seed contains 9 assets across 5 types, 5 tasks, 13 mappings, and
all 9 assets are approved for the explicit public-safe projection.

Recommendation outcome measurement, historical growth series, and continuous
automated duplicate/gap inference are not yet implemented and are not claimed.

## Verified failure properties

- Canonical PostgreSQL availability gates readiness; Spark does not.
- Generated output cannot replace, reorder, approve, or persist selected assets.
- An agent without its own assignment, sponsor allow, broker binding, active
  grant, or credential fails closed.
- An operator query without a valid DB-bound human/department context has no
  cross-department authority; caller-selected IDs or an arbitrary custom GUC do
  not substitute for the root-provisioned mapping.
- Direct canonical reads and writes are denied to public and broker logins.
- Activated policy content and captured scan/evidence history cannot be edited
  in place by the operator workload.
- Quarantine remains absent from public search before review and after
  draft-only promotion.
- Suspension locks the account, stops the unit, removes credentials and broker
  group membership, closes policy records, and makes the captured broker token
  fail authentication.
