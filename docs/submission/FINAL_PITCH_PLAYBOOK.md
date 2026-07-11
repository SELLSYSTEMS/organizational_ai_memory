# Final Pitch Playbook

## Identity And Hook

**Team:** SELLSYSTEMS
**Project:** Organizational AI Memory
**Track:** P5, Organizational AI Memory
**One-line pitch:**

> Organizational AI Memory turns individual prompts, workflows, decisions, and
> experience into reviewed, versioned, cited capability that authorized people
> and agents can safely reuse at task start.

Do not present Human-AgentOS as a second problem statement. Physical identities,
PostgreSQL policy, and Personal Memory Agents are how the P5 system enforces
scope and consent.

## Choose The Timing At The Assigned Station

- **If the portal/host says 3 + 1:** deliver the 2:45 condensed pitch and keep
  15 seconds safety. Use the complete 55.5-second live-demo video.
- **If the onsite workshop format says 5 + 2:** use the 4:45 script below,
  including the complete 55.5-second outcome demo.
- **If Round 2 is 7 + 3:** add the architecture, bounded pilot, and deployment
  path. Add a verified user-test result only if one is completed; otherwise use
  the bounded pilot measures and known gaps. The `+3` is separate Q&A; do not
  consume it with the seven-minute pitch.

The [official AABW page](https://agenticaibuildweek.genaifund.ai/) currently
evaluates technical implementation, fit to the enterprise problem, deployment
feasibility, business impact, and pitch clarity.
The six-slide story maps to those dimensions in that order: problem and target
user, working reuse loop, bounded agent decisions, enforceable deployment
architecture, honest evidence and pilot measures, then a concise demo close.

## Rehearsed 4:45 Pitch

### `0:00-0:40` - Team, Product, Promise

I am [YOUR NAME], [YOUR ROLE] at SELLSYSTEMS. We built Organizational AI Memory
for the P5 track so an enterprise delivery lead can start with approved prior
work. Individual AI know-how disappears in private chats and local workflows.
The enterprise may keep the final document, but it loses the prompt, decision,
workflow, edge cases, and reason the work succeeded. Our system turns that
experience into reviewed, versioned, cited capability that authorized people
and agents can find when a new task begins.

### `0:40-1:20` - Problem Insight

The failure is not storage. It is authority and context. A shared prompt folder
cannot prove what is current, why something worked, who may reuse it, or what
changed after review. Enterprises also cannot simply expose employee data to a
model. We therefore tested the problem as an enforcement system: synthetic
organizational capability for public proof, private-by-default employee
experience, explicit revision consent, independent review, and fail-closed
retrieval.

### `1:20-2:20` - Agentic Workflow

A user starts with a task, not a chatbot. Deterministic PostgreSQL retrieval
selects approved prompts, workflows, and decisions before any generation. Each
record carries type, version, review state, why-it-worked context, and source
lineage. Codex Spark may adapt only the selected records, and its citations are
validated. Private experience follows a separate lane: the employee owns it,
shares only a current revision, and a linked Personal Memory Agent retrieves it
through a broker under its own locked runtime identity. Edits reset access;
revocation stops retrieval.

### `2:20-3:05` - Differentiation And Credibility

The model can adapt the plan, but it cannot decide what the company knows.
Postgres is canonical; generated prose and retrieval derivatives are not.
Application policy, transaction-bound PostgreSQL scope, the agent's dedicated
Linux runtime, and broker credentials must all agree. The human and agent remain
distinct principals. Personal consent never publishes organizational memory. An
independent reviewer may approve the candidate. The architect may then promote
it only to a governed draft and remains explicitly denied direct canonical
writes.

### `3:05-3:35` - Strongest Evidence

Today, a delivery lead gets an approved, cited starting point instead of
rebuilding from scratch, while employees can contribute experience without
publishing private memory. The deployed release passed 275 API and security
tests, 22 build-bound identity controls, 35 browser checks, and seven
physical-agent boundary checks. Five isolated real-PostgreSQL integration cases
remain recorded contract evidence rather than a fresh live-database run. The
synthetic pack contains nine governed assets, five task definitions, thirteen
deterministic task-to-asset mappings, and three authored gap signals. A bounded
pilot will measure reuse, recommendation acceptance, review turnaround, and
denial success; no ROI is claimed yet.

### `3:35-4:31` - Play The 55.5-Second Outcome Demo

Play `organizational-ai-memory-live-pitch-demo.mp4` locally. Do not switch to a
live login or setup path unless the video cannot play.

### `4:31-4:45` - Close

When people move on, the organization keeps reviewed capability, not their
identity or private memory. We are ready to run a bounded enterprise pilot.

## Rehearsed 2:45 Round 1 Pitch

### `0:00-0:20` - Identity And Hook

I am [YOUR NAME], [YOUR ROLE] at SELLSYSTEMS. We built Organizational AI Memory
for P5 so a delivery lead starts with approved prior work. Companies keep the
final document but lose the prompt, workflow, decision context, and reason it
worked. Our system turns that individual know-how into reviewed, versioned,
cited capability that authorized people and agents can reuse at task start.

### `0:20-0:50` - Problem Insight

The failure is not storage. A shared prompt folder cannot prove what is current,
why it worked, who may reuse it, or what changed after review. Enterprises also
cannot expose private employee memory to every agent. We therefore built for
authority and context: deterministic retrieval, explicit source lineage,
private-by-default experience, revision consent, independent review, and
fail-closed access.

### `0:50-1:20` - Agentic Workflow And Difference

A delivery lead starts with a task, not a chatbot. PostgreSQL selects an
approved prompt, workflow, and decision before any model runs. Codex Spark may
adapt only those records and every citation is validated. Personal experience
stays owner-only until consent for the current revision; a distinct locked
agent retrieves it only through a broker. The model can adapt the plan, but it
cannot decide what the company knows.

### `1:20-1:40` - Credibility And Impact

The deployed release passed 275 API and security tests, 22 build-bound identity
controls, 35 browser checks, and seven physical-agent boundary checks. A
delivery lead gets an approved cited starting point instead of rebuilding from
scratch. A bounded pilot will measure reuse, recommendation acceptance, review
turnaround, and denial success; no ROI is claimed yet.

### `1:40-2:36` - Play The 55.5-Second Live-Pitch Video

Play `organizational-ai-memory-live-pitch-demo.mp4` from local disk.

### `2:36-2:45` - Close

When people move on, the organization keeps reviewed capability, not their
identity or private memory.

## 6:45 Finalist Expansion

This is `6:45` of content plus `0:15` safety inside the seven-minute pitch. The
separate three-minute Q&A begins only after the pitch.

Use the 4:45 story, then add these evidence modules before the close:

1. `0:40` - Four enforcement planes and why web RBAC alone is insufficient.
2. `0:35` - Negative proof: direct PostgreSQL, protected source, model
   credentials, and outbound sockets remain denied to the Personal Memory Agent.
3. `0:25` - Deployment path: enterprise SSO/SCIM and container-runtime adapters
   while preserving broker and database authority.
4. `0:20` - Bounded pilot buyer, measures, and explicit no-ROI-yet boundary.

Keep at least 15 seconds of safety. Use the full `177.00`-second judge video as
a submission artifact or backup, not inside the timed live pitch.

## Bounded Pilot

The initial buyer is an enterprise AI transformation, knowledge-management, or
platform leader. Propose a limited deployment and measure:

- recommendation acceptance rate
- approved asset reuse events
- repeated capability requests
- authored duplicate and uncovered-task signals
- review turnaround time
- access-denial and revocation success

Call these proposed pilot measures, not achieved outcomes.

## Two-Minute Q&A Method

Ask: **"Could we collect the judges' questions first?"** Group overlapping
questions, then answer each in 15-25 seconds using conclusion, evidence, and
connection to user value.

| Question | Direct answer | Supporting fact | Connection |
| --- | --- | --- | --- |
| Why not a vector database or prompt library? | Retrieval alone cannot establish organizational truth. | Records carry type, version, provenance, review, temporal state, and enforceable scope; PostgreSQL remains canonical. | Employees get the right prior work without treating similarity as authority. |
| What does the model control? | Wording and bounded adaptation only. | Selected assets and citations are deterministic and validated; fallback remains usable. | The enterprise keeps control when model access fails or changes. |
| What happens after an employee edits a memory? | Agent access resets. | The new revision returns to owner-only until explicit re-consent; only the new hash becomes retrievable. | Consent applies to exact content, not a permanent blanket grant. |
| What happens when an employee leaves? | Offboarding invokes suspension. | Workspace credentials, the human-agent pair, broker authorization, and the host runtime are revoked; separately reviewed organizational capability remains. | The organization keeps capability without impersonating the employee. |
| Is it production-ready? | It is a live enforced MVP, not a complete enterprise platform. | Separate workloads, forced database policy, physical agent sandboxing, source-bound proof, and automated CI are running. | SSO/SCIM, distributed sessions, and container adapters are explicit next steps. |
| Where is business value? | Reduce repeated reinvention and time spent finding approved prior work. | The system records governed assets, deterministic task recommendations, authored gap signals, review state, and access denials; it does not yet record recommendation acceptance or resulting ROI. | A bounded pilot can measure the value without inventing ROI. |
| Is the agent a digital twin? | No. | It has a separate identity and retrieves only consented current revisions. | The design preserves human authority and private memory. |
| What is the threat model? | Root and PostgreSQL superuser remain trusted administrators. | The MVP proves denial across ordinary application, database, broker, filesystem, and network boundaries. | Claims stay within the actual enforcement boundary. |

## Station Checklist

1. Replace `[YOUR NAME]` and `[YOUR ROLE]`, then rehearse the exact opening.
2. Complete the portal before the official `09:00` July 12 cutoff; the event
   page says updates after that time are not reviewed.
3. Confirm the latest portal timing and remain onsite for the full judging window.
4. Carry the deck, 55.5-second MP4, full backup MP4, captions, and transcript on
   local disk. Do not depend on Wi-Fi.
5. Preload `/capabilities`, `/assets`, `/method`, and the protected proof frame.
6. Use the prerecorded demo as primary proof. Use the live app only for a judge's
   specific follow-up.
7. Test HDMI, audio, fullscreen playback, and readable UI before the slot.
8. Keep the longer architecture and pilot material in appendix slides.
9. Never expose tokens, workspace links, browser account chrome, or terminal
   history during a live interaction.
