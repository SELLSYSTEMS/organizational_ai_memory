# Screenshot Manifest

Status: verified release media for commit
`525ff861b3580365839f487ca0dca10d0bf791cd`. The protected set uses one
synthetic employee and one distinct Personal Memory Agent throughout.

## Current release evidence fields

```text
release commit:                 525ff861b3580365839f487ca0dca10d0bf791cd
deployed source SHA-256:        da4a85d2c50f0605f9bc43287c768edf2a113d00b69fe7ef0c8c36c62c0ce561
browser capture UTC:            2026-07-11T13:43:02.498Z through 2026-07-11T13:43:57.124Z
physical proof checked UTC:     2026-07-11T13:44:51.061Z
physical proof rendered UTC:    2026-07-11T13:45:21.275Z
employee proof run ID:          0711-final-f
employee capture report:        artifacts/submission/media/employee-workflow-capture-report.json, PASS 19/19
physical proof image:           20-physical-agent-runtime-proof.png, PASS
public capture report:          artifacts/submission/screenshots/capture-report.json, PASS 8/8
reviewer:                       Codex release audit, 2026-07-11T13:52:18Z
unexpected browser errors:      0
```

## Personal Memory Agent workflow set

All paths are under
`artifacts/submission/media/screenshots/employee-workflow/`.

| Filename | Verified state | Evidence class | Status |
| --- | --- | --- | --- |
| `01-onboard-employee.png` | Bounded onboarding form for one synthetic employee and one named agent | Operator workflow | PASS |
| `02-created-pair-masked-link.png` | Atomic pair creation; returned private link remains masked | Operator workflow | PASS |
| `03-immutable-plan-queued.png` | Revisioned physical-provisioning plan queued | Provisioning gate | PASS |
| `04-revision-bound-confirmation.png` | Exact plan revision and hash confirmed | Provisioning gate | PASS |
| `05-physical-provisioning-succeeded.png` | Runtime binding, grants, proofs, and activation succeeded | Physical runtime state | PASS |
| `06-active-pair-and-runtime-identity.png` | Active one-to-one pair and dedicated runtime identity | Identity boundary | PASS |
| `07-private-workspace-activated.png` | Fragment scrubbed before authenticated workspace renders | Employee workspace | PASS |
| `08-self-authored-work-profile.png` | Employee authors role context, expertise, style, goals, and constraints | Employee workspace | PASS |
| `09-private-versioned-work-profile.png` | Immutable owner-only profile revision | Version/consent proof | PASS |
| `10-explicit-profile-consent.png` | Current profile revision explicitly shared with the linked agent | Version/consent proof | PASS |
| `11-capture-private-experience.png` | Typed experience with context, why it worked, evidence, tags, and sensitivity | Employee workspace | PASS |
| `12-private-memory-excluded.png` | Owner-only memory is absent from agent-visible retrieval | Negative retrieval proof | PASS |
| `13-revision-bound-memory-consent.png` | Explicit access binds to the current memory revision/hash | Version/consent proof | PASS |
| `14-grounded-reuse-with-citation.png` | Employee preview returns memory ID, revision, hash, and audit receipt | `EMPLOYEE PREVIEW` | PASS |
| `15-edit-resets-agent-access.png` | Edit creates a new owner-only revision and resets consent | Version/consent proof | PASS |
| `16-edited-version-excluded.png` | Edited current revision remains excluded before re-consent | Negative retrieval proof | PASS |
| `17-current-version-reconsented.png` | Re-consent exposes only revision 4 and its new hash | Version/consent proof | PASS |
| `18-personal-agent-boundaries.png` | Agent-visible and owner-only sources remain distinct | Employee workspace | PASS |
| `19-personal-agent-boundaries-mobile.png` | Same ledger has no horizontal overflow at 390 x 844 | Responsive UI | PASS |
| `20-physical-agent-runtime-proof.png` | Dedicated systemd process denies protected reads, AF_INET socket creation, and direct PG while retrieving the allowed revision through the broker | `PHYSICAL AGENT PROOF` | PASS |

Suggested captions must describe only the visible evidence. Do not use
"digital twin," "employee clone," "autonomous company brain," or imply that
employee preview proves execution under the physical agent's Linux identity.

## Public product captures

The following eight files were freshly captured at
`2026-07-11T13:50:57.641Z`; the machine report records 8/8 success.

| Filename | Verified state | Safe caption |
| --- | --- | --- |
| `01-home-capability-memory-1440.png` | Home recommendation and four temporal facts loaded | "Organizational AI Memory starts from reviewed capability and preserves current truth without erasing history." |
| `02-capability-workspace-1440.png` | Three deterministic assets, four analytics metrics, and fresh 22/22 proof visible | "Deterministic search connects governed reuse, analytics, and build-bound access proof." |
| `03-capability-spark-plan-1440.png` | `gpt-5.3-codex-spark` plan with validated asset and source-turn citations | "Spark adapts selected records while deterministic capability remains authoritative." |
| `04-assets-governance-provenance-1440.png` | Asset inventory with governed-state, duplication, and authored-gap signals | "The synthetic pack exposes reviewed inventory and clearly labels authored duplication and gap signals." |
| `05-method-architecture-1440.png` | Public architecture and authority method | "Application identity, policy, runtime identity, and data authority are distinct enforcement planes." |
| `06-capability-workspace-mobile-390.png` | Responsive public capability workflow | "The public capability workflow remains usable without horizontal overflow on mobile." |
| `07-architect-console-four-plane-1440.png` | Authenticated four-plane overview with no credential visible | "The protected console maps principals to policy, runtime bindings, and data authority." |
| `08-architect-effective-access-1440.png` | AI Architect evaluation shows allowed actions and canonical-write denial | "Reviewed promotion produces a draft; direct canonical-memory write remains denied." |

## Final judge-video focal captures

The final public-only capture at `1920 x 1080` is stored under
`artifacts/submission/media/final-judge-video/sources/`. It used one assist
request and produced a six-step `gpt-5.3-codex-spark` adaptation constrained to
the three deterministic records and their permitted source turns.

| Filename | Verified state |
| --- | --- |
| `01-home-1920x1080.png` | P5 product and stored starting point visible |
| `02-search-results-1920x1080.png` | Exact prompt, workflow, and decision selected before generation |
| `03-asset-inspector-provenance-1920x1080.png` | Typed content, version, approval, operational value, and why-it-worked context |
| `04-asset-source-path-1920x1080.png` | Focused `asset -> observation -> source turn` path and lineage |
| `05-assist-result-1920x1080.png` | Fresh six-step Spark adaptation with validated citations |
| `06-analytics-access-proof-1920x1080.png` | Inventory analytics and governed-access proof in the same capability workspace |

## Capture contract

1. Capture public screens from `https://memory.sellsystems.agency` at
   `1440 x 1000`; mobile uses `390 x 844`.
2. Authenticate operator and employee browser profiles off camera. Tokens,
   workspace links, cookies, autofill surfaces, and browser account chrome must
   be absent from images and reports.
3. Set the nginx and employee-service production Host/Origin/proxy contract
   before protected capture; do not weaken it for the recording.
4. Use actual returned hashes, revisions, identities, and status. Never edit a
   success state into an image.
5. A physical-agent image requires evidence from the dedicated process and
   broker path. `/workspace/` preview alone is insufficient.
6. Any unexpected page error, console error, missing citation, stale proof, or
   cross-employee allow fails the current capture set.
7. The capture reports, `release-media-manifest.json`, and
   `final-judge-media-manifest.json` jointly store the
   release commit, deployed source digest, UTC timestamps, viewport, route,
   observed state, and file SHA-256 for every image.
8. Run a secret scan and manual review before adding images to Git.
