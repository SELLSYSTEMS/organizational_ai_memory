# Security Policy

## Supported code

Security fixes target the current `main` branch. Dated proof bundles and media
in the repository describe a specific verified release; they are evidence, not
a promise that an older deployment remains supported indefinitely.

## Report a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private
[security advisory form](https://github.com/SELLSYSTEMS/organizational_ai_memory/security/advisories/new).

Include:

- the affected route, component, or trust boundary
- reproduction steps using synthetic data
- observed and expected authorization behavior
- likely impact
- any safe supporting logs or screenshots

Do not include live credentials, cookies, workspace links, private topology, or
customer data. We will acknowledge the report through the advisory and use that
private thread for remediation and disclosure coordination.

## Security boundaries

High-risk changes include:

- authentication, session, workspace-token, or operator-context handling
- PostgreSQL roles, grants, FORCE RLS, and migrations
- agent provisioning, systemd sandboxing, broker credentials, or revocation
- public corpus eligibility, provenance, citations, or proof loading
- Codex sidecar input, output validation, model access, or fallback behavior
- release sanitization and public artifact generation

These changes require focused regression tests and verification at the real
enforcement point. A generated answer, architecture diagram, or successful UI
render is not sufficient security evidence.
