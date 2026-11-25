#!/usr/bin/env bash
# Ordered gates. Names the next required action instead of a bare failure.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

step(){ printf '\n=== %s ===\n' "$1"; }
stop(){ printf '\nBLOCKED: %s\n' "$1"; exit 1; }

step "preflight"
node scripts/run-gate.mjs scripts/preflight.mjs || stop "preflight failed"

step "emitted browser script"
node scripts/run-gate.mjs scripts/verify-ui.mjs || stop "emitted UI script invalid — pages would render empty"

step "supabase management surface"
node scripts/run-gate.mjs scripts/verify-supabase.mjs || stop "Supabase Management API gate failed"

step "github operations surface"
node scripts/run-gate.mjs scripts/verify-github.mjs --write || stop "GitHub operations gate failed"

step "auth lifecycle regression (sandbox)"
node scripts/run-gate.mjs scripts/verify-auth.mjs || stop "auth regression failed"

step "build"
portrox build --all || stop "build failed"

step "render"
node scripts/run-gate.mjs scripts/verify-render.mjs || stop "render verification failed"

step "checkout reference loop"
node scripts/run-gate.mjs scripts/verify-checkout.mjs || stop "checkout reference loop is unsafe"

step "AI task execution"
node scripts/run-gate.mjs scripts/verify-ai-tasks.mjs || stop "AI task execution is unsafe"

step "payment registry and signatures"
node scripts/run-gate.mjs scripts/verify-payments.mjs || stop "payment registry or signature verification is wrong"

step "AI provider flow"
node scripts/run-gate.mjs scripts/verify-ai-provider.mjs || stop "AI provider flow is not provable"

step "intro wizard"
node scripts/run-gate.mjs scripts/verify-intro.mjs || stop "intro wizard breaks the homepage heading invariant"

step "media round trip"
node scripts/run-gate.mjs scripts/verify-media.mjs || stop "media pipeline does not round-trip safely"

step "inbox round trip"
node scripts/run-gate.mjs scripts/verify-inbox.mjs || stop "inbox does not round-trip safely"

step "content editor round trip"
node scripts/run-gate.mjs scripts/verify-content-api.mjs || stop "content store does not round-trip safely"

step "content structure"
node scripts/run-gate.mjs scripts/verify-content.mjs || stop "rendered content has structural defects (duplicate h1, broken refs, missing meta)"

step "daemon"
node scripts/run-gate.mjs scripts/verify-daemon.mjs || stop "daemon verification failed"

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
node scripts/run-gate.mjs scripts/verify-rpc.mjs --positive || stop "RPC positive gate failed — Register then Publish the site in the Studio"

step "database audit (grants, RLS, future booking)"
node scripts/run-gate.mjs scripts/audit-db.mjs || stop "database audit failed - grants, RLS or booking are not provably correct"

step "restore proof (scratch schema)"
node scripts/run-gate.mjs scripts/restore-db.mjs || stop "latest backup is not restorable"

step "probe cleanup"
node scripts/run-gate.mjs scripts/clean-probes.mjs || stop "probe cleanup failed - production inbox is accumulating test rows"

step "contact consistency"
node scripts/run-gate.mjs scripts/check-contact.mjs || stop "contact details disagree across site profiles and documents"

step "profile handle"
node scripts/run-gate.mjs scripts/check-profile.mjs || stop "profile links do not match the authenticated GitHub handle"

step "live"
node scripts/run-gate.mjs scripts/verify-live.mjs || stop "live site is not Portrox output yet — click Publish in the Studio"

step "secrets"
bash scripts/audit-secrets.sh || stop "secret audit failed"

printf '\nPORTROX PHASE 1 VERIFIED\n'
