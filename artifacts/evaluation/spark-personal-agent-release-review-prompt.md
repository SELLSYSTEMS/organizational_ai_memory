# Independent release review request

Review-stage snapshot: this prompt records the initial `255/255` test state
supplied to Spark before the resulting accessibility correction and later
physical-agent network-boundary regression coverage. The adjudicated release
report records the final `275/275` result; this file is provenance for the
earlier review input, not the current acceptance record.

Review this sanitized Organizational AI Memory release candidate as a strict
security, product, frontend, and hackathon judge reviewer. Do not edit files.

Primary product contract:

- One human employee is linked to exactly one distinct Personal Memory Agent.
- The employee profile and personal memories are private by default and
  append-only/versioned.
- Profile or memory edits reset agent access.
- Explicit revision-bound share/unshare actions control only the linked agent's
  access to the current version.
- Restricted memory can never be shared.
- A physical agent receives a dedicated locked Linux UID, private state,
  systemd unit, broker credential, and no PostgreSQL login.
- Physical activation occurs only after the root allowlisted provisioner and
  proof succeed.
- PostgreSQL FORCE RLS and narrow security-definer functions remain the data
  authority.
- The employee web search is deliberately labeled as an agent-visibility
  preview because the physical agent runtime currently proves broker retrieval
  but does not provide an interactive task channel.
- Public organizational capability search and the Spark adaptation path remain
  separate from private personal memory.

Current independently executed verification on the source tree:

- API/security tests: 255/255 passed.
- Real PostgreSQL employee lifecycle: passed, including one-to-one enforcement,
  profile and memory consent, edit-reset, typed citations, cross-employee
  denial, wrong-agent denial, append-only history, and suspension revocation.
- Real PostgreSQL operator provisioning: passed for a personal agent with both
  grants active and a generic agent remaining website-only.
- V8 migration fresh apply and repeat apply: passed.

Inspect every supplied file. Prioritize blockers, security/authorization bugs,
false or misleading product claims, broken UI/API contracts, incomplete
interactions, responsive/accessibility risks, and missing tests. Verify that
the employee experience contains no fake or dead controls. Distinguish actual
release blockers from reasonable disclosed MVP gaps. Return:

1. Findings ordered by severity with file and line references.
2. A concise judge assessment against P5 Organizational AI Memory, with P4
   Human-AgentOS treated only as supporting enforcement.
3. A ship/no-ship decision.

Do not infer that test counts prove behavior not visible in supplied code. Do
not expose or request credentials. Do not recommend weakening Linux, systemd,
broker, or PostgreSQL isolation merely to simplify the interface.
