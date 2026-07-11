# Publishing the Source Safely

Status: the target project has a local Git repository on branch `main`, a
non-personal local build identity, and no configured remote. No SSH key or SSH
configuration was created or changed.

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

Stage the public tree explicitly; do not use a blanket `git add .`:

```bash
git add -- \
  .gitignore LICENSE README.md DESIGN.md package.json package-lock.json \
  app config deploy scripts sql test docs \
  artifacts/design/DESIGN_REVIEW.md \
  artifacts/design/JUDGE_DEMO_CONCEPT_2026-07-11.png \
  artifacts/design/ARCHITECT_CONSOLE_CONCEPT_2026-07-11.png \
  artifacts/evaluation/identity-plane-proof \
  artifacts/evaluation/gpt-5.3-codex-spark-xhigh-release-review.md \
  artifacts/qa/browser/report.json \
  artifacts/submission \
  handoff/FINAL_HACKATHON_MVP_HANDOFF_2026-07-10.md \
  handoff/aihackathon_public_safe_asset_pack_2026-07-10/assets.json \
  handoff/aihackathon_public_safe_asset_pack_2026-07-10/asset_bodies_v2.json \
  handoff/aihackathon_public_safe_asset_pack_2026-07-10/recommendations.json \
  handoff/aihackathon_public_safe_asset_pack_2026-07-10/analytics.json \
  handoff/aihackathon_public_safe_asset_pack_2026-07-10/source_turns.json
```

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
  '(BEGIN [A-Z ]*PRIVATE KEY|X-Goog-Api-Key|Authorization:[[:space:]]*Bearer|api[_-]?key[[:space:]]*=|password[[:space:]]*=)' \
  -- . || true

git grep --cached -n -E \
  '(^|[^0-9])(10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|192\.168\.[0-9]{1,3}\.[0-9]{1,3}|172\.(1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3})([^0-9]|$)' \
  -- . || true

git grep --cached -n -E \
  '(WireGuard|plink[0-9a-z]*|root@|BEGIN OPENSSH PRIVATE KEY)' \
  -- . || true
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
