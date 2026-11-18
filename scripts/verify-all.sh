#!/usr/bin/env bash
# Ordered gates. Names the next required action instead of a bare failure.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

step(){ printf '\n=== %s ===\n' "$1"; }
stop(){ printf '\nBLOCKED: %s\n' "$1"; exit 1; }

step "preflight"
node scripts/preflight.mjs || stop "preflight failed"

step "auth lifecycle regression (sandbox)"
node scripts/verify-auth.mjs || stop "auth regression failed — do not proceed"

step "build"
portrox build --all || stop "build failed"

step "render"
node scripts/verify-render.mjs || stop "render verification failed"

step "daemon"
node scripts/verify-daemon.mjs || stop "daemon verification failed"

step "credential strength gate"
WEAK="$(node -e 'import("./packages/cli/auth-store.mjs").then(m=>process.stdout.write(m.publicState().weakPassword?"yes":"no"))')"
echo "default password active: $WEAK"
[ "$WEAK" = "no" ] || stop "Studio password is still the shipped default. Open the Studio -> Settings -> Security -> Change credentials and set a new PASSWORD (changing only the username does not count)."

step "config precondition"
CFG="$(node -e 'import("./packages/cli/config-store.mjs").then(m=>{const c=m.loadConfig();const s=c.supabase||{},g=c.github||{};process.stdout.write([s.url?"sb":"-",s.user_id?"auth":"-",g.token?"gh":"-"].join(" "))})')"
echo "config: $CFG"
case "$CFG" in
  "sb auth gh") echo "all credentials present" ;;
  *) stop "Studio Setup incomplete. Open the Studio -> Settings -> Supabase (URL + key, then sign in) and GitHub (PAT)." ;;
esac

step "rpc (positive)"
node scripts/verify-rpc.mjs --positive || stop "RPC positive gate failed — Register then Publish the site in the Studio"

step "live"
node scripts/verify-live.mjs || stop "live site is not Portrox output yet — click Publish in the Studio"

step "secrets"
bash scripts/audit-secrets.sh || stop "secret audit failed"

printf '\nPORTROX PHASE 1 VERIFIED\n'
