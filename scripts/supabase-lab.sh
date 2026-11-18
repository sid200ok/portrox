#!/usr/bin/env bash
# Portrox Supabase Lab — learn by doing, entirely in the terminal.
# Credentials come from the Portrox store, never .env. Nothing secret in argv.
#   bash scripts/supabase-lab.sh <module> [project_ref]
#   help | env | connect | schema | rls | rest | rpc | migrate | advisor | cleanup | all
set -uo pipefail
REPO="$(cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)" && pwd)"
cd "$REPO"
MOD="${1:-help}"; WANT_REF="${2:-}"
hr(){ printf '\n\033[1m── %s ──\033[0m\n' "$*"; }
note(){ printf '  \033[36mLEARN\033[0m %s\n' "$*"; }
die(){ printf '\033[31mFAIL\033[0m %s\n' "$*" >&2; exit 1; }

show_help(){ cat <<'HELP'
Portrox Supabase Lab
  help      this table (works with zero configuration)
  env       credentials + endpoints
  connect   roles, schemas, extensions            (needs stored DB password)
  schema    tables, constraints, indexes          (needs stored DB password)
  rls       policies, anon vs authenticated       (needs DB password + key)
  rest      PostgREST CRUD + filters              (needs publishable key)
  rpc       SECURITY DEFINER functions            (needs DB password + key)
  migrate   Supabase CLI link / push / list
  advisor   health + security advisor + key types (needs Management token)
  cleanup   drop lab objects                      (needs stored DB password)
  all       modules 0-7 in order
Optional 2nd argument: a project ref. Defaults to the Portrox default project.
HELP
}
[ "$MOD" = "help" ] && { show_help; exit 0; }

LABDIR="$(mktemp -d "${TMPDIR:-/tmp}/portrox-lab.XXXXXX")"
trap 'rm -rf "$LABDIR"' EXIT INT TERM

# Absolute module URL — a relative import would resolve against /tmp.
cat > "$LABDIR/env.mjs" <<'ENVEOF'
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const repo = process.argv[2], want = process.argv[3] || '', out = process.argv[4];
const m = await import(pathToFileURL(join(repo, 'packages/cli/config-store.mjs')).href);
const c = m.loadConfig();
const ref = want || c.supabase.default_project_ref || Object.keys(c.supabase.projects)[0] || '';
if (!ref) { console.error('No project. Studio -> Settings -> Supabase account -> validate token -> Refresh projects.'); process.exit(1); }
const p = c.supabase.projects[ref];
if (!p) { console.error('Unknown ref: ' + ref); process.exit(1); }
const q = v => "'" + String(v == null ? '' : v).replace(/'/g, "'\\''") + "'";
writeFileSync(out, [
  'export LAB_REF=' + q(ref),
  'export LAB_URL=' + q(p.url || 'https://' + ref + '.supabase.co'),
  'export LAB_KEY=' + q(p.publishable_key || ''),
  'export LAB_TOKEN=' + q(c.supabase.access_token || ''),
  'export PGHOST=' + q('db.' + ref + '.supabase.co'),
  'export PGPORT=5432',
  'export PGUSER=postgres',
  'export PGDATABASE=postgres',
  'export PGSSLMODE=verify-full',
  'export PGCONNECT_TIMEOUT=10',
  'export PGAPPNAME=portrox-lab',
  'export PGPASSWORD=' + q(p.db_password || '')
].join('\n') + '\n', { mode: 0o600 });
console.log(ref);
ENVEOF
node "$LABDIR/env.mjs" "$REPO" "$WANT_REF" "$LABDIR/env.sh" >/dev/null || die "env resolution failed"
# shellcheck disable=SC1091
. "$LABDIR/env.sh"

MG(){ curl -sS -H "Authorization: Bearer $LAB_TOKEN" -H 'Accept: application/json' "$@"; }
SQL(){ printf '%s\n' "$1" | psql -q -At -v ON_ERROR_STOP=1 -f - ; }
# REST_AS <bearer> <curl args...>  — token is explicit, never a positional guess.
REST_AS(){ local tok="$1"; shift; curl -sS -H "apikey: $LAB_KEY" -H "Authorization: Bearer $tok" -H 'Content-Type: application/json' "$@"; }
REST(){ REST_AS "$LAB_KEY" "$@"; }
need_pw(){ [ -n "$PGPASSWORD" ] || { note "skipped: no stored DB password (Management API path is primary)"; return 1; }; }
need_key(){ [ -n "$LAB_KEY" ] || { note "skipped: no publishable key. Fetch key in the project tab."; return 1; }; }
need_tok(){ [ -n "$LAB_TOKEN" ] || { note "skipped: no Management token. Settings -> Supabase account."; return 1; }; }

m_env(){
  hr "Module 0 · environment"
  echo "project ref : $LAB_REF"
  echo "REST base   : $LAB_URL/rest/v1"
  echo "auth base   : $LAB_URL/auth/v1"
  echo "key present : $([ -n "$LAB_KEY" ] && echo yes || echo NO)"
  echo "mgmt token  : $([ -n "$LAB_TOKEN" ] && echo yes || echo NO)"
  echo "db password : $([ -n "$PGPASSWORD" ] && echo stored || echo 'not stored')"
  note "Three credential classes: publishable key (browser-safe, RLS-bound), secret key (server only), Management PAT (account-level)."
  note "DSN is derived from the ref. Free-tier direct host is IPv6-only; use the pooler if WSL lacks IPv6."
}
m_connect(){
  hr "Module 1 · connect and introspect"; need_pw || return 0
  SQL "select current_database(), current_user, version();"
  SQL "select nspname from pg_namespace where nspname not like 'pg_%' order by 1;"
  SQL "select rolname, rolsuper, rolbypassrls from pg_roles where rolname in ('anon','authenticated','service_role','postgres') order by 1;"
  SQL "select extname, extnamespace::regnamespace from pg_extension order by 1;"
  note "service_role has BYPASSRLS; anon does not. PostgREST exposes only the public schema by default."
}
m_schema(){
  hr "Module 2 · schema, constraints, indexes"; need_pw || return 0
  SQL "
create table if not exists public.lab_note (
  id uuid primary key default gen_random_uuid(),
  owner uuid,
  title text not null unique,
  body text not null default '',
  is_public boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists lab_note_owner_idx on public.lab_note(owner);
create index if not exists lab_note_public_idx on public.lab_note(is_public) where is_public;"
  SQL "select column_name, data_type from information_schema.columns where table_name='lab_note' order by ordinal_position;"
  note "gen_random_uuid() is core in PG13+. A partial index beats a full boolean index. UNIQUE(title) makes re-runs idempotent."
}
m_rls(){
  hr "Module 3 · Row Level Security"; need_pw || return 0; need_key || return 0
  SQL "
alter table public.lab_note enable row level security;
revoke all on table public.lab_note from anon, authenticated;
grant select on public.lab_note to anon, authenticated;
grant insert, update, delete on public.lab_note to authenticated;
drop policy if exists lab_read on public.lab_note;
create policy lab_read on public.lab_note for select to anon, authenticated
  using (is_public or owner = auth.uid());
drop policy if exists lab_write on public.lab_note;
create policy lab_write on public.lab_note for insert to authenticated
  with check (owner = auth.uid());
insert into public.lab_note (title, body, is_public)
values ('public note','visible to anon',true), ('private note','owner only',false)
on conflict (title) do nothing;"
  echo "-- anon REST read (expect ONLY the public row) --"
  REST "$LAB_URL/rest/v1/lab_note?select=title,is_public"; echo
  note "GRANT decides the operation; POLICY decides the rows. Both are required."
  note "auth.uid() is NULL with only the publishable key, so the private row is invisible."
}
m_rest(){
  hr "Module 4 · PostgREST CRUD and filters"; need_key || return 0
  echo "-- filter + order + limit --"
  REST "$LAB_URL/rest/v1/lab_note?select=title,created_at&is_public=eq.true&order=created_at.desc&limit=3"; echo
  echo "-- anon insert (expect 401/403: no INSERT policy for anon) --"
  REST -X POST -H 'Prefer: return=representation' "$LAB_URL/rest/v1/lab_note" -d '{"title":"anon attempt","is_public":true}'; echo
  echo "-- exact count header --"
  curl -sS -I -H "apikey: $LAB_KEY" -H "Authorization: Bearer $LAB_KEY" -H 'Prefer: count=exact' "$LAB_URL/rest/v1/lab_note?select=id" | grep -i content-range || true
  note "Operators: eq neq gt gte lt lte like ilike in is cs cd. OR via ?or=(a.eq.1,b.eq.2)."
}
m_rpc(){
  hr "Module 5 · SQL functions exposed as RPC"; need_pw || return 0; need_key || return 0
  SQL "
create or replace function public.lab_add_note(p_title text, p_body text default '')
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as \$\$
declare v_id uuid;
begin
  if p_title is null or btrim(p_title) = '' then
    return jsonb_build_object('ok', false, 'error', 'title_required');
  end if;
  insert into public.lab_note (title, body, is_public)
  values (btrim(p_title), p_body, true)
  on conflict (title) do update set body = excluded.body
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end \$\$;
revoke all on function public.lab_add_note(text,text) from public;
grant execute on function public.lab_add_note(text,text) to anon, authenticated;"
  echo "-- call the RPC as anon --"
  REST -X POST "$LAB_URL/rest/v1/rpc/lab_add_note" -d '{"p_title":"rpc note","p_body":"created by a definer function"}'; echo
  note "SECURITY DEFINER bypasses RLS as the owner — the correct shape for rate-limited public intake."
  note "ALWAYS pin search_path, and REVOKE from public before GRANT to specific roles."
}
m_migrate(){
  hr "Module 6 · migrations with the Supabase CLI"
  command -v npx >/dev/null || { note "npx missing"; return 0; }
  npx --yes supabase@3.1.0 --version || true
  npx --yes supabase@3.1.0 migration list --remote 2>&1 | tail -20 || true
  note "login = account PAT. init = supabase/config.toml. link = bind repo to ONE project."
  note "db push applies supabase/migrations/*.sql in filename order. Applied migrations are IMMUTABLE."
}
m_advisor(){
  hr "Module 7 · health, keys, advisor"; need_tok || return 0
  echo "-- service health --"; MG "https://api.supabase.com/v1/projects/$LAB_REF/health"; echo
  echo "-- api key TYPES only --"
  MG "https://api.supabase.com/v1/projects/$LAB_REF/api-keys" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s);console.log((Array.isArray(a)?a:[]).map(k=>({type:k.type,name:k.name})))}catch{console.log("(unparsable)")}})'
  echo "-- security advisor (truncated) --"; MG "https://api.supabase.com/v1/projects/$LAB_REF/advisors/security" | head -c 1200; echo
  note "Never print ?reveal=true in a shared terminal — it contains the secret key."
}
m_cleanup(){
  hr "Module 8 · cleanup"; need_pw || return 0
  SQL "drop function if exists public.lab_add_note(text,text); drop table if exists public.lab_note;"
  note "Lab objects removed. Portrox tables were never touched."
}

case "$MOD" in
  env) m_env ;;
  connect) m_env; m_connect ;;
  schema) m_env; m_schema ;;
  rls) m_env; m_schema; m_rls ;;
  rest) m_env; m_rest ;;
  rpc) m_env; m_schema; m_rpc ;;
  migrate) m_env; m_migrate ;;
  advisor) m_env; m_advisor ;;
  cleanup) m_cleanup ;;
  all) m_env; m_connect; m_schema; m_rls; m_rest; m_rpc; m_migrate; m_advisor ;;
  *) show_help; exit 1 ;;
esac
