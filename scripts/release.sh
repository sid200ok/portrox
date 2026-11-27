#!/usr/bin/env bash
# Release gate. A red suite was committed once with a message claiming it was
# green. This makes that impossible: verify-all must exit 0 before any commit.
#
# ORDER, corrected 2026-11-27 after reading this file:
#   local backup -> daemon -> suite (pre-publish) -> inventory -> publish
#   -> live gate -> offsite backup -> commit + push
#
# The previous order published the site AND pushed an encrypted offsite bundle
# BEFORE running the suite. A red run therefore left a live publish and an
# immutable offsite commit containing verification residue, while only the git
# commit was blocked. Verification now precedes every irreversible action.
#
# The live gate compares the published site to dist/, so it cannot run before
# publish. verify-all.sh honours PORTROX_SKIP_LIVE=1 and defers that one step to
# this script, which runs it immediately after publish.
#
# Offsite key custody: the key is generated and held by the Studio key store
# (~/.portrox/backup-key.json, 0600). No terminal secret prompt, no plaintext
# passphrase file, no secret in argv. Set PORTROX_SKIP_OFFSITE=1 to skip on
# purpose; otherwise a missing key is reported loudly and the summary says so.
#
#   bash scripts/release.sh "commit message"
set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MSG="${1:-}"
[ -n "$MSG" ] || { echo "usage: bash scripts/release.sh \"commit message\""; exit 2; }

OFFSITE_STATE="skipped"
PP_CUSTODY="absent"

echo "== local backup =="
node scripts/backup-db.mjs || { echo "BLOCKED: local backup failed"; exit 1; }

echo "== daemon =="
# publish uses the modules directly and needs no daemon, but verify-daemon does.
# After a WSL restart the process is gone and state.json is stale. restart refuses
# to signal a recycled PID and clears stale state; start is health-aware.
node packages/cli/portrox.mjs start || { echo "BLOCKED: daemon would not start"; exit 1; }
sleep 1

echo "== full suite (pre-publish) =="
PORTROX_SKIP_LIVE=1 bash scripts/verify-all.sh
RC=$?
if [ "$RC" -ne 0 ]; then
  echo "BLOCKED: verify-all exited $RC"
  echo "Nothing published. Nothing pushed offsite. Nothing committed."
  exit 1
fi

echo "== inventory =="
node scripts/inventory.mjs

echo "== publish =="
node scripts/publish-site.mjs || { echo "BLOCKED: publish failed"; exit 1; }

echo "== live artifact =="
node scripts/run-gate.mjs scripts/verify-live.mjs || {
  echo "BLOCKED: the live site does not match the verified build - nothing committed, no offsite push"; exit 1; }

echo "== offsite backup =="
if [ "${PORTROX_SKIP_OFFSITE:-0}" = "1" ]; then
  echo "OFFSITE SKIPPED (PORTROX_SKIP_OFFSITE=1)"
  OFFSITE_STATE="skipped by request"
elif node -e 'import("./packages/cli/backup-key.mjs").then(m=>process.exit(m.hasKey()?0:1))'; then
  PP_CUSTODY="Studio key store (~/.portrox/backup-key.json, 0600)"
  if node scripts/backup-offsite.mjs; then OFFSITE_STATE="done"
  else echo "BLOCKED: offsite backup failed"; exit 1; fi
else
  echo "OFFSITE SKIPPED - no key in the store."
  echo "ACTION: Studio -> Settings -> Backup -> Generate key, save it to your password manager, confirm."
  OFFSITE_STATE="SKIPPED (no key - see Studio Settings Backup)"
fi

if [ -z "$(git status --porcelain)" ]; then
  echo "RELEASE OK (nothing to commit; suite green; offsite: $OFFSITE_STATE)"
  echo "passphrase custody: $PP_CUSTODY"
  exit 0
fi
git add -A
git commit -m "$MSG" || exit 1
git push origin main || exit 1
echo "RELEASE OK (offsite: $OFFSITE_STATE)"
echo "passphrase custody: $PP_CUSTODY"
