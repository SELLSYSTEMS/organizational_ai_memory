# Design Review

## Accepted direction

The production direction remains `architecture brief + case-study ledger`, now
extended into a governed capability ledger.

Image-generation and Stitch exploration informed the continuity phase. Raw
exploration exports remain local and are not release evidence; the implemented
live surfaces and curated submission captures are authoritative.

The additive capability phase extends the established information system rather
than introducing a separate visual concept. It must preserve:

1. near-white canvas and graphite rules
2. semantic color attached to text labels
3. open ledgers instead of a card-heavy dashboard
4. deterministic records visually above generated prose
5. `asset -> observation -> source turn` and
   `fact -> observation -> source turn` paths
6. desktop tables that become labeled records on mobile

## Additive capability review

Accepted product additions:

- `/assets` as a first-class route
- one compact inventory strip for 9 assets across 5 types
- filters for type, capability area, and review status
- a ledger plus side inspector for governance, lineage, use, and evidence
- five task-start choices backed by thirteen stored mappings
- `website_delivery_handoff` as the canonical Home, Capabilities, and Method path
- review state, why-it-worked context, and evidence access on every recommended
  asset row
- an optional Spark adaptation area below the deterministic recommendation
- a clear fallback that leaves the stored result intact
- Architect Console copy that distinguishes logical human principals from
  dedicated agent runtimes and does not imply per-human Linux or PostgreSQL
  accounts

The visual authority hierarchy is:

```text
deterministic task mapping
-> governed asset
-> observation and source turn
-> optional non-authoritative prose
```

`Deterministic record` uses the current/teal treatment. `Spark-generated
adaptation` uses the reflection/plum treatment and is also labeled
`Non-authoritative` when generation succeeds. Color is supplementary; the text
labels carry the meaning.

## Source-fidelity review

The implementation must show the governed public-safe pack as imported:

1. 9 assets, 5 tasks, and 13 task-to-asset mappings
2. all 9 assets approved, with public views requiring exact `approved` state
   plus explicit public-eligibility metadata
3. no invented `risk_note` where the source provides none
4. source-pack `public_safe` classification kept distinct from asset governance
   visibility `internal`
5. external lineage or usage keys preserved without invented asset records
6. the supplied `04:00` analytics timestamp retained even though source turns
   continue through `04:08`; live inventory counts come from asset rows
7. the authored version-timeline signal preserved as prose even though two,
   not one, asset rows carry external `supersedes` keys
8. handoff Markdown excluded from ingestion and public output

These are data-quality qualifications, not copy opportunities. The interface
must not blur approval state, convert external references into local records,
or imply that a missing risk note means no risk.

## Spark boundary review

The generation treatment is accepted only with all of these constraints:

1. deterministic recommendation is rendered before generation is available
2. public body contract is exactly `{task_key, request}`
3. only the selected public-safe projection reaches the sidecar
4. `gpt-5.3-codex-spark` cannot choose assets or write memory
5. the sidecar runs as isolated `oam-codex` through a Unix socket with no
   database, application environment, or repository access
6. strict output, one active generation, 7-second deadline, and 6/IP/minute
   public limit are enforced
7. failure renders `Deterministic records loaded; adaptation unavailable.`
   from an HTTP `200` response
8. `/api/readyz` does not depend on optional generation

The `oam-codex` account is authenticated and a live public generated response
has been verified. Generated prose remains visually subordinate and
non-authoritative; the deterministic fallback remains the required failure
state.

## Stitch bounded-wave review

Stitch project: `4952579052773947057`

Generated candidates:

- `stitch/home-demo.png`
- `stitch/method.png`
- `stitch/evidence.png`

Verdict: reject as direct implementation sources.

Reasons:

1. The home candidate is too compressed and underweights provenance.
2. The method candidate invents a confidence chart, operational ledger, and
   unverified system claims.
3. The evidence candidate invents a separate `ARCH-IV` brand, access portal,
   and unrelated sample records.
4. All three drift from the fixed public-safe corpora and route contract.

Reusable Stitch observations remain limited to compact ledger density, mono
source references, and restrained dividers. No invented content or branding is
reused.

## Above-the-fold copy lock

Home:

- `Organizational AI Memory`
- `Home`
- `Assets`
- `Capabilities`
- `Method`
- `Evidence`
- `Start with prior work`
- `Browse capability assets`
- `Start with proven prior work`
- `Deterministic record`

Capabilities:

- `Start a task from proven capability memory`
- `Reviewed organizational capability`
- `Task-start recommendation`
- `Adapt the stored starting point`
- `Spark-generated adaptation`

No extra badge, metric, customer claim, or semantic-availability claim is
permitted in the first viewport.

## Fidelity ledger

| Check | Required evidence | Resolution |
| --- | --- | --- |
| Product hierarchy | Capability promise, six public navigation actions, stored task action | Accepted contract |
| Asset catalog | Filterable 9-record ledger plus inspector | Accepted contract |
| Governance truth | Review, version, owner, roles, visibility, missing-data handling | Accepted contract |
| Identity truth | Human is an app principal with DB-bound department context; only linked agents receive dedicated Linux runtime identity | Accepted contract |
| Recommendation authority | Stored task and assets remain above adaptation | Accepted contract |
| Spark separation | Generated label, non-authoritative state, deterministic fallback | Accepted contract |
| Capability provenance | Exact asset to observation to source-turn path | Accepted contract |
| Temporal truth | Current and superseded facts remain available | Preserved from continuity phase |
| Responsive behavior | Table-to-record conversion, no horizontal page overflow | Passed at 390/560/680/768/1080/1280/1440 |
| Accessibility | Keyboard filters/rows/disclosures, focus, labels, live status | Browser interaction checks passed |
| Runtime copy | Live generation state matches isolated authentication | Live generated path verified; deterministic fallback contract-tested |

Raw browser screenshots outside the curated set remain local and ignored. Eight
curated public-safe captures and the 35-check machine-readable QA report are
published. The final browser suite exercises 35
route, viewport, interaction, fallback, and provenance checks against the live
HTTPS origin. The mobile interaction retains three stored recommendation rows
through a non-authoritative generated adaptation and returns four grounded fact
rows from the evidence query.
