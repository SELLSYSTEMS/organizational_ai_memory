# Builder Hub Copy-Paste Pack

Prepared for the AABW 2026 submission portal on `2026-07-12`.

## Track

The portal already shows this problem statement as locked. Verify the row, then
click **Confirm your track/s** after entering the title and pitch:

```text
Founder Mode Track powered by GenAI Fund / P5: Organizational AI Memory: The Capability Layer for the AI Enterprise
```

Human-AgentOS is supporting enforcement architecture, not a second submission
problem statement.

## Project title

```text
Organizational AI Memory
```

## Elevator pitch

```text
Organizational AI Memory turns individual prompts, workflows, decisions, and why-they-work context into reviewed, versioned, cited capability that authorized people and agents can find and reuse at task start.
```

## About the project

Replace the entire current **About the project** field with the contents inside
this four-backtick block:

````markdown
## Inspiration

Enterprises are investing in AI training, prompt engineering, automation, and agents, but much of the resulting capability still belongs to individuals. A prompt that consistently works, the reason a workflow survived an edge case, or the context behind an important decision is often scattered across chats, personal documents, and operating habits. When someone changes roles or leaves, the organization may keep the final artifact while losing the method and evidence that made it effective.

We asked: what if individual AI learning could become durable organizational capability without turning a shared vector database or broadly credentialed chatbot into the "company brain"?

## What it does

Organizational AI Memory is a provenance-first capability layer for prompts, workflows, agent patterns, decisions, practices, and employee experience.

At task start, deterministic free-text search retrieves approved prior work from PostgreSQL before any model runs. Every capability is typed and versioned, with its owner role, review state, intended roles, constraints, why it worked, and an inspectable `asset -> observation -> source turn` path. Optional `gpt-5.3-codex-spark` assistance can adapt only those selected records into a structured plan. It cannot choose different assets or change authoritative memory. Every generated plan's asset and source-turn citations are validated, and the stored recommendation remains available if generation fails.

The public workspace shows reviewed inventory, task coverage, source provenance, duplication signals, capability gaps, and a sanitized dated access proof. It does not invent ROI, testimonials, or outcome measurements.

All visible names, employee records, and organizational content in the public submission media are synthetic and public-safe.

The system also proves a governed personal-memory lifecycle. An architect onboards one employee and exactly one distinct Personal Memory Agent. The pair remains unusable until confirmed physical provisioning succeeds. Employee experiences, lessons, preferences, skills, decisions, and patterns are private and versioned by default. The employee can explicitly allow only the linked agent to retrieve a current revision; results include memory ID, revision, and SHA-256 citations. Editing shared content creates a new owner-only revision and requires consent again.

Personal sharing never publishes content into organizational memory. Organizational candidates use a separate lane:

```text
quarantined text
-> sealed source bytes
-> service-produced candidate
-> independent human review
-> architect promotion
-> draft only
```

## How we built it

We extended an existing live Node.js and PostgreSQL foundation instead of rebuilding from zero. PostgreSQL 17 is canonical for temporal facts, capability assets, policy assignments, personal-memory versions, quarantine records, reviews, promotion drafts, proofs, and audit events.

The runtime is divided into least-privileged public, operator, employee, broker, provisioner, Codex, and per-agent services. Authorization is the intersection of four enforcement planes:

1. Application identity: distinct human, agent, and service principals.
2. Policy: department membership, immutable templates, sponsor ceilings, and explicit denials.
3. Runtime identity: dedicated locked agent UIDs, private workspaces, systemd sandboxing, and broker credentials.
4. Data authority: fixed public views, transaction-bound operator context, FORCE RLS, and brokered capability grants.

The Personal Memory Agent has no direct PostgreSQL login; its dedicated service retrieves only explicitly authorized current versions through the broker. The responsive interface uses semantic HTML, CSS, browser-native JavaScript, and nginx. OpenAI Codex CLI supported implementation, testing, claims review, and release packaging. The optional Spark sidecar runs as an isolated Linux user with no database credential.

## Challenges we ran into

The hardest product problem was making generated assistance useful without making it authoritative. We selected stored records first, validated every generated citation against them, and preserved a deterministic fallback.

Search also needed correct negative behavior. Unrelated, ambiguous, and instruction-injection-shaped queries must return no match instead of plausible but unsupported advice. We added stable scoring, ambiguity handling, Vietnamese and diacritic normalization, and false-positive regression tests.

Finally, onboarding could not imply that an agent was physically ready. Every pair starts in draft and activates only when database identity, policy, credential, runtime binding, grants, and physical provisioning proof agree.

## Accomplishments that we're proud of

- A live workspace connects deterministic task-start search, typed records, visible provenance, cited adaptation, analytics, and access evidence.
- The public pack contains 9 approved assets across 5 types, 5 task definitions, and 13 stored recommendation mappings.
- The protected workflow proves onboarding, physical activation, private capture, revision-bound consent, cited retrieval, edit reset, and re-consent; separate build-bound and PostgreSQL integration evidence establishes revocation. Direct project, secret, and PostgreSQL access fail closed for the dedicated agent.
- Release evidence records 275/275 API and security checks, 22/22 identity controls, 35/35 browser checks, seven physical-agent boundary checks, and five passing recorded real-PostgreSQL contract cases. The final capture made one Spark request and returned a six-step plan grounded in exactly three deterministic assets and their permitted source turns.

## What we learned

Organizational memory is not merely similarity search. It needs typed objects, temporal truth, provenance, review state, explicit authority, and a reliable way to say, "no supporting memory found." A Personal Memory Agent is not a digital clone; it is a distinct, policy-bound principal supporting one employee within explicit, revocable scope. Transparent limitations made the product more credible.

## What's next for Organizational AI Memory

Next we would add enterprise SSO/SCIM, controlled connectors, outcome feedback, time-series capability analytics, automated duplicate and gap detection, broader version history, and a non-gating semantic retrieval lane. The longer-term goal is a portable capability protocol that returns only approved prior work allowed by the requesting principal's policy.

## Built with

- Node.js 22 and browser-native JavaScript
- PostgreSQL 17 with FORCE RLS and security-barrier views
- Linux identities, systemd sandboxing, and Unix-domain sockets
- nginx
- OpenAI Codex CLI and `gpt-5.3-codex-spark`
- JSON Schema
- Playwright and system Chrome
- Google Stitch for bounded design exploration
- FFmpeg, WebVTT, and ElevenLabs for submission media

## Optional Links

- [Live product](https://memory.sellsystems.agency/)
- [Capability workspace](https://memory.sellsystems.agency/capabilities)
- [Architecture and authority](https://memory.sellsystems.agency/method)
- [Public evidence inspector](https://memory.sellsystems.agency/evidence)
- [Sanitized access proof](https://memory.sellsystems.agency/api/public/access-proof)
- [Source repository](https://github.com/SELLSYSTEMS/organizational_ai_memory)
````

## Built with tags

Enter these as separate tags:

```text
JavaScript
Node.js
PostgreSQL
HTML and CSS
NGINX
Linux and systemd
Unix sockets
JSON Schema
OpenAI Codex CLI
GPT-5.3-Codex-Spark
Playwright
Google Stitch
Git
FFmpeg
WebVTT
ElevenLabs
```

## Links and media

Demo URL:

```text
https://memory.sellsystems.agency/
```

GitHub / repository URL:

```text
https://github.com/SELLSYSTEMS/organizational_ai_memory
```

Video demo link after uploading the official master to Dropbox, YouTube, or
Vimeo and enabling anonymous viewing:

```text
PASTE THE VERIFIED PUBLIC PLAYBACK PAGE HERE
```

Upload this exact file:

```text
/home/admin/organizational-ai-memory/artifacts/submission/media/final-judge-video/organizational-ai-memory-p5-judge-demo.mp4
```

Do not use the GitHub blob or raw-file URL in the required video field: the
blob page cannot preview this file size, while the raw URL may download rather
than play. Verify the final playback page in an incognito browser.

## Image gallery upload order

All files are below the portal's 5 MB limit and contain synthetic public-safe
data. Upload these in this order:

```text
/home/admin/organizational-ai-memory/artifacts/submission/screenshots/01-home-capability-memory-1440.png
/home/admin/organizational-ai-memory/artifacts/submission/media/final-judge-video/sources/02-search-results-1920x1080.png
/home/admin/organizational-ai-memory/artifacts/submission/media/final-judge-video/sources/05-assist-result-1920x1080.png
/home/admin/organizational-ai-memory/artifacts/submission/media/final-judge-video/sources/03-asset-inspector-provenance-1920x1080.png
/home/admin/organizational-ai-memory/artifacts/submission/screenshots/07-architect-console-four-plane-1440.png
/home/admin/organizational-ai-memory/artifacts/submission/media/screenshots/employee-workflow/11-capture-private-experience.png
/home/admin/organizational-ai-memory/artifacts/submission/media/screenshots/employee-workflow/14-grounded-reuse-with-citation.png
/home/admin/organizational-ai-memory/artifacts/submission/media/screenshots/employee-workflow/20-physical-agent-runtime-proof.png
```

Do not upload screenshots containing a workspace link, access token, cookie,
broker credential, shell history, or private source data.

The captures use `1440x1000` and `1920x1080` source formats rather than the
portal's recommended 3:2 ratio. Preview the gallery crop before saving and
confirm that headings, citations, and proof labels remain visible.

## AABW technology partners

Select:

```text
OpenAI
```

Also select Google / Google for Developers only if the exact option is present,
because Google Stitch was used for bounded design exploration.

## Partner technology explanation

```markdown
OpenAI technology is used in both development and the live product. Codex CLI supported repository inspection, implementation, test generation, claims review, and release packaging. In the live reuse loop, an isolated `gpt-5.3-codex-spark` sidecar adapts only records selected by deterministic PostgreSQL retrieval into a structured plan. The application validates every asset and source-turn citation before display and falls back to the stored recommendation when generation is unavailable.
```

Only if Google / Google for Developers is also selected, append:

```markdown
Google Stitch informed bounded visual exploration; the final interface was implemented and browser-tested in this repository.
```

## Final portal check

1. Verify the locked P5 row, enter the title and pitch, and click **Confirm your track/s**.
2. Preview the Markdown story before continuing.
3. Verify the live product, repository, and video links in an incognito window.
4. Upload the gallery in the listed narrative order.
5. Never place architect, reviewer, employee, or broker credentials in the form.
6. Save the draft after every page, then review the final public project once.
