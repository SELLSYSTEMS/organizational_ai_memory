# Organizational AI Memory Demo Script

Target length: 2 minutes.

## 1. Establish the product (`0:00-0:15`)

Open `https://memory.sellsystems.agency/demo`.

Say:

> Organizational AI Memory turns proven prompts, workflows, decisions, and
> agent practices into searchable organizational capability. This one screen
> shows the full loop: capture, review, reuse, adaptation, analytics, and
> enforcement evidence.

Point to the lifecycle strip. Explain that the displayed source pack is
synthetic and public-safe.

## 2. Retrieve prior work (`0:15-0:38`)

Keep the default query:

```text
Prepare a website delivery handoff
```

Select **Search**. Show the three stored results:

```text
prompt:website_handoff_brief_v1
workflow:portfolio_site_delivery_v1
decision:source_first_before_generation_v1
```

Say:

> Deterministic free-text search resolved a stored task mapping in PostgreSQL.
> The result includes type, version, review state, why it worked, and source
> evidence before a model is asked to generate anything.

Briefly choose the Prompt filter, then clear it. If time allows, enter
`quantum payroll orchard` and show the explicit no-match before restoring the
canonical query.

## 3. Adapt without changing authority (`0:38-0:58`)

Use:

```text
Adapt this grounded starting point for a small delivery team.
```

Select **Adapt plan**. Point to the `AI-assisted` label, plan steps, and source
citations.

Say:

> Codex Spark receives only the already selected public-safe records. Every
> asset and source-turn citation is validated. The generated plan is
> non-authoritative; the stored result above remains unchanged. A model or
> schema failure returns the deterministic fallback instead of an ungrounded
> answer.

## 4. Show analytics and proof (`0:58-1:20`)

Point to the right rail:

- reuse coverage
- evidence coverage
- task coverage
- current capability gaps
- `Four-plane proof passed - PASS 22/22`
- the live allow/deny boundary result

Say:

> The counts come from current PostgreSQL records and do not claim measured
> business outcomes. The access result is a sanitized projection of 22 executed
> controls across application identity, policy, Linux runtime, PostgreSQL data
> authority, governance, broker access, and suspension.

Select the rerun icon to refresh the public boundary check.

## 5. Inspect provenance (`1:20-1:35`)

Open **Website design-to-build handoff brief**. Show:

1. exact typed content and version
2. review state and intended consumers
3. problem solved and why it worked
4. `asset -> observation -> source turn`

Say:

> We preserve the context that made a capability reusable, not just its final
> text. Missing metadata is omitted rather than invented.

## 6. Prove physical agent boundaries (`1:35-1:55`)

Use the prepared authenticated Architect Console screenshot, or open
`/architect/` only when a private operator token is available. Never expose the
token on screen.

Show **Effective access** for **AI Architect** and point to 12 allowed actions
plus the explicit `memory.canonical.write` denial. Then show the four-plane
overview.

Say:

> Humans are logical principals. A linked agent gets its own policy assignment,
> locked Linux UID, sandboxed systemd service, broker credential, and bounded
> data grant. It cannot read the project, installed app, environment, model
> authentication, or PostgreSQL directly. Suspension revokes the runtime and
> captured credential.

## 7. Close (`1:55-2:00`)

Say:

> Individual AI learning becomes permanent organizational capability, while
> provenance and real enforcement keep reuse governed.

## Recovery lines

- If Spark is unavailable: "The fallback is intentional; the same stored
  selection remains authoritative and complete."
- If the console is not available: use
  `artifacts/submission/screenshots/08-architect-effective-access-1440.png` and
  the public 22/22 proof rail.
- Never log in, paste credentials, or show internal paths during a public
  recording.
