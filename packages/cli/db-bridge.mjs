/**
 * Database operations for a SITE's project.
 * Primary path: Supabase Management API (account token, HTTPS, no DB password).
 * Fallback:     psql with PG* env vars and SQL on stdin (needs a stored password).
 * Nothing secret is ever placed in argv.
 */
import { spawnSync } from 'node:child_process';
import { accessToken, pgParams, projectRecord, upsertProject, loadConfig } from './config-store.mjs';
import * as M from './supabase-mgmt.mjs';

export function psqlPath() {
  const r = spawnSync('which', ['psql'], { encoding: 'utf8' });
  return r.status === 0 ? String(r.stdout).trim() : '';
}

function psqlQuery(ref, sql) {
  const p = pgParams(ref);
  const env = {
    ...process.env,
    PGHOST: p.host, PGPORT: String(p.port), PGUSER: p.user, PGDATABASE: p.database,
    PGPASSWORD: p.password, PGSSLMODE: 'verify-full', PGCONNECT_TIMEOUT: '10', PGAPPNAME: 'portrox-studio'
  };
  const r = spawnSync('psql', ['-q', '-At', '-v', 'ON_ERROR_STOP=1', '-f', '-'], {
    input: sql, encoding: 'utf8', env, timeout: 45000
  });
  if (r.error) return { ok: false, via: 'psql', error: String(r.error.message) };
  if (r.status !== 0) return { ok: false, via: 'psql', error: String(r.stderr || '').trim().slice(0, 400) || ('psql exit ' + r.status) };
  return { ok: true, via: 'psql', out: String(r.stdout || '').trim() };
}

/** Management API first; psql only if the API path is unavailable. */
export async function query(ref, sql, { read_only = false } = {}) {
  try {
    const rows = await M.runQuery(accessToken(), ref, sql, { read_only });
    return { ok: true, via: 'management-api', rows };
  } catch (e) {
    if (psqlPath()) {
      const r = psqlQuery(ref, sql);
      if (r.ok) return r;
      return { ok: false, via: 'both', error: 'api: ' + e.message + ' | psql: ' + r.error };
    }
    return { ok: false, via: 'management-api', error: e.message };
  }
}

export async function health(ref) {
  try {
    const h = await M.projectHealth(accessToken(), ref);
    const list = Array.isArray(h) ? h : [h];
    const all = list.filter(Boolean);
    const okAll = all.length > 0 && all.every(x => x.status === 'ACTIVE_HEALTHY');
    const summary = all.map(x => (x.name || x.identifier || 'svc') + '=' + x.status).join(' ');
    upsertProject(ref, { health: summary, health_at: Date.now(), status: okAll ? 'ACTIVE_HEALTHY' : (projectRecord(ref)?.status || 'UNKNOWN'), last_error: '' });
    return { ok: okAll, services: all, summary };
  } catch (e) {
    upsertProject(ref, { last_error: e.message });
    return { ok: false, error: e.message };
  }
}

export async function applySchema(ref, repoRoot, { onStep } = {}) {
  const r = await M.applySchema(accessToken(), ref, repoRoot, { onStep });
  upsertProject(ref, { schema_applied: r.applied, schema_via: r.via, schema_at: Date.now(), last_error: '' });
  return r;
}

export async function ensureKey(ref) {
  const r = await M.ensurePublishableKey(accessToken(), ref);
  upsertProject(ref, { publishable_key: r.key, key_kind: r.kind, url: 'https://' + ref + '.supabase.co', last_error: '' });
  return { kind: r.kind, tail: r.key.slice(-4) };
}

const q = s => {
  const v = String(s == null ? '' : s);
  if (v.indexOf('\u0000') >= 0) throw new Error('NUL byte rejected in SQL literal');
  return "'" + v.replace(/'/g, "''") + "'";
};
const jb = o => q(JSON.stringify(o || {})) + '::jsonb';

export async function registerSite(ref, id, cfg, studioOwner) {
  const sql = [
    'insert into public.sites (id, owner_id, studio_owner, display_name, pages_mode, repo, base_path, cname, seo, nav, flags, theme, is_published)',
    'values (' + q(id) + ', null, ' + q(studioOwner) + ', ' + q((cfg.seo && cfg.seo.title) || id) + ', ' + q(cfg.pages.mode) + ', ' + q(cfg.pages.repo) + ', ' + q(cfg.pages.base_path || '') + ', ' + (cfg.pages.cname ? q(cfg.pages.cname) : 'null') + ', ' + jb(cfg.seo) + ', ' + jb(cfg.nav) + ', ' + jb(cfg.flags) + ', ' + jb(cfg.theme) + ', false)',
    'on conflict (id) do update set studio_owner = excluded.studio_owner, display_name = excluded.display_name,',
    '  pages_mode = excluded.pages_mode, repo = excluded.repo, base_path = excluded.base_path,',
    '  seo = excluded.seo, nav = excluded.nav, flags = excluded.flags, theme = excluded.theme, updated_at = now();',
    "select 'registered:' || id from public.sites where id = " + q(id) + ';'
  ].join('\n');
  return query(ref, sql);
}

export async function markPublished(ref, id, published) {
  return query(ref, 'update public.sites set is_published = ' + (published ? 'true' : 'false') + ', updated_at = now() where id = ' + q(id) + ';');
}

export async function schemaStatus(ref) {
  const r = await query(ref, "select coalesce(string_agg(version, ',' order by version), '') from supabase_migrations.schema_migrations;", { read_only: true });
  return r;
}

export function boundRef(siteCfg) {
  const c = loadConfig();
  const db = (siteCfg && siteCfg.database) || {};
  return db.project_ref || c.supabase.default_project_ref || '';
}
