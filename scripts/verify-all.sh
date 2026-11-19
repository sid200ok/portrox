#!/usr/bin/env bash
# Ordered gates. Names the next required action instead of a bare failure.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

step(){ printf '\n=== %s ===\n' "$1"; }
stop(){ printf '\nBLOCKED: %s\n' "$1"; exit 1; }

step "preflight"
node scripts/preflight.mjs || stop "preflight failed"

step "emitted browser script"
node scripts/verify-ui.mjs || stop "emitted UI script invalid — pages would render empty"

step "supabase management surface"
node scripts/verify-supabase.mjs || stop "Supabase Management API gate failed"

step "github operations surface"
node scripts/verify-github.mjs || stop "GitHub operations gate failed"

step "auth lifecycle regression (sandbox)"
node scripts/verify-auth.mjs || stop "auth regression failed"

step "build"
portrox build --all || stop "build failed"

step "render"
node scripts/verify-render.mjs || stop "render verification failed"

step "daemon"
node scripts/verify-daemon.mjs || stop "daemon verification failed"

step "credential strength gate"
WEAK="$(node -e 'import("./packages/cli/auth-store.mjs").then(m=>process.stdout.write(m.publicState().weakPassword?"yes":"no"))')"
echo "default password active: $WEAK"
[ "$WEAK" = "no" ] || stop "Studio password is still the default. Settings -> Security -> Change credentials, set a new PASSWORD (a username change does not count)."

step "config precondition"
CFG="$(node -e 'import("./packages/cli/config-store.mjs").then(m=>{const c=m.loadConfig();const s=c.supabase||{},g=c.github||{};process.stdout.write([s.access_token?"sb":"-",Object.keys(s.projects||{}).length?"proj":"-",(g.token||g.login)?"gh":"-"].join(" "))})')"
echo "config: $CFG"
case "$CFG" in
  "sb proj gh") echo "all credentials present" ;;
  *) stop "Setup incomplete. Settings -> Supabase account (paste sbp_ token, validate) -> bind/apply a project to the site -> Settings -> GitHub (PAT)." ;;
esac

step "rpc (positive)"
node scripts/verify-rpc.mjs --positive || stop "RPC positive gate failed — Register then Publish the site in the Studio"

step "probe cleanup"
node scripts/clean-probes.mjs || stop "probe cleanup failed - production inbox is accumulating test rows"

step "profile handle"
node scripts/check-profile.mjs || stop "profile links do not match the authenticated GitHub handle"

step "live"
node scripts/verify-live.mjs || stop "live site is not Portrox output yet — click Publish in the Studio"

step "secrets"
bash scripts/audit-secrets.sh || stop "secret audit failed"

printf '\nPORTROX PHASE 1 VERIFIED\n'
