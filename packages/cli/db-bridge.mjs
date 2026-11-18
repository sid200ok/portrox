/**
 * Postgres bridge for the Studio (administrator role).
 * Credentials go through the ENVIRONMENT; SQL goes through STDIN.
 * Nothing secret is ever placed in argv.
 * Requires the `psql` binary (postgresql-client).
 */
import { spawnSync } from 'node:child_process';
import { pgParams, recordDbResult, loadConfig } from './config-store.mjs';

export function psqlPath() {
  const r = spawnSync('which', ['psql'], { encoding: 'utf8' });
  return r.status === 0 ? String(r.stdout).trim() : '';
}

function envFor(p) {
  return {
    ...process.env,
    PGHOST: p.host,
    PGPORT: String(p.port),
    PGUSER: p.user,
    PGDATABASE: p.database,
    PGPASSWORD: p.password,
    PGSSLMODE: 'require',
    PGCONNECT_TIMEOUT: '10',
    PGAPPNAME: 'portrox-studio'
  };
}

function runOnce(sql, mode) {
  const p = pgParams(mode);
  const r = spawnSync('psql', ['-q', '-At', '-v', 'ON_ERROR_STOP=1', '-f', '-'], {
    input: sql, encoding: 'utf8', env: envFor(p), timeout: 45000
  });
  if (r.error) return { ok: false, mode: p.mode, error: String(r.error.message) };
  if (r.status !== 0) return { ok: false, mode: p.mode, error: String(r.stderr || '').trim().slice(0, 400) || ('psql exit ' + r.status) };
  return { ok: true, mode: p.mode, out: String(r.stdout || '').trim() };
}

/** Try the last good mode first, then the other endpoint. */
export function dbQuery(sql) {
  if (!psqlPath()) {
    return { ok: false, error: 'psql not found. Install it with: sudo apt-get install -y postgresql-client' };
  }
  const c = loadConfig();
  const pref = c.supabase.db_mode === 'pooler' ? 'pooler' : 'direct';
  const order = [pref, pref === 'direct' ? 'pooler' : 'direct'];
  let last = { ok: false, error: 'no attempt made' };
  for (const mode of order) {
    let res;
    try { res = runOnce(sql, mode); }
    catch (e) { last = { ok: false, error: String(e.message) }; continue; }
    if (res.ok) return res;
    last = res;
  }
  return last;
}

export function testConnection() {
  const r = dbQuery("select current_setting('server_version');");
  if (r.ok) return recordDbResult({ ok: true, mode: r.mode, version: r.out });
  return recordDbResult({ ok: false, error: r.error });
}

const q = s => "'" + String(s == null ? '' : s).replace(/'/g, "''") + "'";
const j = o => q(JSON.stringify(o || {})) + '::jsonb';

/** Register a tenant as the local Studio administrator. owner_id stays NULL. */
export function registerSiteSql(id, cfg, studioOwner) {
  const sql = [
    'insert into public.sites (id, owner_id, studio_owner, display_name, pages_mode, repo, base_path, cname, seo, nav, flags, theme, is_published)',
    'values (' + q(id) + ', null, ' + q(studioOwner) + ', ' + q((cfg.seo && cfg.seo.title) || id) + ', ' + q(cfg.pages.mode) + ', ' + q(cfg.pages.repo) + ', ' + q(cfg.pages.base_path || '') + ', ' + (cfg.pages.cname ? q(cfg.pages.cname) : 'null') + ', ' + j(cfg.seo) + ', ' + j(cfg.nav) + ', ' + j(cfg.flags) + ', ' + j(cfg.theme) + ', false)',
    'on conflict (id) do update set studio_owner = excluded.studio_owner, display_name = excluded.display_name,',
    '  pages_mode = excluded.pages_mode, repo = excluded.repo, base_path = excluded.base_path,',
    '  seo = excluded.seo, nav = excluded.nav, flags = excluded.flags, theme = excluded.theme, updated_at = now();',
    "select 'registered:' || id from public.sites where id = " + q(id) + ';'
  ].join('\n');
  return dbQuery(sql);
}

export function markPublishedSql(id, published) {
  return dbQuery('update public.sites set is_published = ' + (published ? 'true' : 'false') + ', updated_at = now() where id = ' + q(id) + ';\nselect \'published:\' || id || \':\' || is_published from public.sites where id = ' + q(id) + ';');
}

export function listSitesSql() {
  return dbQuery("select coalesce(json_agg(row_to_json(t))::text, '[]') from (select id, studio_owner, pages_mode, repo, is_published, updated_at from public.sites order by id) t;");
}
