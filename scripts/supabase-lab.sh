#!/usr/bin/env bash
# Portrox Supabase Lab v4 — terminal mirror of Studio actions.
# HARD RULES:
#   - No secret in argv. curl reads a 0600 config; psql reads PGPASSWORD from env.
#   - Every sourced file is single-quote escaped. Never source raw data.
#   - apply/key/create/health delegate to scripts/supabase-ops.mjs, which uses the
#     SAME modules as the daemon. That is what makes the mirror true.
set -uo pipefail
REPO="$(cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)" && pwd)"
cd "$REPO"
MOD="${1:-help}"; WANT_REF="${2:-}"
hr(){ printf '\n\033[1m── %s ──\033[0m\n' "$*"; }
note(){ printf '  \033[36mLEARN\033[0m %s\n' "$*"; }
ui(){ printf '  \033[35mUI MIRROR\033[0m %s\n' "$*"; }
warn(){ printf '  \033[33mWARN\033[0m %s\n' "$*"; }
die(){ printf '\033[31mFAIL\033[0m %s\n' "$*" >&2; exit 1; }

# One wrapper. Never treat a multi-word string as an executable.
sb_run(){ if [ -x "$REPO/node_modules/.bin/supabase" ]; then "$REPO/node_modules/.bin/supabase" "$@"; else npx --yes supabase@3.1.0 "$@"; fi; }
ops(){ node "$REPO/scripts/supabase-ops.mjs" "$@"; }

MODULES="doctor env account create link key bootstrap push-all reconcile health advisor connect rls rest rpc inbox services lifecycle cleanup all"
show_help(){
  hr "Portrox Supabase Lab v4"
  printf '  %-12s %s\n' "doctor"    "which UI field unlocks which module"
  printf '  %-12s %s\n' "env"       "endpoints + credential presence (no secrets)"
  printf '  %-12s %s\n' "account"   "orgs + projects          [Validate and load projects]"
  printf '  %-12s %s\n' "create"    "create+wait+key+bootstrap [New project]"
  printf '  %-12s %s\n' "link"      "bind repo to one project [Project binding]"
  printf '  %-12s %s\n' "key"       "fetch AND STORE key      [Fetch key]"
  printf '  %-12s %s\n' "bootstrap" "Portrox schema + record  [Bootstrap]"
  printf '  %-12s %s\n' "push-all"  "FULL history (sample project only)"
  printf '  %-12s %s\n' "reconcile" "record CLI-applied migrations"
  printf '  %-12s %s\n' "health"    "service health           [Health]"
  printf '  %-12s %s\n' "advisor"   "security + performance"
  printf '  %-12s %s\n' "connect"   "psql introspection       (stored DB password)"
  printf '  %-12s %s\n' "rls"       "RLS demo (asks confirmation; writes to the bound project)"
  printf '  %-12s %s\n' "rest"      "PostgREST reads + denied write"
  printf '  %-12s %s\n' "rpc"       "SECURITY DEFINER intake"
  printf '  %-12s %s\n' "inbox"     "read submissions         [Inbox]"
  printf '  %-12s %s\n' "services"  "storage/functions/secrets surface"
  printf '  %-12s %s\n' "lifecycle" "read-only project + inspect surface"
  printf '  %-12s %s\n' "cleanup"   "drop lab objects"
  printf '  %-12s %s\n' "all"       "env account key bootstrap reconcile health advisor rest"
  echo; echo "  Optional 2nd argument: a project ref."
}
[ "$MOD" = "help" ] && { show_help; exit 0; }
case " $MODULES " in *" $MOD "*) : ;; *) show_help; exit 1 ;; esac

LABDIR="$(mktemp -d "${TMPDIR:-/tmp}/portrox-lab.XXXXXX")"
chmod 700 "$LABDIR"
trap 'rm -rf "$LABDIR"' EXIT INT TERM

cat > "$LABDIR/env.mjs" <<'ENVEOF'
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const repo = process.argv[2], want = process.argv[3] || '', dir = process.argv[4];
const m = await import(pathToFileURL(join(repo, 'packages/cli/config-store.mjs')).href);
const c = m.loadConfig();
const ref = want || c.supabase.default_project_ref || Object.keys(c.supabase.projects)[0] || '';
if (!ref) { console.error('No project. Studio -> Settings -> Supabase account -> validate token -> Refresh projects.'); process.exit(1); }
const p = c.supabase.projects[ref];
if (!p) { console.error('Unknown ref: ' + ref); process.exit(1); }
// Single-quote escaper for EVERYTHING that will be sourced by bash.
const q = v => "'" + String(v == null ? '' : v).replace(/'/g, "'\\''") + "'";
// curl config escaper: backslash and double quote are special inside "…".
const cq = v => String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
writeFileSync(join(dir, 'env.sh'), [
  'export LAB_REF=' + q(ref),
  'export LAB_URL=' + q(p.url || 'https://' + ref + '.supabase.co'),
  'export LAB_ORG=' + q(p.organization_slug || ''),
  'export LAB_SCHEMA_FILES=' + q((p.schema_applied || []).length),
  'export LAB_SCHEMA_COMPLETE=' + q(m.schemaComplete(p) ? 'yes' : 'no'),
  'export LAB_SCHEMA_MISSING=' + q(m.schemaMissing(p).join(' ')),
  'export LAB_HAS_KEY=' + q(p.publishable_key ? 'yes' : 'no'),
  'export LAB_HAS_TOKEN=' + q(c.supabase.access_token ? 'yes' : 'no'),
  'export LAB_HAS_PW=' + q(p.db_password_stored && p.db_password ? 'yes' : 'no'),
  'export PGHOST=' + q('db.' + ref + '.supabase.co'),
  'export PGPORT=5432', 'export PGUSER=postgres', 'export PGDATABASE=postgres',
  'export PGSSLMODE=verify-full', 'export PGCONNECT_TIMEOUT=10', 'export PGAPPNAME=portrox-lab'
].join('\n') + '\n', { mode: 0o600 });
// A1 FIX: escaped, because this file is SOURCED.
writeFileSync(join(dir, 'pg.env'), 'PGPASSWORD=' + q(p.db_password || '') + '\n', { mode: 0o600 });
writeFileSync(join(dir, 'token.env'), 'SUPABASE_ACCESS_TOKEN=' + q(c.supabase.access_token || '') + '\n', { mode: 0o600 });
const cfg = lines => lines.join('\n') + '\n';
writeFileSync(join(dir, 'mgmt.curl'), cfg([
  'header = "Authorization: Bearer ' + cq(c.supabase.access_token || '') + '"',
  'header = "Accept: application/json"',
  'user-agent = "portrox-lab"'
]), { mode: 0o600 });
writeFileSync(join(dir, 'rest.curl'), cfg([
  'header = "apikey: ' + cq(p.publishable_key || '') + '"',
  'header = "Authorization: Bearer ' + cq(p.publishable_key || '') + '"',
  'header = "Content-Type: application/json"',
  'user-agent = "portrox-lab"'
]), { mode: 0o600 });
ENVEOF
node "$LABDIR/env.mjs" "$REPO" "$WANT_REF" "$LABDIR" || die "env resolution failed"
# shellcheck disable=SC1091
. "$LABDIR/env.sh"

MG(){ curl -sS --config "$LABDIR/mgmt.curl" "$@"; }
REST(){ curl -sS --config "$LABDIR/rest.curl" "$@"; }
SQL(){ ( set -a; . "$LABDIR/pg.env"; set +a; printf '%s\n' "$1" | psql -q -At -v ON_ERROR_STOP=1 -f - ); }
API_SQL(){ node -e 'const fs=require("fs");process.stdout.write(JSON.stringify({query:fs.readFileSync(process.argv[1],"utf8")}))' "$1" > "$LABDIR/body.json"
  MG -X POST -H 'Content-Type: application/json' --data-binary "@$LABDIR/body.json" "https://api.supabase.com/v1/projects/$LAB_REF/database/query"; }
need_pw(){ [ "$LAB_HAS_PW" = yes ] || { note "skipped: DB password not stored"; return 1; }; }
need_key(){ [ "$LAB_HAS_KEY" = yes ] || { note "skipped: no publishable key (run: key)"; return 1; }; }
need_tok(){ [ "$LAB_HAS_TOKEN" = yes ] || { note "skipped: no Management token (Studio › Settings › Supabase account)"; return 1; }; }

m_doctor(){
  hr "Which UI field unlocks which module"
  printf '  %-12s %s\n' "MODULE" "REQUIRED INPUT"
  printf '  %-12s %s\n' "env doctor"  "a bound project in the store"
  printf '  %-12s %s\n' "rest rpc"    "publishable key"
  printf '  %-12s %s\n' "account"     "sbp_ token"
  printf '  %-12s %s\n' "create"      "sbp_ token (+ --org slug)"
  printf '  %-12s %s\n' "key"         "sbp_ token"
  printf '  %-12s %s\n' "bootstrap"   "sbp_ token"
  printf '  %-12s %s\n' "health"      "sbp_ token"
  printf '  %-12s %s\n' "advisor"     "sbp_ token"
  printf '  %-12s %s\n' "inbox"       "sbp_ token"
  printf '  %-12s %s\n' "link"        "sbp_ token"
  printf '  %-12s %s\n' "push-all"    "sbp_ token + CLI login (SAMPLE ONLY)"
  printf '  %-12s %s\n' "reconcile"   "bound project + the CLI's OWN login"
  printf '  %-12s %s\n' "connect"     "stored DB password"
  printf '  %-12s %s\n' "rls cleanup" "stored DB password OR sbp_ token"
  echo
  echo "  account token   : $LAB_HAS_TOKEN"
  echo "  publishable key : $LAB_HAS_KEY"
  echo "  db password     : $LAB_HAS_PW"
  echo "  schema complete : $LAB_SCHEMA_COMPLETE  (files recorded: $LAB_SCHEMA_FILES)"
  [ -n "$LAB_SCHEMA_MISSING" ] && echo "  schema missing  : $LAB_SCHEMA_MISSING"
  note "apply/key/create/health call scripts/supabase-ops.mjs — the same modules the daemon uses."
}
m_env(){
  hr "Module · environment"; ui "Settings › Supabase account (read-only)"
  echo "project ref     : $LAB_REF"
  echo "REST base       : $LAB_URL/rest/v1"
  echo "auth base       : $LAB_URL/auth/v1"
  echo "org slug        : ${LAB_ORG:-(load via account)}"
  echo "schema complete : $LAB_SCHEMA_COMPLETE"
  note "GitHub Pages HOSTS the site. Supabase is the BACKEND API. Neither needs this laptop on."
}
m_account(){
  hr "Module · account"; need_tok || return 0
  ui "Settings › Supabase account › Validate and load projects"
  echo "-- organisations --"; MG https://api.supabase.com/v1/organizations; echo
  echo "-- projects --"; MG https://api.supabase.com/v1/projects | head -c 2000; echo
  note "One account token drives MANY projects. Free plan allows 2 ACTIVE projects."
}
m_create(){
  hr "Module · create project"; need_tok || return 0
  ui "Studio › New project"
  shift 2>/dev/null || true
  ops create "$@"
  note "Password goes to a 0600 file named after the NEW ref. Supabase cannot rotate it via API."
  note "The project is recorded in the store, keyed, and bootstrapped before this returns."
}
m_link(){
  hr "Module · link"; need_tok || return 0
  ui "Project binding › Default"
  ( set -a; . "$LABDIR/token.env"; set +a; sb_run link --project-ref "$LAB_REF" 2>&1 | tail -10 )
  note "link binds THIS repo to ONE project. The Portrox store binds each SITE independently."
}
m_key(){
  hr "Module · fetch AND STORE key"; need_tok || return 0
  ui "Project binding › Fetch key"
  ops key "$LAB_REF"
  note "reveal=true is used server-side; only the publishable key is stored, only the tail is printed."
}
m_bootstrap(){
  hr "Module · bootstrap"; need_tok || return 0
  ui "Project binding › Bootstrap"
  ops apply "$LAB_REF"
  note "Same code path as the UI, including recording supabase_migrations rows."
}
m_pushall(){
  hr "Module · push-all (SAMPLE PROJECT ONLY)"; need_tok || return 0
  warn "Applies EVERY migration, including legacy tables and GRANT ALL TO anon."
  printf 'Type the project ref to confirm: '; read -r C
  [ "$C" = "$LAB_REF" ] || die "not confirmed"
  ( set -a; . "$LABDIR/token.env"; set +a; sb_run db push --yes 2>&1 | tail -20 )
  node "$REPO/scripts/reconcile-schema.mjs" "$LAB_REF" || true
  note "Applied migrations are IMMUTABLE. Never edit one after apply."
}
m_reconcile(){ hr "Module · reconcile"; ui "Bootstrap › observe existing"; node "$REPO/scripts/reconcile-schema.mjs" "$LAB_REF"; }
m_health(){ hr "Module · health"; need_tok || return 0; ui "Project binding › Health"; ops health "$LAB_REF"; }
m_advisor(){
  hr "Module · advisors"; need_tok || return 0
  echo "-- security --"; MG "https://api.supabase.com/v1/projects/$LAB_REF/advisors/security" | head -c 1500; echo
  echo "-- performance --"; MG "https://api.supabase.com/v1/projects/$LAB_REF/advisors/performance" | head -c 900; echo
}
m_connect(){
  hr "Module · psql introspection"; need_pw || return 0
  SQL "select current_database(), current_user, version();"
  SQL "select rolname, rolsuper, rolbypassrls from pg_roles where rolname in ('anon','authenticated','service_role','postgres') order by 1;"
  note "service_role has BYPASSRLS; anon does not. PostgREST exposes only the public schema."
}
m_rls(){
  hr "Module · RLS demo"; need_key || return 0
  warn "This CREATES public.lab_note in $LAB_REF — which may be your LIVE project."
  printf 'Type the project ref to confirm: '; read -r C
  [ "$C" = "$LAB_REF" ] || die "not confirmed"
  cat > "$LABDIR/rls.sql" <<'SQL'
create table if not exists public.lab_note (
  id uuid primary key default gen_random_uuid(), owner uuid,
  title text not null unique, body text not null default '',
  is_public boolean not null default false, created_at timestamptz not null default now());
alter table public.lab_note enable row level security;
revoke all on table public.lab_note from anon, authenticated;
grant select on public.lab_note to anon, authenticated;
grant insert, update, delete on public.lab_note to authenticated;
drop policy if exists lab_read on public.lab_note;
create policy lab_read on public.lab_note for select to anon, authenticated using (is_public or owner = auth.uid());
drop policy if exists lab_write on public.lab_note;
create policy lab_write on public.lab_note for insert to authenticated with check (owner = auth.uid());
insert into public.lab_note (title,is_public) values ('public note',true),('private note',false) on conflict (title) do nothing;
SQL
  if [ "$LAB_HAS_PW" = yes ]; then SQL "$(cat "$LABDIR/rls.sql")" || { m_cleanup; return 1; }
  elif [ "$LAB_HAS_TOKEN" = yes ]; then API_SQL "$LABDIR/rls.sql"; echo
  else note "skipped: needs a stored DB password OR an account token"; return 0; fi
  echo "-- anon read (expect ONLY the public row) --"; REST "$LAB_URL/rest/v1/lab_note?select=title,is_public"; echo
  note "GRANT decides the OPERATION; POLICY decides the ROWS. Both are required."
  warn "Run: bash scripts/supabase-lab.sh cleanup   to remove the lab table."
}
m_rest(){
  hr "Module · PostgREST"; need_key || return 0; ui "the public website's fetch() calls"
  echo "-- sites (RLS: is_published only) --"; REST "$LAB_URL/rest/v1/sites?select=id,is_published&limit=5"; echo
  echo "-- system_pages (keepalive target) --"; REST "$LAB_URL/rest/v1/system_pages?select=slug,is_locked"; echo
  echo "-- anon INSERT must be denied --"
  REST -X POST -H 'Prefer: return=minimal' "$LAB_URL/rest/v1/submissions" -d '{"site_id":"probe","kind":"contact","full_name":"x","email":"x@y.invalid","message":"probe"}'; echo
}
m_rpc(){
  hr "Module · SECURITY DEFINER RPC"; need_key || return 0; ui "the public contact form"
  REST -X POST "$LAB_URL/rest/v1/rpc/portrox_submit" -d '{"p_site":"does-not-exist","p_kind":"contact","p_full_name":"Probe","p_email":"probe@example.invalid","p_message":"lab probe"}'; echo
  note "Definer bypasses RLS as owner; search_path pinned; anon has no direct table INSERT."
}
m_inbox(){
  hr "Module · inbox"; need_tok || return 0; ui "Studio › Inbox"
  printf '%s' "select id, site_id, kind, full_name, email, left(message,60) as message, created_at from public.submissions order by created_at desc limit 10;" > "$LABDIR/inbox.sql"
  API_SQL "$LABDIR/inbox.sql"; echo
}
m_services(){
  hr "Module · service surface"; need_tok || return 0
  for g in storage functions secrets gen branches; do echo "-- supabase $g --"; sb_run "$g" --help 2>&1 | head -12; echo; done
}
m_lifecycle(){
  hr "Module · lifecycle (read-only)"; need_tok || return 0
  MG "https://api.supabase.com/v1/projects/$LAB_REF" | head -c 700; echo
  sb_run inspect --help 2>&1 | head -18
  note "FREE projects PAUSE after 1 week idle; keepalive pings system_pages twice weekly."
  note "Pause/restore are dashboard actions; this module does not perform them."
}
m_cleanup(){
  hr "Module · cleanup"
  printf '%s' "drop function if exists public.lab_add_note(text,text); drop table if exists public.lab_note;" > "$LABDIR/cleanup.sql"
  if [ "$LAB_HAS_PW" = yes ]; then SQL "$(cat "$LABDIR/cleanup.sql")"
  elif [ "$LAB_HAS_TOKEN" = yes ]; then API_SQL "$LABDIR/cleanup.sql"; echo
  else note "skipped: needs a stored DB password OR an account token"; return 0; fi
  note "Lab objects removed. Portrox tables untouched."
}

case "$MOD" in
  doctor) m_doctor ;;
  env) m_env ;;
  account) m_env; m_account ;;
  create) m_env; m_create "$@" ;;
  link) m_env; m_link ;;
  key) m_env; m_key ;;
  bootstrap) m_env; m_bootstrap ;;
  push-all) m_env; m_pushall ;;
  reconcile) m_env; m_reconcile ;;
  health) m_env; m_health ;;
  advisor) m_env; m_advisor ;;
  connect) m_env; m_connect ;;
  rls) m_env; m_rls ;;
  rest) m_env; m_rest ;;
  rpc) m_env; m_rpc ;;
  inbox) m_env; m_inbox ;;
  services) m_env; m_services ;;
  lifecycle) m_env; m_lifecycle ;;
  cleanup) m_env; m_cleanup ;;
  all) m_env; m_account; m_key; m_bootstrap; m_reconcile; m_health; m_advisor; m_rest ;;
esac
