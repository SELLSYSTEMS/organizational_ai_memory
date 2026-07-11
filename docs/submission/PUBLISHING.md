# Publishing the Source Safely

Status: the target project has a local Git repository on branch `main`, a
non-personal local build identity, and no configured remote. No SSH key or SSH
configuration was created or changed.

The current Personal Memory Agent release is installed and freshly verified.
Future changes must repeat that install/proof/capture sequence; a source commit
alone is not live proof.

These instructions preserve a reviewable public tree without inventing a
repository destination or exposing target-only material.

## 1. Confirm the local repository

Run only from the project root:

```bash
cd /home/admin/organizational-ai-memory
test "$(pwd -P)" = "/home/admin/organizational-ai-memory"
test -d .git
test "$(git branch --show-current)" = "main"
git config --local --get user.name
git config --local --get user.email
git remote -v
```

An empty `git remote -v` result is expected until an operator supplies a
destination. Do not reinitialize the repository and do not replace the local
identity with root authentication.

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
  .gitignore LICENSE README.md DESIGN.md package.json package-lock.json \
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

The WebM is the raw 42.12-second browser capture; the MP4 is the 50.08-second
submission cut with the separate physical-agent proof appended. They are
different evidence stages, not duplicate final exports.

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
  '(WireGuard|plink[0-9a-z]*|root@|BEGIN OPENSSH PRIVATE KEY)' \
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

## 4. Add only an operator-provided remote

Do not guess an organization, repository name, visibility, or destination. Do
not put a personal access token in a remote URL and do not create or modify SSH
keys for this publish step.

```bash
REMOTE_URL='<operator-provided remote URL>'
test -n "$REMOTE_URL"
git remote add origin "$REMOTE_URL"
git remote -v
git ls-remote --heads origin
```

The operator must verify that `origin` is the intended repository and that its
visibility is appropriate for the audited content. Then push through the
operator's existing credential mechanism:

```bash
git push --set-upstream origin main
git ls-remote --heads origin main
```

If authentication is unavailable, keep the local commits and record the exact
remaining push command. Do not work around it with root credentials, copied
auth state, embedded tokens, or SSH changes.

## 5. Manual submission boundary

Source publishing does not perform any hackathon portal action. The following
remain operator-only:

1. creating the project draft
2. selecting or confirming the track
3. entering team and project metadata
4. uploading the repository, video, and screenshots
5. reviewing declarations and completing final submission

Record the final remote URL only after a push has been verified.

Final operator fields:

```text
repository URL:          not configured; operator must provide and verify remote
published commit:        not published; local release prepared
repository visibility:  not selected by operator
video URL:               not uploaded; local hashed MP4 prepared
submission timestamp:    [OPERATOR ONLY]
```
