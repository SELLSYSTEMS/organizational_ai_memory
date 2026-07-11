# Evidence-Driven Development

This document defines the public-safe development discipline for Organizational
AI Memory. It is a process contract, not product evidence and not a replacement
for current runtime verification.

## Normative authority

For what the system is required to do, use this order:

1. checked-in security, schema, and API contracts
2. approved governance and migration decisions
3. reviewed task-specific acceptance criteria

## Observed truth

For claims about what is actually deployed or working now, use this order:

1. fresh enforcement-point and runtime evidence
2. current canonical database state and protected configuration
3. installed source digest and deployed service state
4. reviewed release artifacts bound to a commit and source digest
5. checked-in intent, historical notes, and retrieved experience

Generated prose and semantic retrieval never establish canonical truth.

## Task bootstrap

Every substantial change should define:

1. the exact outcome
2. the files, services, and data surfaces in scope
3. the surfaces that must not change
4. the current facts and relevant prior lessons
5. executable acceptance gates
6. the required evidence and stop condition

Use the issue forms in `.github/ISSUE_TEMPLATE/` for this bootstrap. Keep active
task state compact; do not inject raw archives into the working context.

## Memory contract

Durable organizational memory should be typed and carry:

- scope and owner
- source references and evidence hashes
- version and review state
- visibility and authorization state
- `valid_from`, optional `valid_to`, and supersession lineage
- last validation time

The safe formation path is:

```text
source evidence
-> sanitized candidate
-> independent review
-> canonical versioned object
-> scoped retrieval derivative
-> cited reuse
```

Edits create new versions. Contradictions create explicit updates or
supersessions; they do not silently overwrite history.

## Implementation loop

1. Inspect current repository, runtime, and data truth.
2. Decide the smallest coherent change and ownership boundary.
3. Implement without mixing public-safe and internal-only material.
4. Run deterministic tests before optional generated evaluation.
5. Verify the real API, browser, database, or host boundary affected.
6. Package sanitized evidence with timestamps, hashes, and source binding.
7. Write back only confirmed, reusable lessons.

Parallel work is appropriate for independent reading, diagnostics, and artifact
review. Schema changes, shared configuration, and stateful live captures require
one write owner at a time.

## Ship gates

A change is not complete merely because files or routes exist. Apply the gates
that match its risk:

- behavior and regression tests
- negative-query and deterministic-fallback tests
- provenance, citation, and temporal-correctness checks
- permission denial, revocation, and cross-scope isolation checks
- migration verification on a disposable database
- browser interaction and responsive-layout checks
- public-safety and secret scans
- proof freshness, source-digest, and media-manifest verification
- documentation review for current versus historical claims

Recurring failures should become executable checks rather than longer prose
warnings.

## Public boundary

Do not commit raw archives, credentials, cookies, private topology,
internal-only endpoints, credential-bearing URLs, authenticated deep links,
internal handoffs, customer material, or another environment's claims. Public
route names may be documented without credentials. Public evidence must be
sanitized, reviewed, and independently traceable to real source artifacts.

The repository's current release procedure is documented in
[`docs/submission/PUBLISHING.md`](../submission/PUBLISHING.md).
