# Organizational AI Memory Demo Script

Target length: 2 minutes.

## 1. Establish the product

Open `https://memory.sellsystems.agency/`.

Say:

> Organizational AI Memory turns proven prompts, workflows, agent patterns,
> decisions, and practices into governed capability memory. A task starts with
> stored prior work, and every asset retains its evidence.

Point to the live task-start record. Explain that this selection is read from
Postgres, not generated.

## 2. Inspect a capability asset

Open `/assets`.

Show the compact inventory: 9 assets across 5 types. Filter by `workflow`, then
select an asset and show:

1. review status and version
2. owner and consumer roles
3. problem solved and why it worked
4. lineage and related assets
5. `asset -> observation -> source turn`

Say:

> The source pack is public-safe, while the asset's visibility field preserves
> the simulated organization's internal governance state. Those are separate
> controls.

Point out that 7 assets are approved and 2 remain reviewed. A missing risk note
is omitted rather than invented.

## 3. Start a task deterministically

Open `/demo`. `Prepare a new website delivery handoff` is the canonical default;
retrieve it again to make the stored selection action explicit.

Show the stored recommendation:

```text
prompt:website_handoff_brief_v1
workflow:portfolio_site_delivery_v1
decision:source_first_before_generation_v1
```

Say:

> Five stored tasks provide thirteen ranked task-to-asset mappings. This
> deterministic record remains authoritative through the whole interaction.

## 4. Show the bounded Spark interaction

Enter:

```text
Adapt this starting point for a small agency team preparing a client handoff.
```

Select `Generate adaptation`.

Current expected result: concise prose labeled
`Non-authoritative - gpt-5.3-codex-spark` below the unchanged deterministic
record.

Say:

> The isolated Codex account is authenticated, but the model receives only the
> selected public-safe record. It cannot choose new assets, write memory, or
> access the database, application environment, or repository. If generation
> fails, the API returns HTTP 200 with the full deterministic recommendation.

## 5. Prove temporal truth

On the lower part of `/demo`, query:

```text
What is the current budget and deadline, and what changed?
```

Show:

1. current budget: `4500 USD per month`
2. previous budget: `3000 USD per month`, marked superseded
3. current deadline: `August 29, 2026`
4. previous deadline: `August 15, 2026`, marked superseded

Open one provenance disclosure and follow:

```text
fact -> observation -> source turn
```

Say:

> Postgres retrieval is deterministic. Semantic retrieval is optional and
> currently unavailable, so the product states that directly.

## 6. Close on authority and safety

Open `/method`, then `/evidence` if time permits.

Point to the fixed `public_demo + public_safe` boundary and explain that the
browser cannot select a tenant, pack, or thread. The internal regression corpus
has no public route.

Close with:

> This MVP proves one controlled reuse loop: evidence becomes governed
> capability, a task retrieves prior work deterministically, optional prose can
> adapt it, and the stored source record remains authoritative.
