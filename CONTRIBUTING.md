# Contributing

Organizational AI Memory is a provenance-first capability system. Contributions
must preserve deterministic truth, explicit governance, and the separation
between public-safe evidence and internal operational state.

## Before starting

1. Read `README.md`, `docs/KNOWN_GAPS.md`, and the architecture document relevant
   to the change.
2. Open or select a bounded issue. State the outcome, scope, exclusions,
   acceptance gates, and evidence required.
3. Use a focused branch. Do not combine unrelated refactors with product or
   security changes.
4. Verify the current runtime or data contract before changing it.

The development model is described in
[`docs/development/EVIDENCE_DRIVEN_DEVELOPMENT.md`](docs/development/EVIDENCE_DRIVEN_DEVELOPMENT.md).

## Local setup

Requirements:

- Node.js 22 or later
- npm with lockfile support
- FFmpeg with `ffmpeg` and `ffprobe` on `PATH`
- PostgreSQL only for disposable integration-test databases

Install and run the deterministic API/security suite:

```bash
npm ci
npm run app:test
```

Verify checked-in release evidence and public repository safety:

```bash
node scripts/evaluation/verify_release_package.mjs
```

The real PostgreSQL integration suite persists fixtures. Never point it at the
live database. Follow the disposable-database commands in the operator runbook.

## Change rules

- Keep Postgres authoritative. Retrieval indexes and generated text are derived
  lanes.
- Preserve scope, provenance, version, review, and supersession semantics.
- Keep deterministic recommendation and fallback behavior usable without a
  model.
- Use parameterized queries, least-privilege roles, and FORCE RLS where the
  existing data plane requires them.
- Add migrations rather than mutating released schema history.
- Do not broaden public selectors for tenant, corpus, visibility, or identity.
- Do not claim a feature is live until its runtime surface has been verified.

## Public-safety rules

Never commit credentials, cookies, authentication exports, private keys,
internal-only topology or endpoints, credential-bearing URLs, authenticated
deep links, raw internal handoffs, customer data, or another host's runtime
inventory. Public route names may be documented without their credentials. Use
synthetic data in tests, screenshots, and videos. Investigate every
repository-safety scan result before merging.

Security vulnerabilities should be reported through the private process in
`SECURITY.md`, not a public issue.

## Pull requests

A pull request should explain:

- what changed and why
- the authoritative contract affected
- migration and compatibility impact
- public-safety classification
- tests and real verification performed
- known limits or follow-up work

Attach screenshots only for changed user-facing behavior. Never attach raw
credentials, private links, or internal browser state.
