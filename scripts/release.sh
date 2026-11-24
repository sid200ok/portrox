#!/usr/bin/env bash
# Release gate. A red suite was committed once with a message claiming it was
# green. This makes that impossible: verify-all must exit 0 before any commit.
#
# Offsite backup is now PART of the release. Previously release.sh only wrote a
# local backup, so every release after the first manual offsite run silently
# regressed durability: backups/ dies with the disk.
#
# Passphrase resolution, in order:
#   1. $PORTROX_BACKUP_PASSPHRASE
#   2. ~/.portrox/backup-passphrase (0600)  -> warns you to shred it
#   3. silent `read -rs` prompt if stdin is a terminal
#   4. otherwise OFFSITE SKIPPED, loudly, and the summary says so
# Set PORTROX_SKIP_OFFSITE=1 to skip deliberately.
#
#   bash scripts/release.sh "commit message"
set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MSG="${1:-}"
[ -n "$MSG" ] || { echo "usage: bash scripts/release.sh \"commit message\""; exit 2; }

OFFSITE_STATE="skipped"
PP_CUSTODY="absent"
PP_FILE="$HOME/.portrox/backup-passphrase"

echo "== local backup =="
node scripts/backup-db.mjs || { echo "BLOCKED: local backup failed"; exit 1; }

echo "== offsite backup =="
# No terminal secret prompts. The key is generated and held by the Studio.
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

echo "== publish =="
node scripts/publish-site.mjs || { echo "BLOCKED: publish failed"; exit 1; }

echo "== daemon =="
# publish uses the modules directly and needs no daemon, but verify-daemon does.
# After a WSL restart the process is gone and state.json is stale, which blocked
# the release with ten misleading product failures. restart refuses to signal a
# recycled PID and clears stale state. `start` is now health-aware: it keeps a
# healthy daemon and its port, and respawns only if the PID is ours but silent.
node packages/cli/portrox.mjs start || { echo "BLOCKED: daemon would not start"; exit 1; }
sleep 1

echo "== full suite =="
bash scripts/verify-all.sh
RC=$?
if [ "$RC" -ne 0 ]; then
  echo "BLOCKED: verify-all exited $RC - nothing committed"
  exit 1
fi

echo "== inventory =="
node scripts/inventory.mjs

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
