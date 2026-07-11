# Final Judge Media Handoff

Date: `2026-07-11`
Branch: `agent/final-judge-media`
Public repository: `https://github.com/SELLSYSTEMS/organizational_ai_memory`
Live product: `https://memory.sellsystems.agency/`

## What Changed

- Reviewed the complete `23:29.94` AABW pitch workshop and inspected its key
  slides frame by frame. Only the public-safe recommendations were retained;
  workshop footage, frames, transcript, device metadata, and attendee material
  are excluded from Git.
- Added rehearsed `2:45` and `4:45` scripts, a modular `6:45` finalist
  expansion, an offline interactive six-slide main deck with five appendix
  sections, Q&A answers, and a station checklist.
- Captured one fresh public capability interaction at `1920 x 1080`. The single
  Spark request produced a six-step adaptation grounded in the three
  deterministic assets and their allowed source turns.
- Generated two timestamp-aligned ElevenLabs voiceovers, WebVTT captions, and
  burned-in-caption video masters.
- Added deterministic capture, voice, build, QA, manifest, and repository
  verification scripts.
- Corrected the old screenshot manifest: its screenshot `04` shows inventory
  and authored analytics signals; the new final-video focal captures show the
  asset inspector and provenance path.
- Bound headline evidence counts and citation validation to the deployed commit,
  source digest, reports, validator source, and validator tests.
- Added an independent `gpt-5.3-codex-spark` xhigh claims review. A later media
  watch audit found and corrected stream coverage, capture, and binding defects
  before the final QA report and manifest were regenerated.

## Final Media

| Artifact | Contract | SHA-256 |
| --- | --- | --- |
| `artifacts/submission/media/final-judge-video/organizational-ai-memory-live-pitch-demo.mp4` | `55.50s`, H.264 High, yuv420p, 1920x1080, 30 fps, AAC 48 kHz stereo | `7390cf8241d4f6824dff27f213ea14346883ab94fa073211cad1094be953d150` |
| `artifacts/submission/media/final-judge-video/organizational-ai-memory-p5-judge-demo.mp4` | `177.00s`, H.264 High, yuv420p, 1920x1080, 30 fps, AAC 48 kHz stereo | `5e0e03bb0e2a67c087d8c908f6b8a73121708a38791ee93e161b854c6d6a50dc` |
| `artifacts/submission/media/final-judge-video/organizational-ai-memory-p5-judge-demo-poster.png` | 1920x1080 PNG | See `final-judge-media-manifest.json` |
| `artifacts/submission/media/organizational-ai-memory-employee-workflow.mp4` | `50.08s` supporting technical workflow, no narration | `5233af147e807b41452d67fa7d71dddf17f160841caa091f0034785bc1670bc3` |

Both final videos include separate `.vtt` files and the shared
`FINAL_VIDEO_TRANSCRIPTS.md` document. All visible people, identities, and
organizational records are synthetic public-safe demo data.

The offline deck is
`artifacts/submission/ORGANIZATIONAL_AI_MEMORY_PITCH_DECK.html`. It contains six
main slides, five appendices, working keyboard/fullscreen controls, and the
55.5-second video. All 11 slides and 16 local media references passed 1920x1080
render QA without clipping, overflow, missing assets, or browser errors.

## What Was Verified

- Final capture: PASS, one assist attempt, model `gpt-5.3-codex-spark`, six
  structured steps, exact three selected/cited assets, four permitted source
  turns, per-step citation containment, sandboxed UID `65534`, and no unexpected
  browser errors.
- Media QA: PASS 2/2; complete video/audio decode, faststart, no black intervals,
  expected trailing silence only, two-line captions, metadata allowlist, and
  scene-by-scene full-resolution visual review.
- Loudness: full `-16.03 LUFS / -1.47 dBTP`; live `-16.02 LUFS / -1.50 dBTP`.
- Final manifest: PASS, 12 exact binary artifacts, 13 exact text artifacts, and
  the closed legacy 31-artifact manifest preserved unchanged.
- Release evidence binding: `275/275` API/security, `22/22` identity,
  `35/35` browser, seven physical-agent boundary checks, and five recorded
  PostgreSQL contract cases.
- Citation binding: deployed per-asset source-turn containment validator and
  test hashes at commit `525ff861b3580365839f487ca0dca10d0bf791cd`.
- Independent exact-hash watch review: no release blocker remains; its bounded
  editorial notes are preserved in
  `artifacts/evaluation/final-judge-media-independent-watch-review.md`.
- Final isolated `gpt-5.3-codex-spark` xhigh package recheck: `VERDICT: RELEASE`
  after `71,271` review tokens.
- No SSH key, SSH configuration, `known_hosts`, or SSH-agent state was changed.

## Commands

```bash
install -d -o nobody -g nogroup -m 700 \
  /tmp/oam-media-capture.ULJLlH/home \
  /tmp/oam-media-capture.ULJLlH/sources
chown nobody:nogroup /tmp/oam-media-capture.ULJLlH
install -d -o nobody -g nogroup -m 700 \
  /tmp/oam-media-capture.ULJLlH/home/.cache/ms-playwright/ffmpeg-1011
install -o nobody -g nogroup -m 755 \
  /root/.cache/ms-playwright/ffmpeg-1011/ffmpeg-linux \
  /tmp/oam-media-capture.ULJLlH/home/.cache/ms-playwright/ffmpeg-1011/ffmpeg-linux
sudo -u nobody env \
  HOME=/tmp/oam-media-capture.ULJLlH/home \
  XDG_CONFIG_HOME=/tmp/oam-media-capture.ULJLlH/home/.config \
  XDG_CACHE_HOME=/tmp/oam-media-capture.ULJLlH/home/.cache \
  OAM_FINAL_VIDEO_CAPTURE_CONFIRM=CAPTURE_PUBLIC_FINAL_JUDGE_VIDEO_SOURCES \
  node scripts/evaluation/capture_final_judge_video_sources.mjs \
  /tmp/oam-media-capture.ULJLlH/sources

OAM_FINAL_VIDEO_VOICE_CONFIRM=GENERATE_FINAL_JUDGE_VOICEOVERS \
  node scripts/evaluation/generate_final_judge_voiceovers.mjs
OAM_FINAL_VIDEO_VOICE_CONFIRM=GENERATE_FINAL_JUDGE_VOICEOVERS \
OAM_FINAL_VIDEO_VOICE_JOBS=live-demo \
  node scripts/evaluation/generate_final_judge_voiceovers.mjs

OAM_FINAL_VIDEO_BUILD_CONFIRM=BUILD_FINAL_JUDGE_VIDEOS \
  node scripts/evaluation/build_final_judge_videos.mjs

OAM_FINAL_VIDEO_VISUAL_REVIEW_CONFIRM=REVIEWED_ALL_FINAL_VIDEO_SCENES \
  node scripts/evaluation/verify_final_judge_videos.mjs --write-reviewed-report
node scripts/evaluation/verify_final_judge_videos.mjs --check

OAM_FINAL_MEDIA_MANIFEST_CONFIRM=FINAL_JUDGE_MEDIA_VISUALLY_REVIEWED \
  node scripts/evaluation/build_final_judge_media_manifest.mjs

node scripts/evaluation/verify_final_judge_media_manifest.mjs
node scripts/evaluation/verify_release_package.mjs
npm run app:test
```

The final package recheck invoked `/usr/bin/codex exec` as `oam-codex` with
`HOME=/var/lib/oam-codex`, `CODEX_HOME=/var/lib/oam-codex/.codex`, model
`gpt-5.3-codex-spark`, `xhigh` reasoning, ephemeral state, read-only sandbox,
and only the named public-safe text files on standard input.

The voice generator reads its locally supplied credential in memory and does
not log or copy it. The public reports contain only the provider, voice ID,
model, non-secret settings, timestamps, hashes, and artifact metadata.

## URLs Checked

```text
https://memory.sellsystems.agency/
https://memory.sellsystems.agency/capabilities
https://memory.sellsystems.agency/assets?asset=prompt%3Awebsite_handoff_brief_v1
https://memory.sellsystems.agency/api/readyz
https://memory.sellsystems.agency/api/public/access-proof
```

## Known Degraded Or Manual Modes

- Spark is optional and non-authoritative. Deterministic retrieval and fallback
  remain usable if the model or sidecar is unavailable.
- The five real-PostgreSQL cases are recorded release contract evidence, not a
  fresh live-database run for this media branch.
- No user pilot, testimonial, measured time saving, or ROI is claimed. Pilot
  measures are proposals.
- Semantic retrieval, enterprise SSO/SCIM, autonomous canonical publication,
  outcome feedback, and time-series growth analytics remain known gaps.
- The employee workspace and Architect Console are protected review surfaces,
  not anonymous judge paths.
- Public video upload and anonymous playback verification remain operator-only.
- Builder Hub fields, track confirmation, upload, declarations, and final
  submission remain operator-only and were not performed.
