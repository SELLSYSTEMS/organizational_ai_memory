# Product Video Plan

Status: two judge-ready narrated videos and one supporting technical walkthrough
are verified from the live release. All people and records shown are synthetic
public-safe demo data.

Live-pitch deliverable:
`artifacts/submission/media/final-judge-video/organizational-ai-memory-live-pitch-demo.mp4`
(`55.50` seconds, `1920 x 1080`, H.264 High/yuv420p, AAC). It follows the
workshop sequence: user goal, trigger, agent actions and decisions, governed
outcome, then a silent proof hold.

Full judge/submission deliverable:
`artifacts/submission/media/final-judge-video/organizational-ai-memory-p5-judge-demo.mp4`
(`177.00` seconds, `1920 x 1080`, H.264 High/yuv420p, AAC). It includes the
complete P5 reuse and private-input governance story without claiming user ROI.

Supporting technical walkthrough:
`artifacts/submission/media/organizational-ai-memory-employee-workflow.mp4`
(`50.08` seconds, `1440 x 1000`, H.264/yuv420p). The browser workflow occupies
the first `42.12` seconds and the final eight-second frame is the separately
rendered physical-agent runtime proof.

## Canonical scenario

Use one synthetic employee and exactly one Personal Memory Agent. The scenario
must cover:

```text
architect onboarding
-> draft one-to-one pair
-> confirmed physical provisioning
-> employee private profile and memory
-> explicit current-revision agent access
-> employee-authorized preview
-> separate physical-agent broker retrieval
-> edit resets access
-> explicit re-share
-> physical runtime allow/deny proof
```

Suspension and credential revocation are verified by the build-bound identity
proof and real PostgreSQL coverage; they are not represented as a browser scene
in this 50-second cut.

The public capability query remains:

```text
Prepare a website delivery handoff
```

## Judge-video story

The narrated cuts lead with searchable organizational capability rather than
provisioning. They show:

```text
task goal
-> deterministic prompt + workflow + decision selection
-> typed/versioned/reviewed records and source lineage
-> one bounded six-step Spark adaptation
-> owner-only employee experience
-> explicit current-revision consent
-> cited employee preview
-> separate physical broker proof and denials
-> edit reset and re-consent
-> independent review and draft-only promotion boundary
-> inventory signals, execution evidence, and proposed pilot measures
```

## Supporting technical chapters

| Approximate time | Screen and action | Visible evidence |
| --- | --- | --- |
| `00:00-00:15` | Onboard Mai Nguyen, display the masked result, queue and confirm the immutable plan, then show succeeded provisioning and the active pair. | One human, one distinct agent, no visible secret, revision-bound privileged operation, dedicated runtime identity. |
| `00:15-00:23` | Enter the private workspace, author and save the work profile, then explicitly share the current profile revision. | Fragment-scrubbed session, owner-only version, separate consent action. |
| `00:23-00:30` | Capture a private delivery experience, prove no-match before consent, share it, and retrieve it with a citation. | Typed memory, why it worked, private-by-default negative behavior, memory ID/revision/hash/audit receipt. |
| `00:30-00:42` | Edit the memory, prove access reset, explicitly re-consent revision 4, then show desktop and mobile access ledgers. | Edit-reset, current-version-only retrieval, owner/agent visibility separation, responsive layout. |
| `00:42-00:50` | Display the sanitized physical runtime proof. | Protected reads and direct PostgreSQL denied; own workspace and brokered cited retrieval allowed. |

## Evidence labels

Every protected scene must carry one unobtrusive label in the edit or adjacent
caption:

- `EMPLOYEE PREVIEW` for `/workspace/api/v1/agent-context`
- `PHYSICAL AGENT PROOF` for the dedicated agent process and broker path
- `PUBLIC CAPABILITY` for the separate public organizational-memory workflow

Do not call the employee preview a physical-agent run. Do not call the Personal
Memory Agent a digital twin, employee identity, autonomous clone, or source of
canonical organizational truth.

## Recording rules

1. Record at 1080p or `1440 x 1000`, 100% zoom, in clean browser profiles.
2. Use a synthetic employee and synthetic memory content only.
3. Authenticate protected sessions off camera. Crop browser password managers,
   account chrome, and notification surfaces.
4. Never show workspace links, operator tokens, cookies, broker credentials,
   secret-bearing paths, terminal history, database URLs, or model-auth files.
   The synthetic runtime UID/unit/workspace identifiers may remain visible as
   physical-enforcement evidence.
5. Capture the actual returned state. Do not edit status labels, hashes, counts,
   timestamps, or access results into screenshots or video frames.
6. Describe the one captured Spark result exactly as recorded. The final judge
   capture is generated; a future fallback capture must be narrated as fallback
   and must not be replaced with a response from another run.
7. If a future physical-agent capture fails, fail that release run. The
   employee preview is not a substitute.
8. Do not claim measured time savings, ROI, autonomous enterprise rollout,
   continuous gap discovery, or a digital copy of an employee.
9. Export H.264/yuv420p with legible UI text. Narration, if added for portal
   upload, must not change or cover the underlying evidence.

## Output and verification

Verified output:

```text
artifacts/submission/media/final-judge-video/organizational-ai-memory-live-pitch-demo.mp4
artifacts/submission/media/final-judge-video/organizational-ai-memory-live-pitch-demo.vtt
artifacts/submission/media/final-judge-video/organizational-ai-memory-p5-judge-demo.mp4
artifacts/submission/media/final-judge-video/organizational-ai-memory-p5-judge-demo.vtt
artifacts/submission/media/final-judge-video/organizational-ai-memory-p5-judge-demo-poster.png
artifacts/submission/media/final-judge-video/FINAL_VIDEO_TRANSCRIPTS.md
artifacts/submission/media/final-judge-video/final-video-qa-report.json
artifacts/submission/media/final-judge-video/final-judge-media-manifest.json
artifacts/submission/media/organizational-ai-memory-employee-workflow.mp4
artifacts/submission/media/organizational-ai-memory-employee-workflow.webm
artifacts/submission/media/employee-workflow-capture-report.json
artifacts/submission/media/release-media-manifest.json
```

```text
browser_capture_utc:      2026-07-11T13:43:02.498Z through 2026-07-11T13:43:57.124Z
physical_proof_checked:   2026-07-11T13:44:51.061Z
release_mp4_built:        2026-07-11T13:45:47.251Z
release_commit:           525ff861b3580365839f487ca0dca10d0bf791cd
deployed_source_sha256:   da4a85d2c50f0605f9bc43287c768edf2a113d00b69fe7ef0c8c36c62c0ce561
employee_proof_run_id:    0711-final-f
video_sha256:             5233af147e807b41452d67fa7d71dddf17f160841caa091f0034785bc1670bc3
duration_seconds:         50.08
live_pitch_duration:      55.50
full_judge_duration:      177.00
final_video_qa:           PASS 2/2
final_media_manifest:     PASS 12 binary + 13 text
public_video_url:         not uploaded; operator-only until anonymous playback verification
reviewer:                 Codex release audit, 2026-07-11T13:52:18Z
```

The employee-workflow video is releasable when a reviewer can distinguish:

1. owner-only memory from an explicitly shared current revision
2. employee preview from the physical Personal Memory Agent process
3. successful personal retrieval from the private no-match state

The complete submission package, not this 50-second cut alone, additionally
proves reviewed organizational capability, optional cited Spark adaptation,
cross-employee denial, and revocation through the public captures, integration
evidence, and build-bound identity proof.

## Safe public recapture

Future public browser capture must run under a no-secret unprivileged account
with the Chrome sandbox enabled. Do not use `root`, `oam-codex`, any Personal
Memory Agent identity, or a protected employee/operator account. Stage output
in a private temporary directory owned by that capture account; do not grant it
write access to the repository.

The schema-v2 report binds the capture generator, OS UID and sandbox state, the
six PNGs, WebM, exact selected assets, every structured step, and per-step
source-turn containment by SHA-256. After the report passes, a trusted operator
may promote only those exact eight files into `final-judge-video/sources`, then
must rebuild the videos, repeat the full scene review, and regenerate the
closed manifest. A prior passing report must never be reused beside new source
media.
