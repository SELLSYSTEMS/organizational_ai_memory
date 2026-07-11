# Publishing the Source Safely

Status: the operator-approved public destination is
`https://github.com/SELLSYSTEMS/organizational_ai_memory`, configured locally as
`origin`. Publication uses a focused branch, pull request, and required CI;
`main` protection is applied after the first successful CI run establishes the
required check names. No SSH key or SSH configuration was created or changed.

The current Personal Memory Agent release is installed and freshly verified.
Future changes must repeat that install/proof/capture sequence; a source commit
alone is not live proof.

These instructions preserve a reviewable public tree without exposing
target-only material.

## 1. Confirm the local repository

Run only from the project root:

```bash
cd /home/admin/organizational-ai-memory
test "$(pwd -P)" = "/home/admin/organizational-ai-memory"
test -d .git
git branch --show-current
git config --local --get user.name
git config --local --get user.email
test "$(git remote get-url origin)" = \
  "https://github.com/SELLSYSTEMS/organizational_ai_memory.git"
gh repo view SELLSYSTEMS/organizational_ai_memory \
  --json nameWithOwner,url,visibility,defaultBranchRef
```

The repository must resolve to the operator-approved public destination above.
Do not reinitialize it, embed credentials in the remote URL, replace the local
identity with root authentication, or alter SSH configuration for publishing.

## 2. Stage the public allowlist

The `.gitignore` excludes runtime state, credentials, raw QA output, internal
handoffs, inherited private topology notes, and the deployed target-specific
nginx file. The tracked nginx file is the placeholder-based `.example` only.

Before staging, verify the final handoff contains the current release commit and
deployed source digest, and that every Personal Memory Agent screenshot marked
verified is jointly covered by its capture report and the release media hash
manifest.

Stage the public tree explicitly; do not use a blanket `git add .`:

```bash
git add -- \
  .gitignore .github LICENSE README.md DESIGN.md CODE_OF_CONDUCT.md \
  CONTRIBUTING.md SECURITY.md \
  package.json package-lock.json \
  app config deploy scripts sql test docs \
  artifacts/design/DESIGN_REVIEW.md \
  artifacts/evaluation/identity-plane-proof \
  artifacts/evaluation/gpt-5.3-codex-spark-xhigh-release-review.md \
  artifacts/evaluation/gpt-5.3-codex-spark-personal-agent-release-review.md \
  artifacts/evaluation/spark-personal-agent-release-review-prompt.md \
  artifacts/evaluation/spark-personal-agent-release-recheck-prompt.md \
  artifacts/evaluation/personal-agent-runtime-proof-sanitized.json \
  artifacts/qa/browser/report.json \
  handoff/FINAL_HACKATHON_MVP_HANDOFF_2026-07-10.md \
  handoff/aihackathon_public_safe_asset_pack_2026-07-10/assets.json \
  handoff/aihackathon_public_safe_asset_pack_2026-07-10/asset_bodies_v2.json \
  handoff/aihackathon_public_safe_asset_pack_2026-07-10/recommendations.json \
  handoff/aihackathon_public_safe_asset_pack_2026-07-10/analytics.json \
  handoff/aihackathon_public_safe_asset_pack_2026-07-10/source_turns.json
```

Add submission media only after manual review. The current reviewed set is:

```bash
git add -u -- artifacts/submission/screenshots
git add -- \
  artifacts/submission/screenshots/capture-report.json \
  artifacts/submission/screenshots/01-home-capability-memory-1440.png \
  artifacts/submission/screenshots/02-capability-workspace-1440.png \
  artifacts/submission/screenshots/03-capability-spark-plan-1440.png \
  artifacts/submission/screenshots/04-assets-governance-provenance-1440.png \
  artifacts/submission/screenshots/05-method-architecture-1440.png \
  artifacts/submission/screenshots/06-capability-workspace-mobile-390.png \
  artifacts/submission/screenshots/07-architect-console-four-plane-1440.png \
  artifacts/submission/screenshots/08-architect-effective-access-1440.png \
  artifacts/submission/media/employee-workflow-capture-report.json \
  artifacts/submission/media/release-media-manifest.json \
  artifacts/submission/media/organizational-ai-memory-employee-workflow.mp4 \
  artifacts/submission/media/organizational-ai-memory-employee-workflow.webm \
  artifacts/submission/media/screenshots/employee-workflow/01-onboard-employee.png \
  artifacts/submission/media/screenshots/employee-workflow/02-created-pair-masked-link.png \
  artifacts/submission/media/screenshots/employee-workflow/03-immutable-plan-queued.png \
  artifacts/submission/media/screenshots/employee-workflow/04-revision-bound-confirmation.png \
  artifacts/submission/media/screenshots/employee-workflow/05-physical-provisioning-succeeded.png \
  artifacts/submission/media/screenshots/employee-workflow/06-active-pair-and-runtime-identity.png \
  artifacts/submission/media/screenshots/employee-workflow/07-private-workspace-activated.png \
  artifacts/submission/media/screenshots/employee-workflow/08-self-authored-work-profile.png \
  artifacts/submission/media/screenshots/employee-workflow/09-private-versioned-work-profile.png \
  artifacts/submission/media/screenshots/employee-workflow/10-explicit-profile-consent.png \
  artifacts/submission/media/screenshots/employee-workflow/11-capture-private-experience.png \
  artifacts/submission/media/screenshots/employee-workflow/12-private-memory-excluded.png \
  artifacts/submission/media/screenshots/employee-workflow/13-revision-bound-memory-consent.png \
  artifacts/submission/media/screenshots/employee-workflow/14-grounded-reuse-with-citation.png \
  artifacts/submission/media/screenshots/employee-workflow/15-edit-resets-agent-access.png \
  artifacts/submission/media/screenshots/employee-workflow/16-edited-version-excluded.png \
  artifacts/submission/media/screenshots/employee-workflow/17-current-version-reconsented.png \
  artifacts/submission/media/screenshots/employee-workflow/18-personal-agent-boundaries.png \
  artifacts/submission/media/screenshots/employee-workflow/19-personal-agent-boundaries-mobile.png \
  artifacts/submission/media/screenshots/employee-workflow/20-physical-agent-runtime-proof.png
```

Stage the separately manifested final judge-video package only after its offline
verifier and scene review pass:

Any future public recapture must first run outside the repository under a
no-secret unprivileged account with Chrome sandboxing enabled. The capture
script rejects UID 0. Never use `oam-codex` or an employee/agent identity for
browser capture. Review the schema-v2 report and its per-file hashes before a
trusted operator promotes only the six PNGs, WebM, and report into the source
directory. Rebuild and re-review all downstream media after promotion.

```bash
OAM_FINAL_VIDEO_VISUAL_REVIEW_CONFIRM=REVIEWED_ALL_FINAL_VIDEO_SCENES \
  node scripts/evaluation/verify_final_judge_videos.mjs --write-reviewed-report
node scripts/evaluation/verify_final_judge_videos.mjs --check
node scripts/evaluation/verify_final_judge_media_manifest.mjs
git add -- \
  artifacts/submission/ORGANIZATIONAL_AI_MEMORY_PITCH_DECK.html \
  artifacts/submission/media/final-judge-video \
  scripts/evaluation/build_final_judge_media_manifest.mjs \
  scripts/evaluation/build_final_judge_videos.mjs \
  scripts/evaluation/capture_final_judge_video_sources.mjs \
  scripts/evaluation/generate_final_judge_voiceovers.mjs \
  scripts/evaluation/verify_final_judge_media_manifest.mjs \
  scripts/evaluation/verify_final_judge_videos.mjs
```

The final manifest closes the allowed media set at 12 binary and 13 text
artifacts. The workshop recording, workshop frames/transcript, ElevenLabs key,
and local review state are not part of the repository.

The supporting employee-workflow WebM is the raw 42.12-second protected browser
capture; its MP4 is the 50.08-second supporting cut with the separate
physical-agent proof appended. They are different evidence stages, not
duplicate final exports. The separately manifested public-capability source
WebM is a different, sandboxed capture used only to build the final judge cuts.

The five capability-pack JSON files intentionally remain at that fixed path.
The strict importer and its regression tests depend on them. No Markdown from
the handoff directory is part of the product or publish set, apart from the
factual final handoff.

## 3. Audit the staged tree

Review every staged path before committing:

```bash
git status --short
git diff --cached --stat
git diff --cached --check
git diff --cached
```

Run targeted staged-content checks. Investigate every result; credentials,
private keys, live tokens, operator endpoints, and private topology must not be
published:

```bash
git grep --cached -n -i -E \
  '(BEGIN [A-Z ]*PRIVATE KEY|X-Goog-Api-Key|Authorization:[[:space:]]*Bearer|api[_-]?key[[:space:]]*=|password[[:space:]]*=|oam_employee_session|#access_token=)' \
  -- . || true

git grep --cached -n -E \
  '(^|[^0-9])(10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|192\.168\.[0-9]{1,3}\.[0-9]{1,3}|172\.(1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3})([^0-9]|$)' \
  -- . || true

git grep --cached -n -E \
  '(Wire[G]uard|plin[k][0-9a-z]*|root[@]|BEGIN OPENSSH PRIVATE KEY)' \
  -- . || true

git diff --cached --name-only | rg \
  '(^|/)(\.local-secrets|node_modules|auth\.json|credentials?|cookies?|session)(/|$)' \
  && { printf '%s\n' 'unsafe staged path'; exit 1; } || true
```

References to protected paths such as a model-authentication filename can be
intentional denial-probe fixtures. The file content and any credential value
must still be absent.

Remove an unsafe staged path with `git restore --staged -- <path>`, then repeat
the audit. That command does not delete the working file.

Commit only after the staged tree is understood:

```bash
git commit -m "Package Organizational AI Memory hackathon MVP"
git status --short
git log -1 --oneline --decorate
```

Record that commit, deploy that exact tree, and then record the installed source
digest. If either value changes, rerun protected proof, browser capture, and
media review; do not reuse evidence from the prior build.

## 4. Publish through the reviewed GitHub flow

Verify the configured destination and its public visibility before sending any
objects. Do not put a personal access token in the remote URL and do not create
or modify SSH keys for this publish step.

```bash
test "$(git remote get-url origin)" = \
  "https://github.com/SELLSYSTEMS/organizational_ai_memory.git"
gh repo view SELLSYSTEMS/organizational_ai_memory --json url,visibility
git ls-remote --heads origin
branch="$(git branch --show-current)"
test -n "$branch"
test "$branch" != main
git push --set-upstream origin "$branch"
gh pr create --draft --base main --head "$branch" --fill
gh pr checks --watch
```

After the diff and evidence are reviewed and required checks pass, mark the pull
request ready and merge without bypassing branch protection. If authentication
is unavailable, keep the local commits and record the exact remaining command.
Do not work around it with root credentials, copied auth state, embedded tokens,
or SSH changes.

## 5. Manual submission boundary

Source publishing does not perform any hackathon portal action. The following
remain operator-only:

1. creating the project draft
2. selecting or confirming the track
3. entering team and project metadata
4. uploading the repository, video, and screenshots
5. reviewing declarations and completing final submission

Final operator fields:

```text
repository URL:          https://github.com/SELLSYSTEMS/organizational_ai_memory
published commit:        verify with git rev-parse origin/main after merge
repository visibility:  public; reverify before each release
video URL:               not uploaded; local hashed MP4 prepared
submission timestamp:    [OPERATOR ONLY]
```
