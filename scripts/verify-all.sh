#!/usr/bin/env bash
# Runs every gate in dependency order and names the next required action.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

step(){ printf '\n=== %s ===\n' "$1"; }
stop(){ printf '\nBLOCKED: %s\n' "$1"; exit 1; }

step "preflight"
node scripts/preflight.mjs || stop "preflight failed"

step "build"
portrox build --all || stop "build failed"

step "render"
node scripts/verify-render.mjs || stop "render verification failed"

step "daemon"
node scripts/verify-daemon.mjs || stop "daemon verification failed"

step "config precondition"
CFG="$(node -e 'const fs=require("fs"),os=require("os"),p=require("path");const f=p.join(process.env.PORTROX_HOME||p.join(os.homedir(),".portrox"),"config.json");if(!fs.existsSync(f)){process.stdout.write("none");process.exit(0)}const c=JSON.parse(fs.readFileSync(f,"utf8"));const s=c.supabase||{},g=c.github||{};process.stdout.write([s.url?"sb":"-",s.user_id?"auth":"-",g.token?"gh":"-"].join(" "))')"
echo "config: $CFG"
case "$CFG" in
  "sb auth gh") echo "all credentials present" ;;
  *) stop "Studio Setup incomplete. Run: portrox status -> open URL -> Setup (Supabase URL+key, sign-in, GitHub PAT). Then Register -> Publish." ;;
esac

step "rpc (positive)"
node scripts/verify-rpc.mjs --positive || stop "RPC positive gate failed — Register/Publish the site in the Studio"

step "live"
node scripts/verify-live.mjs || stop "live site is not Portrox output yet — click Publish in the Studio"

step "secrets"
bash scripts/audit-secrets.sh || stop "secret audit failed"

printf '\nPORTROX PHASE 1 VERIFIED\n'
