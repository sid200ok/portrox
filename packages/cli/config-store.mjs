/**
 * Portrox credential store.
 * Written ONLY by Studio UI endpoints. Never read from .env. Never returned to the browser.
 * File: ~/.portrox/config.json  mode 0600, dir 0700.
 * Passwords are used transiently for sign-in and NEVER persisted.
 */
import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const HOME = process.env.PORTROX_HOME || join(homedir(), '.portrox');
const FILE = join(HOME, 'config.json');
const GH_API = 'https://api.github.com';
const GH_VER = '2026-03-10';

const blank = () => ({
  supabase: { url: '', publishable_key: '', email: '', access_token: '', refresh_token: '', expires_at: 0, user_id: '' },
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

/** What the browser is allowed to see. No tokens, no passwords. */
export function maskedConfig() {
  const c = loadConfig();
  const now = Math.floor(Date.now() / 1000);
  return {
    supabase: {
      configured: Boolean(c.supabase.url && c.supabase.publishable_key),
      url: c.supabase.url,
      key_tail: tail(c.supabase.publishable_key),
      signed_in: Boolean(c.supabase.access_token && c.supabase.user_id),
      email: c.supabase.email,
      user_id: c.supabase.user_id,
      expires_in: c.supabase.expires_at ? Math.max(0, c.supabase.expires_at - now) : 0
    },
    github: {
      configured: Boolean(c.github.token),
      login: c.github.login,
      token_tail: tail(c.github.token),
      scopes: c.github.scopes
    }
  };
}

export function assertPublicKey(key) {
  if (/^sb_(secret|service)_/.test(key)) throw new Error('REFUSING: secret/service key. Use the publishable (anon) key.');
  if (/^sb_(publishable|anon)_/.test(key)) return 'publishable';
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) return 'legacy-anon';
  throw new Error('Key must be sb_publishable_… / sb_anon_… or a legacy anon JWT.');
}

export function setSupabase({ url, publishable_key }) {
  const u = String(url || '').trim().replace(/\/$/, '');
  const k = String(publishable_key || '').trim();
  if (/^https:\/\/[A-Za-z0-9.-]+\.supabase\.(co|in)$/.test(u) === false) throw new Error('Invalid Supabase URL (https://<ref>.supabase.co).');
  assertPublicKey(k);
  const c = loadConfig();
  const changed = c.supabase.url !== u || c.supabase.publishable_key !== k;
  c.supabase.url = u; c.supabase.publishable_key = k;
  if (changed) { c.supabase.access_token = ''; c.supabase.refresh_token = ''; c.supabase.expires_at = 0; c.supabase.user_id = ''; c.supabase.email = ''; }
  saveConfig(c);
  return maskedConfig();
}

async function tokenRequest(grant, body) {
  const c = loadConfig();
  if (!c.supabase.url || !c.supabase.publishable_key) throw new Error('Configure Supabase URL and publishable key first.');
  const r = await fetch(c.supabase.url + '/auth/v1/token?grant_type=' + grant, {
    method: 'POST',
    headers: { apikey: c.supabase.publishable_key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const j = await r.json().catch(() => ({}));
  if (r.ok === false) throw new Error(j.error_description || j.msg || j.error || ('auth failed HTTP ' + r.status));
  return j;
}

export async function signIn({ email, password }) {
  const e = String(email || '').trim();
  const p = String(password || '');
  if (!e || !p) throw new Error('Email and password are required.');
  const j = await tokenRequest('password', { email: e, password: p });
  const c = loadConfig();
  c.supabase.email = e;
  c.supabase.access_token = j.access_token || '';
  c.supabase.refresh_token = j.refresh_token || '';
  c.supabase.expires_at = Math.floor(Date.now() / 1000) + Number(j.expires_in || 3600);
  c.supabase.user_id = (j.user && j.user.id) || '';
  saveConfig(c);
  return maskedConfig();   // password never persisted
}

export function signOut() {
  const c = loadConfig();
  c.supabase.access_token = ''; c.supabase.refresh_token = ''; c.supabase.expires_at = 0; c.supabase.user_id = ''; c.supabase.email = '';
  saveConfig(c);
  return maskedConfig();
}

export async function ensureToken() {
  const c = loadConfig();
  if (!c.supabase.refresh_token) throw new Error('Not signed in to Supabase. Use Setup → Sign in.');
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

/** Authenticated Supabase REST call as the signed-in owner (RLS enforced). */
export async function sb(path, opts = {}) {
  const c = loadConfig();
  const tok = await ensureToken();
  const r = await fetch(c.supabase.url + path, {
    method: opts.method || 'GET',
    headers: {
      apikey: c.supabase.publishable_key,
      Authorization: 'Bearer ' + tok,
      'Content-Type': 'application/json',
      ...(opts.prefer ? { Prefer: opts.prefer } : {})
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
  });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: r.status, ok: r.ok, json, text };
}

export async function setGithub({ token }) {
  const t = String(token || '').trim();
  if (!t) throw new Error('GitHub token is required.');
  const r = await fetch(GH_API + '/user', {
    headers: { Authorization: 'Bearer ' + t, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': GH_VER, 'User-Agent': 'portrox' }
  });
  if (r.ok === false) throw new Error('GitHub token rejected (HTTP ' + r.status + '). Needs repo + workflow scope.');
  const j = await r.json();
  const c = loadConfig();
  c.github.token = t;
  c.github.login = j.login || '';
  c.github.scopes = r.headers.get('x-oauth-scopes') || '';
  saveConfig(c);
  return maskedConfig();
}

export async function gh(path, opts = {}) {
  const c = loadConfig();
  if (!c.github.token) throw new Error('Configure GitHub token in Setup first.');
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

/** Git credential helper reads the PAT from ENV only — never argv, never .git/config. */
export function gitEnv() {
  const c = loadConfig();
  if (!c.github.token) throw new Error('Configure GitHub token in Setup first.');
  return {
    ...process.env,
    GH_TOKEN: c.github.token,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'credential.helper',
    GIT_CONFIG_VALUE_0: '!f() { echo "username=x-access-token"; echo "password=$GH_TOKEN"; }; f'
  };
}

export function publicSupabase() {
  const c = loadConfig();
  if (!c.supabase.url || !c.supabase.publishable_key) return { url: '', publishable_key: '' };
  assertPublicKey(c.supabase.publishable_key);
  return { url: c.supabase.url, publishable_key: c.supabase.publishable_key };
}
