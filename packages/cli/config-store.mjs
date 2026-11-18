/**
 * Portrox store. Written ONLY by Studio UI endpoints. 0600 file in a 0700 dir.
 *
 * MODEL: ONE Supabase account (access token) -> MANY projects.
 *        Each site references a project_ref; credentials are never duplicated
 *        into site.json by hand. GitHub is one account with one PAT.
 *
 * Never returned to the browser: access_token, db_password, GitHub PAT.
 */
import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync, renameSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const HOME = process.env.PORTROX_HOME || join(homedir(), '.portrox');
const FILE = join(HOME, 'config.json');
const GH_API = 'https://api.github.com';
const GH_VER = '2026-03-10';
export const SMART_GROUPS = ['americas', 'emea', 'apac'];
export const FREE_ACTIVE_PROJECT_LIMIT = 2;

const blankProject = () => ({
  ref: '', name: '', organization_slug: '', region: '', status: 'UNKNOWN',
  url: '', publishable_key: '', key_kind: '', created_at: '',
  db_password: '', db_password_stored: false,
  schema_applied: [], schema_via: '', schema_at: 0,
  health: '', health_at: 0, last_error: ''
});
const blank = () => ({
  supabase: { access_token: '', token_verified_at: 0, token_error: '', orgs: [], default_project_ref: '', projects: {} },
  github: { token: '', login: '', scopes: '' }
});

function ensureDir() {
  mkdirSync(HOME, { recursive: true, mode: 0o700 });
  try { chmodSync(HOME, 0o700); } catch {}
}
export const refFromUrl = u => {
  const m = String(u || '').match(/^https:\/\/([a-z0-9-]+)\.supabase\.(?:co|in)$/i);
  return m ? m[1] : '';
};
const urlForRef = ref => ref ? 'https://' + ref + '.supabase.co' : '';

/** Self-heal: derive url/ref, migrate the legacy single-project shape. */
function normalize(c) {
  const b = blank();
  const out = {
    supabase: { ...b.supabase, ...(c.supabase || {}) },
    github: { ...b.github, ...(c.github || {}) }
  };
  const s = out.supabase;
  if (!s.projects || typeof s.projects !== 'object') s.projects = {};
  for (const [ref, p] of Object.entries(s.projects)) {
    const rec = { ...blankProject(), ...(p || {}) };
    rec.ref = rec.ref || ref;
    rec.url = rec.url || urlForRef(rec.ref);
    s.projects[rec.ref] = rec;
  }
  // Legacy v0.4 single-project config -> a project record.
  if (s.url && !s.projects[refFromUrl(s.url)]) {
    const ref = refFromUrl(s.url);
    if (ref) {
      s.projects[ref] = {
        ...blankProject(), ref, name: ref, url: s.url,
        publishable_key: s.publishable_key || '', key_kind: s.publishable_key ? 'publishable' : '',
        region: s.region || '', status: s.db_ok ? 'ACTIVE_HEALTHY' : 'UNKNOWN',
        db_password: s.db_password || '', db_password_stored: Boolean(s.db_password),
        health: s.db_ok ? 'ACTIVE_HEALTHY' : '', health_at: s.db_checked_at || 0
      };
      if (!s.default_project_ref) s.default_project_ref = ref;
    }
  }
  if (!s.default_project_ref) {
    const keys = Object.keys(s.projects);
    if (keys.length) s.default_project_ref = keys[0];
  }
  // Drop legacy scalars so nothing reads a stale global project again.
  for (const k of ['url', 'publishable_key', 'project_ref', 'db_password', 'db_host', 'db_port', 'db_user',
    'db_name', 'pooler_host', 'pooler_port', 'pooler_user', 'region', 'db_mode', 'db_ok', 'db_error',
    'db_checked_at', 'server_version', 'email', 'refresh_token', 'expires_at', 'user_id']) {
    delete s[k];
  }
  return out;
}

export function loadConfig() {
  ensureDir();
  if (existsSync(FILE) === false) return blank();
  try { return normalize(JSON.parse(readFileSync(FILE, 'utf8'))); }
  catch { return blank(); }
}
export function saveConfig(c) {
  ensureDir();
  const tmp = FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(c, null, 2), { mode: 0o600 });
  renameSync(tmp, FILE);
  try { chmodSync(FILE, 0o600); } catch {}
}

const tail = s => (typeof s === 'string' && s.length > 6) ? s.slice(-4) : '';

export function projectRecord(ref) {
  const c = loadConfig();
  return c.supabase.projects[ref] || null;
}
export function upsertProject(ref, patch) {
  const c = loadConfig();
  const cur = c.supabase.projects[ref] || { ...blankProject(), ref };
  const rec = { ...cur, ...patch, ref };
  rec.url = rec.url || urlForRef(ref);
  c.supabase.projects[ref] = rec;
  if (!c.supabase.default_project_ref) c.supabase.default_project_ref = ref;
  saveConfig(c);
  return rec;
}

/** Browser-safe. No access token, no db password, no PAT. */
export function maskedConfig() {
  const c = loadConfig();
  const s = c.supabase, g = c.github;
  const projects = Object.values(s.projects).map(p => ({
    ref: p.ref, name: p.name, organization_slug: p.organization_slug, region: p.region,
    status: p.status, url: p.url, created_at: p.created_at,
    has_key: Boolean(p.publishable_key), key_kind: p.key_kind, key_tail: tail(p.publishable_key),
    schema_applied: p.schema_applied, schema_via: p.schema_via, schema_at: p.schema_at,
    schema_complete: (p.schema_applied || []).length >= 2,
    health: p.health, health_at: p.health_at,
    db_password_stored: Boolean(p.db_password_stored), db_password_tail: tail(p.db_password),
    last_error: p.last_error
  }));
  const active = projects.filter(p => /ACTIVE/.test(p.status || '')).length;
  // Derived convenience fields from the DEFAULT project, so the dashboard,
  // checklist and CLI never read undefined after the multi-project refactor.
  const def = s.projects[s.default_project_ref] || null;
  const derived = {
    configured: Boolean(s.access_token),
    project_ref: s.default_project_ref || '',
    url: (def && def.url) || '',
    has_key: Boolean(def && def.publishable_key),
    key_tail: tail(def && def.publishable_key),
    status: (def && def.status) || '',
    health: (def && def.health) || '',
    db_ok: /ACTIVE_HEALTHY/.test((def && def.health) || ''),
    schema_complete: Boolean(def && (def.schema_applied || []).length >= 2),
    schema_files: (def && (def.schema_applied || []).length) || 0,
    db_password_stored: Boolean(def && def.db_password_stored)
  };
  return {
    supabase: {
      ...derived,
      account: {
        configured: Boolean(s.access_token),
        token_tail: tail(s.access_token),
        verified_at: s.token_verified_at,
        error: s.token_error,
        orgs: s.orgs,
        default_project_ref: s.default_project_ref
      },
      projects,
      project_count: projects.length,
      active_count: active,
      free_limit: FREE_ACTIVE_PROJECT_LIMIT,
      smart_groups: SMART_GROUPS
    },
    github: { configured: Boolean(g.token), login: g.login, token_tail: tail(g.token), scopes: g.scopes }
  };
}

export function accessToken() {
  const c = loadConfig();
  if (!c.supabase.access_token) throw new Error('Supabase access token not set. Settings -> Supabase account.');
  return c.supabase.access_token;
}
export function setAccessToken(token, orgs) {
  const c = loadConfig();
  const t = String(token || '').trim();
  if (!t) {
    if (!c.supabase.access_token) throw new Error('Access token is required.');
  } else {
    if (!/^sbp_/.test(t)) throw new Error('Supabase personal access tokens start with sbp_.');
    c.supabase.access_token = t;
  }
  c.supabase.orgs = Array.isArray(orgs) ? orgs : c.supabase.orgs;
  c.supabase.token_verified_at = Date.now();
  c.supabase.token_error = '';
  saveConfig(c);
  return maskedConfig();
}
export function recordTokenError(msg) {
  const c = loadConfig();
  c.supabase.token_error = String(msg || '').slice(0, 300);
  saveConfig(c);
  return maskedConfig();
}
export function setDefaultProject(ref) {
  const c = loadConfig();
  if (!c.supabase.projects[ref]) throw new Error('Unknown project ref: ' + ref);
  c.supabase.default_project_ref = ref;
  saveConfig(c);
  return maskedConfig();
}
export function clearAccessToken() {
  const c = loadConfig();
  c.supabase.access_token = ''; c.supabase.orgs = []; c.supabase.token_verified_at = 0;
  saveConfig(c);
  return maskedConfig();
}

/** Strong, unique, URL-safe. Shown ONCE; cannot be rotated via the API. */
export function generateDbPassword() {
  return randomBytes(24).toString('base64url') + 'A7!';
}

export function assertPublicKey(key) {
  if (/^sb_(secret|service)_/.test(key)) throw new Error('REFUSING: secret/service key. Use the publishable key.');
  if (/^sb_(publishable|anon)_/.test(key)) return 'publishable';
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) return 'legacy-anon';
  throw new Error('Key must be sb_publishable_… or a legacy anon JWT.');
}

/** Resolved public credentials for a site's project. Never includes secrets. */
export function publicSupabaseFor(ref) {
  const c = loadConfig();
  const r = ref || c.supabase.default_project_ref;
  const p = r ? c.supabase.projects[r] : null;
  if (!p || !p.url || !p.publishable_key) return { url: '', publishable_key: '' };
  assertPublicKey(p.publishable_key);
  return { url: p.url, publishable_key: p.publishable_key };
}
export function publicSupabase() { return publicSupabaseFor(''); }

/** psql fallback only. Password lives in ENV, never argv. */
export function pgParams(ref) {
  const c = loadConfig();
  const p = c.supabase.projects[ref || c.supabase.default_project_ref];
  if (!p) throw new Error('No project bound to this site.');
  if (!p.db_password_stored || !p.db_password) throw new Error('DB password not stored for this project. Use the Management API path, or re-enter it.');
  return { host: 'db.' + p.ref + '.supabase.co', port: 5432, user: 'postgres', database: 'postgres', password: p.db_password, mode: 'direct' };
}

export async function setGithub({ token }) {
  const c = loadConfig();
  let t = String(token || '').trim();
  if (!t) {
    if (!c.github.token) throw new Error('GitHub token is required on first setup.');
    t = c.github.token;
  }
  const r = await fetch(GH_API + '/user', {
    headers: { Authorization: 'Bearer ' + t, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': GH_VER, 'User-Agent': 'portrox' }
  });
  if (r.ok === false) throw new Error('GitHub token rejected (HTTP ' + r.status + '). Needs repo + workflow scope.');
  const j = await r.json();
  c.github.token = t; c.github.login = j.login || '';
  c.github.scopes = r.headers.get('x-oauth-scopes') || '';
  saveConfig(c);
  return maskedConfig();
}
export async function gh(path, opts = {}) {
  const c = loadConfig();
  if (!c.github.token) throw new Error('Configure GitHub token in Settings first.');
  const r = await fetch(GH_API + path, {
    method: opts.method || 'GET',
    headers: {
      Authorization: 'Bearer ' + c.github.token, Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': GH_VER, 'User-Agent': 'portrox',
      ...(opts.body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
  });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: r.status, ok: r.ok, json, text };
}
export function gitEnv() {
  const c = loadConfig();
  if (!c.github.token) throw new Error('Configure GitHub token in Settings first.');
  return {
    ...process.env, GH_TOKEN: c.github.token, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '/bin/true',
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'credential.helper', GIT_CONFIG_VALUE_0: '',
    GIT_CONFIG_KEY_1: 'credential.helper',
    GIT_CONFIG_VALUE_1: '!f() { echo "username=x-access-token"; echo "password=$GH_TOKEN"; }; f'
  };
}
