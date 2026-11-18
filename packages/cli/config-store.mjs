/**
 * Portrox credential store. Written ONLY by Studio UI endpoints.
 * ~/.portrox/config.json (0600) inside a 0700 directory.
 * Nothing secret is ever returned to the browser or placed in argv.
 *
 * Supabase model: the Studio is the database administrator. It needs the
 * Project URL, the PUBLISHABLE key (public, goes into rendered sites) and the
 * DATABASE PASSWORD. Both DSNs are derived from the project ref; the user
 * never types a connection string.
 */
import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const HOME = process.env.PORTROX_HOME || join(homedir(), '.portrox');
const FILE = join(HOME, 'config.json');
const GH_API = 'https://api.github.com';
const GH_VER = '2026-03-10';

export const REGIONS = [
  'ap-south-1', 'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-northeast-2',
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
  'eu-central-1', 'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-north-1',
  'ca-central-1', 'sa-east-1'
];

const blank = () => ({
  supabase: {
    url: '', publishable_key: '', project_ref: '',
    db_password: '', db_name: 'postgres',
    db_host: '', db_port: 5432, db_user: 'postgres',
    pooler_host: '', pooler_port: 5432, pooler_user: '',
    region: '', db_mode: '', db_ok: false, db_error: '', db_checked_at: 0, server_version: '',
    email: '', access_token: '', refresh_token: '', expires_at: 0, user_id: ''
  },
  github: { token: '', login: '', scopes: '' }
});

function ensureDir() {
  mkdirSync(HOME, { recursive: true, mode: 0o700 });
  try { chmodSync(HOME, 0o700); } catch {}
}

export function loadConfig() {
  ensureDir();
  if (existsSync(FILE) === false) return blank();
  try {
    const c = JSON.parse(readFileSync(FILE, 'utf8'));
    const b = blank();
    return { supabase: { ...b.supabase, ...(c.supabase || {}) }, github: { ...b.github, ...(c.github || {}) } };
  } catch { return blank(); }
}

export function saveConfig(c) {
  ensureDir();
  const tmp = FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(c, null, 2), { mode: 0o600 });
  renameSync(tmp, FILE);
  try { chmodSync(FILE, 0o600); } catch {}
}

const tail = s => (typeof s === 'string' && s.length > 6) ? s.slice(-4) : '';

/** Browser-safe view. No passwords, no tokens. */
export function maskedConfig() {
  const c = loadConfig();
  const s = c.supabase, g = c.github;
  const now = Math.floor(Date.now() / 1000);
  return {
    supabase: {
      configured: Boolean(s.url && s.publishable_key),
      url: s.url,
      project_ref: s.project_ref,
      key_tail: tail(s.publishable_key),
      db_configured: Boolean(s.db_password && s.db_host),
      db_password_tail: tail(s.db_password),
      db_host: s.db_host, db_port: s.db_port, db_user: s.db_user, db_name: s.db_name,
      pooler_host: s.pooler_host, pooler_port: s.pooler_port, pooler_user: s.pooler_user,
      region: s.region, regions: REGIONS,
      db_mode: s.db_mode, db_ok: Boolean(s.db_ok), db_error: s.db_error,
      db_checked_at: s.db_checked_at, server_version: s.server_version,
      dsn_direct: s.db_host ? 'postgresql://' + s.db_user + ':********@' + s.db_host + ':' + s.db_port + '/' + s.db_name : '',
      dsn_pooler: s.pooler_host ? 'postgresql://' + s.pooler_user + ':********@' + s.pooler_host + ':' + s.pooler_port + '/' + s.db_name : '',
      signed_in: Boolean(s.access_token && s.user_id),
      email: s.email, user_id: s.user_id,
      expires_in: s.expires_at ? Math.max(0, s.expires_at - now) : 0
    },
    github: { configured: Boolean(g.token), login: g.login, token_tail: tail(g.token), scopes: g.scopes }
  };
}

export function assertPublicKey(key) {
  if (/^sb_(secret|service)_/.test(key)) throw new Error('REFUSING: secret/service key. Use the publishable (anon) key.');
  if (/^sb_(publishable|anon)_/.test(key)) return 'publishable';
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) return 'legacy-anon';
  throw new Error('Key must be sb_publishable_… / sb_anon_… or a legacy anon JWT.');
}

export function refFromUrl(u) {
  const m = String(u || '').match(/^https:\/\/([a-z0-9-]+)\.supabase\.(?:co|in)$/i);
  return m ? m[1] : '';
}

/**
 * Single Supabase endpoint. Accepts url + publishable_key + db_password + region.
 * Blank secret fields keep the stored value so any field can be edited alone.
 * Both DSN endpoints are DERIVED from the project ref.
 */
export function setSupabase({ url, publishable_key, db_password, region }) {
  const c = loadConfig();
  const s = c.supabase;
  const u = String(url || s.url || '').trim().replace(/\/$/, '');
  if (/^https:\/\/[A-Za-z0-9.-]+\.supabase\.(co|in)$/.test(u) === false) {
    throw new Error('Invalid Supabase URL. Expected https://<project-ref>.supabase.co');
  }
  let k = String(publishable_key || '').trim();
  if (!k) {
    if (!s.publishable_key) throw new Error('Publishable key is required on first setup.');
    k = s.publishable_key;
  }
  assertPublicKey(k);

  let p = String(db_password || '');
  if (!p) p = s.db_password;

  const ref = refFromUrl(u);
  const reg = String(region || s.region || '').trim();
  const projectChanged = s.url !== u;

  s.url = u;
  s.publishable_key = k;
  s.project_ref = ref;
  s.db_password = p;
  s.db_name = s.db_name || 'postgres';
  s.db_host = 'db.' + ref + '.supabase.co';
  s.db_port = 5432;
  s.db_user = 'postgres';
  s.region = reg;
  s.pooler_host = reg ? 'aws-0-' + reg + '.pooler.supabase.com' : '';
  s.pooler_port = 5432;
  s.pooler_user = reg ? 'postgres.' + ref : '';
  if (projectChanged || s.db_password !== p) { s.db_ok = false; s.db_error = ''; s.db_mode = ''; s.server_version = ''; }
  if (projectChanged) { s.access_token = ''; s.refresh_token = ''; s.expires_at = 0; s.user_id = ''; s.email = ''; }
  saveConfig(c);
  return maskedConfig();
}

export function recordDbResult({ ok: good, mode, error, version }) {
  const c = loadConfig();
  c.supabase.db_ok = Boolean(good);
  c.supabase.db_mode = good ? (mode || '') : c.supabase.db_mode;
  c.supabase.db_error = good ? '' : String(error || '').slice(0, 400);
  c.supabase.server_version = good ? String(version || '') : c.supabase.server_version;
  c.supabase.db_checked_at = Date.now();
  saveConfig(c);
  return maskedConfig();
}

/** Connection parameters. Password lives in the ENV, never in argv. */
export function pgParams(mode) {
  const c = loadConfig();
  const s = c.supabase;
  if (!s.db_password) throw new Error('Database password not set. Enter it in Settings → Supabase.');
  const direct = mode !== 'pooler';
  const host = direct ? s.db_host : s.pooler_host;
  const user = direct ? s.db_user : s.pooler_user;
  const port = direct ? s.db_port : s.pooler_port;
  if (!host || !user) throw new Error('Pooler endpoint unavailable. Select your project region first.');
  return { host, port: Number(port), user, database: s.db_name || 'postgres', password: s.db_password, mode: direct ? 'direct' : 'pooler' };
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
  c.github.token = t;
  c.github.login = j.login || '';
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
      Authorization: 'Bearer ' + c.github.token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': GH_VER,
      'User-Agent': 'portrox',
      ...(opts.body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
  });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: r.status, ok: r.ok, json, text };
}

/** Git credential helper reads the PAT from ENV only. Empty value resets the list. */
export function gitEnv() {
  const c = loadConfig();
  if (!c.github.token) throw new Error('Configure GitHub token in Settings first.');
  return {
    ...process.env,
    GH_TOKEN: c.github.token,
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '/bin/true',
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'credential.helper',
    GIT_CONFIG_VALUE_0: '',
    GIT_CONFIG_KEY_1: 'credential.helper',
    GIT_CONFIG_VALUE_1: '!f() { echo "username=x-access-token"; echo "password=$GH_TOKEN"; }; f'
  };
}

export function publicSupabase() {
  const c = loadConfig();
  if (!c.supabase.url || !c.supabase.publishable_key) return { url: '', publishable_key: '' };
  assertPublicKey(c.supabase.publishable_key);
  return { url: c.supabase.url, publishable_key: c.supabase.publishable_key };
}

/* ---- retained for compatibility; the Studio UI no longer uses Auth sign-in ---- */
async function tokenRequest(grant, body) {
  const c = loadConfig();
  if (!c.supabase.url || !c.supabase.publishable_key) throw new Error('Configure Supabase first.');
  const r = await fetch(c.supabase.url + '/auth/v1/token?grant_type=' + grant, {
    method: 'POST', headers: { apikey: c.supabase.publishable_key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const j = await r.json().catch(() => ({}));
  if (r.ok === false) throw new Error(j.error_description || j.msg || j.error || ('auth failed HTTP ' + r.status));
  return j;
}
export async function signIn({ email, password }) {
  const j = await tokenRequest('password', { email: String(email || '').trim(), password: String(password || '') });
  const c = loadConfig();
  c.supabase.email = String(email || '').trim();
  c.supabase.access_token = j.access_token || '';
  c.supabase.refresh_token = j.refresh_token || '';
  c.supabase.expires_at = Math.floor(Date.now() / 1000) + Number(j.expires_in || 3600);
  c.supabase.user_id = (j.user && j.user.id) || '';
  saveConfig(c);
  return maskedConfig();
}
export function signOut() {
  const c = loadConfig();
  c.supabase.access_token = ''; c.supabase.refresh_token = ''; c.supabase.expires_at = 0; c.supabase.user_id = ''; c.supabase.email = '';
  saveConfig(c);
  return maskedConfig();
}
export async function ensureToken() {
  const c = loadConfig();
  if (!c.supabase.refresh_token) throw new Error('Not signed in to Supabase Auth.');
  const now = Math.floor(Date.now() / 1000);
  if (c.supabase.access_token && c.supabase.expires_at - 60 > now) return c.supabase.access_token;
  const j = await tokenRequest('refresh_token', { refresh_token: c.supabase.refresh_token });
  c.supabase.access_token = j.access_token || '';
  c.supabase.refresh_token = j.refresh_token || c.supabase.refresh_token;
  c.supabase.expires_at = Math.floor(Date.now() / 1000) + Number(j.expires_in || 3600);
  if (j.user && j.user.id) c.supabase.user_id = j.user.id;
  saveConfig(c);
  return c.supabase.access_token;
}
export async function sb(path, opts = {}) {
  const c = loadConfig();
  const tok = await ensureToken();
  const r = await fetch(c.supabase.url + path, {
    method: opts.method || 'GET',
    headers: { apikey: c.supabase.publishable_key, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json', ...(opts.prefer ? { Prefer: opts.prefer } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
  });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: r.status, ok: r.ok, json, text };
}
