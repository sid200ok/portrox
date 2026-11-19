#!/usr/bin/env bash
# Release gate. A red suite was committed once with a message claiming it was
# green. This makes that impossible: verify-all must exit 0 before any commit.
#   bash scripts/release.sh "commit message"
set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MSG="${1:-}"
[ -n "$MSG" ] || { echo "usage: bash scripts/release.sh \"commit message\""; exit 2; }

echo "== backup =="
node scripts/backup-db.mjs || { echo "BLOCKED: backup failed"; exit 1; }

echo "== publish =="
node scripts/publish-site.mjs || { echo "BLOCKED: publish failed"; exit 1; }

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
  echo "RELEASE OK (nothing to commit; suite green)"
  exit 0
fi
git add -A
git commit -m "$MSG" || exit 1
git push origin main || exit 1
echo "RELEASE OK"
