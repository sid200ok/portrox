#!/usr/bin/env bash
# Release gate. A red suite was committed once with a message claiming it was
# green. verify-all must exit 0 before anything irreversible happens.
#
# ORDER, corrected twice, each time from an observed failure:
#   local backup -> daemon -> normalise -> suite (pre-publish) -> inventory
#   -> COMMIT -> publish -> live gate -> offsite backup -> PUSH
#
# Why COMMIT moved before publish: the previous order published the site AND
# pushed an encrypted offsite bundle, then let end-of-file-fixer abort the commit.
# Production ended up AHEAD of version control - a live artifact that no commit
# described. Every irreversible action must follow the commit, so the only
# possible divergence is repo-ahead-of-live, which is recoverable.
#
# Why normalise runs early: pre-commit exits non-zero when a hook MODIFIES a file.
# That is a fix, not a defect, but it aborts `git commit`. Cheap deterministic
# checks belong before the first irreversible action, not after it. The commit
# also retries ONCE, and only for the documented "files were modified" case.
#
# The live gate compares the published site to dist/, so it cannot run before
# publish. verify-all.sh honours PORTROX_SKIP_LIVE=1 and defers that one step here.
#
# Offsite key custody: generated and held by the Studio key store
# (~/.portrox/backup-key.json, 0600). No terminal secret prompt, no plaintext
# passphrase file, no secret in argv. PORTROX_SKIP_OFFSITE=1 skips deliberately.
#
#   bash scripts/release.sh "commit message"
set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MSG="${1:-}"
[ -n "$MSG" ] || { echo "usage: bash scripts/release.sh \"commit message\""; exit 2; }

OFFSITE_STATE="skipped"
PP_CUSTODY="absent"
COMMITTED="no"; PUBLISHED="no"; LIVE_OK="no"; PUSHED="no"

state() {
  echo "---- release state ----"
  echo "committed=$COMMITTED  published=$PUBLISHED  live=$LIVE_OK  offsite=$OFFSITE_STATE  pushed=$PUSHED"
}
die() { echo "BLOCKED: $1"; state; exit 1; }

echo "== local backup =="
node scripts/backup-db.mjs || die "local backup failed"

echo "== daemon =="
# publish uses the modules directly, but verify-daemon needs a live process.
# start is health-aware and refuses to signal a recycled PID.
node packages/cli/portrox.mjs start || die "daemon would not start"
sleep 1

echo "== normalise (before anything irreversible) =="
if command -v pre-commit >/dev/null 2>&1; then
  if pre-commit run --all-files >/tmp/portrox-normalise.log 2>&1; then
    echo "OK   formatting hooks clean"
  else
    echo "NOTE hooks modified files on the first pass - re-running to confirm idempotence"
    pre-commit run --all-files >>/tmp/portrox-normalise.log 2>&1 \
      || { tail -30 /tmp/portrox-normalise.log; die "formatting hooks still fail after auto-fix"; }
    echo "OK   tree normalised, hooks now idempotent"
  fi
else
  echo "NOTE pre-commit not on PATH - the commit hook will still run, with one auto-fix retry"
fi

echo "== full suite (pre-publish) =="
PORTROX_SKIP_LIVE=1 bash scripts/verify-all.sh \
  || die "verify-all failed - nothing committed, nothing published, nothing pushed"

echo "== inventory =="
node scripts/inventory.mjs

echo "== commit (before publish, so every live artifact has a commit) =="
if [ -z "$(git status --porcelain)" ]; then
  echo "NOTE nothing to commit - releasing the existing HEAD"
else
  git add -A || die "git add failed"
  if git commit -m "$MSG" >/tmp/portrox-commit.log 2>&1; then
    COMMITTED="yes"
  elif grep -q 'files were modified by this hook' /tmp/portrox-commit.log; then
    echo "NOTE a hook auto-fixed files - re-staging and retrying ONCE"
    git add -A
    git commit -m "$MSG" >>/tmp/portrox-commit.log 2>&1 \
      || { cat /tmp/portrox-commit.log; die "git commit failed after the auto-fix retry"; }
    COMMITTED="yes"
  else
    cat /tmp/portrox-commit.log
    die "git commit failed - nothing published, nothing pushed"
  fi
  echo "OK   committed $(git rev-parse --short HEAD)"
fi

echo "== publish =="
node scripts/publish-site.mjs \
  || die "publish failed - the commit exists locally but nothing shipped; fix and re-run, do not push"
PUBLISHED="yes"

echo "== live artifact =="
node scripts/run-gate.mjs scripts/verify-live.mjs \
  || die "the live site does not match the verified build - committed and published, NOT pushed"
LIVE_OK="yes"

echo "== offsite backup =="
if [ "${PORTROX_SKIP_OFFSITE:-0}" = "1" ]; then
  echo "OFFSITE SKIPPED (PORTROX_SKIP_OFFSITE=1)"
  OFFSITE_STATE="skipped by request"
elif node -e 'import("./packages/cli/backup-key.mjs").then(m=>process.exit(m.hasKey()?0:1))'; then
  PP_CUSTODY="Studio key store (~/.portrox/backup-key.json, 0600)"
  if node scripts/backup-offsite.mjs; then OFFSITE_STATE="done"
  else die "offsite backup failed - published and live, but not backed up offsite"; fi
else
  echo "OFFSITE SKIPPED - no key in the store."
  echo "ACTION: Studio -> Settings -> Backup -> Generate key, save it to your password manager, confirm."
  OFFSITE_STATE="SKIPPED (no key - see Studio Settings Backup)"
fi

# The publisher may record registration/publish state in site.json. Capture it so
# the pushed tree is exactly what produced the live artifact.
if [ -n "$(git status --porcelain)" ]; then
  echo "== publish state =="
  git add -A && git commit -m "chore(release): publish state recorded by the publisher" \
    || die "publish-state commit failed"
fi

echo "== push =="
git push origin main || die "git push failed - published, live and committed locally; push when connectivity returns"
PUSHED="yes"

echo "RELEASE OK (offsite: $OFFSITE_STATE)"
echo "passphrase custody: $PP_CUSTODY"
state
