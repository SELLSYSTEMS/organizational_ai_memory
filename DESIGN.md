# Organizational AI Memory Design Contract

## Product contract

Organizational AI Memory turns proven prompts, workflows, agent patterns,
decisions, and practices into governed organizational capability. A known task
retrieves reusable prior work and keeps its evidence visible through optional
adaptation.

The product is a provenance-first capability and continuity layer, not a
chatbot. Deterministic stored records are authoritative. Generated prose is
visually separate, optional, and non-authoritative.

Primary audiences:

1. hackathon judges
2. technical reviewers
3. enterprise buyers evaluating the method

Primary action: `Start with prior work`

Public routes:

- `/` - capability promise plus a live deterministic recommendation
- `/assets` - filter and inspect governed capability assets
- `/demo` - retrieve a task starting point, optionally adapt it, and query
  continuity evidence
- `/method` - inspect formation, governance, recommendation, and safety
- `/evidence` - inspect continuity memory objects and provenance

The internal evaluation path is absent from public navigation and must not be
proxied by nginx.

## Public copy lock

Product name and only H1 on the home route:

`Organizational AI Memory`

Home supporting copy:

`A provenance-first capability layer that turns proven prompts, workflows,
agent patterns, decisions, and practices into governed organizational memory.
Start a task, get reusable prior work, and inspect the evidence behind it.`

Navigation:

- `Home`
- `Assets`
- `Demo`
- `Method`
- `Evidence`

Primary labels:

- `Start with prior work`
- `Browse capability assets`
- `Reusable capability assets`
- `Task-start recommendation`
- `Deterministic record`
- `Adapt the stored starting point`
- `Spark-generated adaptation`
- `Query the evidence engine`

Do not use:

- chat-with-your-data or second-brain language
- claims that generated output selected, changed, or approved an asset
- invented enterprise claims, metrics, customers, risk notes, or testimonials
- claims that Spark or semantic retrieval is available when its runtime is not
- pack-wide `public_safe` as a replacement for an asset's governance visibility

## Information architecture

### Home

1. Product name, capability promise, and two actions
2. Live deterministic task-start recommendation
3. Five typed capability categories
4. Current-versus-superseded continuity timeline
5. Public and internal corpus boundary
6. Closing task-start action

### Assets

1. `Reusable capability assets`
2. Compact, live-derived type and lifecycle counts
3. One repeated-pattern signal and the supplied capability gaps
4. Type, capability-area, and review-status filters
5. Desktop ledger that becomes labeled asset records on mobile
6. Selected asset inspector with operational value and governance
7. Lineage, usage references, related assets, and
   `asset -> observation -> source turn`

The inspector must distinguish missing values from empty assertions. An absent
`risk_note` is hidden. External lineage and usage keys remain visible without a
fabricated asset detail record.

### Demo

1. `Start a task from proven capability memory`
2. Always-visible `Public demo only` scope
3. `website_delivery_handoff` as the canonical default among five stored tasks
4. Retrieved assets and deterministic recommendation reason
5. Optional adaptation request, clearly below the stored record
6. Generated or fallback state that never displaces the recommendation
7. Existing deterministic evidence query and fact provenance

### Method

Use one ordered sequence with an equivalent text representation:

```text
source evidence
-> memory formation
-> canonical store
-> capability asset
-> deterministic recommendation
-> bounded optional adaptation
```

Postgres is canonical. Vector retrieval and model prose are optional derived
lanes only.

### Evidence

1. Runtime-derived continuity corpus inventory
2. Filters for thread, turns, observations, facts, summary, and reflection
3. Facts ledger by default
4. Selected-object provenance detail
5. Real supersession history

The capability catalog owns asset inspection; `/evidence` retains the focused
continuity-memory inspector.

## Authority hierarchy

Every interaction must make this order legible:

1. stored task and task-to-asset mapping
2. governed capability asset
3. observation and source turn
4. optional generated adaptation

Use `Deterministic record` for stored selections and `Spark-generated
adaptation` plus `Non-authoritative` for generated output. The fallback message
is `Deterministic records loaded; adaptation unavailable.`

## Visual system

Direction: architecture brief plus capability ledger.

- Canvas: near-white `#f4f4f0`
- Surface: white `#ffffff`
- Ink: `#171a18`
- Muted ink: `#646a66`
- Rules: `#d8dcd7`
- Current/workflow/approved: teal `#066a59`
- Observation/decision/reviewed: amber `#854d00`
- Summary/prompt: blue `#315f9a`
- Reflection/agent/generated: plum `#70466e`
- Superseded/best-practice: red `#a5413b`

Use text labels with every semantic color. Do not use gradients. Use open page
bands, ledgers, tables, and one inspector; cards are reserved for repeated
records and never nest. Maximum radius is 8px.

Typography:

- UI and prose: system sans
- IDs, versions, timestamps, and source paths: system monospace
- fixed type steps; no viewport-scaled font sizes
- letter spacing: `0`

## Responsive and accessibility contract

- max content width: 1180px
- verify at 390px, 768px, 1280px, and native desktop
- no horizontal document scroll
- 44px minimum interactive targets
- visible keyboard focus
- skip link and logical headings
- one H1 per route
- real labels for fields and filters
- `aria-live` status for recommendation, assist, query, and filter states
- keyboard-operable asset rows, disclosures, tabs, and filters
- reduced-motion support
- semantic colors never carry meaning alone
- fixed result reserves where automatic hydration would otherwise cause layout
  shift

## Runtime truth contract

- Public APIs never accept tenant, brand, corpus, pack, visibility, or thread
  selectors.
- The server pins both the continuity corpus and capability pack, then verifies
  database classification before returning data.
- The capability inventory is exactly 9 assets, 5 tasks, and 13 mappings for
  this seed.
- Asset provenance is `asset -> observation -> source turn`; fact provenance is
  `fact -> observation -> source turn`.
- Recommendation selection is deterministic and authoritative.
- `POST /api/public/capability-assist` accepts exactly `{task_key, request}`.
- Spark receives only a bounded projection of already selected public-safe
  assets. It cannot select assets, write memory, access Postgres, read the
  application environment, or inspect the repository.
- The isolated `oam-codex` sidecar pins `gpt-5.3-codex-spark`, validates strict
  output, allows one generation, and terminates work after 7 seconds.
- The public generation limit is 6 requests per IP per minute.
- The sidecar also enforces a global budget of 12 generation attempts per
  minute, including direct local socket traffic.
- Any Spark failure returns HTTP `200` with the deterministic selection and a
  fallback interaction. Application readiness does not depend on Spark.
- The isolated Codex account is not authenticated yet; the current truthful UI
  state is the fallback.
- Empty retrieval or missing metadata produces an honest empty state.
- Semantic retrieval failure is a degraded optional lane; exact Postgres
  retrieval remains available.

## Source fidelity contract

- The JSON pack is sanitized and classified `public_safe`; asset governance
  visibility remains the source value `internal`.
- Seven assets are approved and two are reviewed.
- No asset supplies `risk_note`; no risk note may be inferred.
- External prior-version and usage references remain plain referenced keys, not
  fabricated local records.
- The supplied analytics timestamp predates the last source turn by 8 minutes.
  Retain it as source metadata and derive inventory counts live.
- The supplied version-timeline gap text says one asset has a prior version,
  while two rows contain external `supersedes` keys. Preserve the authored
  signal but do not present it as a live count.
- Handoff Markdown is operator context and must never be ingested or served.
