/**
 * Supabase Management API client. ONE account token, MANY projects.
 *
 * VERIFIED against the published reference:
 *  - GET /v1/projects/{ref}/health requires `services`. Response name enum:
 *    auth|db|db_postgres_user|pooler|realtime|rest|storage|pg_bouncer
 *    Response status enum: COMING_UP|ACTIVE_HEALTHY|UNHEALTHY ('healthy' deprecated).
 *    The REQUEST enum was not published in expanded form, so we send repeated
 *    keys (OpenAPI form/explode array style) and self-heal to services=db on 400.
 *  - POST /v1/projects: name, db_pass, organization_slug, region_selection.
 *    organization_id / region / plan are DEPRECATED. desired_instance_size omitted.
 *  - GET /v1/projects/{ref}/api-keys?reveal=true ; POST to create if absent.
 *  - POST /v1/projects/{ref}/database/migrations (worked for this account).
 *  - POST /v1/projects/{ref}/database/query (experimental fallback).
 *  - POST /pause, POST /restart, GET|POST /restore exist.
 *
 * UNVERIFIED (labelled, confirmed, error surfaced):
 *  - PATCH /v1/projects/{ref}/database/password request body shape.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const API = 'https://api.supabase.com';

export class MgmtError extends Error {
  constructor(message, status, body) { super(message); this.status = status; this.body = body; }
}

async function call(token, path, opts = {}) {
  if (!token) throw new MgmtError('Supabase access token not set. Studio → Settings → Supabase account.', 0, null);
  const r = await fetch(API + path, {
    method: opts.method || 'GET',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json',
      'User-Agent': 'portrox-studio',
      ...(opts.body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
  });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
  if (!r.ok) {
    const msg = (json && (json.message || json.error || json.msg)) || text.slice(0, 300) || ('HTTP ' + r.status);
    throw new MgmtError(msg, r.status, json);
  }
  return json;
}

/** Repeated keys, never a %2C-joined single value. */
const repeat = (key, values) => values.map(v => key + '=' + encodeURIComponent(String(v))).join('&');

export const SMART_GROUPS = ['americas', 'emea', 'apac'];
export const HEALTH_SERVICE_ENUM = ['auth', 'db', 'db_postgres_user', 'pooler', 'realtime', 'rest', 'storage', 'pg_bouncer'];
/** Conservative request default: these four certainly exist. */
export const HEALTH_SERVICES = ['db', 'auth', 'rest', 'storage'];
export const BOOTSTRAP_FILES = [
  '20261117220000_portrox_init.sql',
  '20261118230000_studio_owner.sql'
];
/* PORTROX_NO_HARDCODED_REF: no personal project ref lives in public source.
   full_history is gated by a typed confirmation of the target ref instead. */

export async function profile(token) { return call(token, '/v1/profile'); }
export async function listOrganizations(token) {
  const rows = await call(token, '/v1/organizations');
  return (Array.isArray(rows) ? rows : []).map(o => ({ id: o.id, slug: o.slug || o.id, name: o.name || o.slug || o.id }));
}
export async function listProjects(token) {
  const rows = await call(token, '/v1/projects');
  return (Array.isArray(rows) ? rows : []).map(p => ({
    ref: p.ref || p.id, name: p.name, organization_slug: p.organization_slug || '',
    region: p.region || '', status: p.status || 'UNKNOWN', created_at: p.created_at || ''
  }));
}
export async function availableRegions(token) {
  try { return await call(token, '/v1/projects/available-regions'); }
  catch { return { smartGroup: SMART_GROUPS }; }
}
export async function getProject(token, ref) { return call(token, '/v1/projects/' + encodeURIComponent(ref)); }

/** A2/A3 FIX: repeated keys + self-heal to a single service on a 400. */
export async function projectHealth(token, ref, services = HEALTH_SERVICES) {
  const list = (Array.isArray(services) ? services : String(services).split(',')).map(s => s.trim()).filter(Boolean);
  if (list.length === 0) throw new MgmtError('health requires at least one service', 0, null);
  const base = '/v1/projects/' + encodeURIComponent(ref) + '/health';
  try {
    return await call(token, base + '?' + repeat('services', list));
  } catch (e) {
    if (e.status === 400 && list.length > 1) {
      try {
        const single = await call(token, base + '?services=db');
        return Array.isArray(single) ? single : [single];
      } catch (e2) {
        throw new MgmtError('multi-service: ' + e.message + ' | single-service: ' + e2.message, e2.status || e.status, e2.body || e.body);
      }
    }
    throw e;
  }
}

export async function createProject(token, { name, organization_slug, db_pass, region_code }) {
  if (!name) throw new MgmtError('Project name is required.', 0, null);
  if (!organization_slug) throw new MgmtError('organization_slug is required (organization_id is deprecated).', 0, null);
  if (!db_pass || db_pass.length < 16) throw new MgmtError('db_pass must be at least 16 characters.', 0, null);
  const code = SMART_GROUPS.includes(region_code) ? region_code : 'apac';
  return call(token, '/v1/projects', {
    method: 'POST',
    body: { name, organization_slug, db_pass, region_selection: { type: 'smartGroup', code } }
  });
}

const HEALTHY = 'ACTIVE_HEALTHY';
export function summariseHealth(h) {
  const list = (Array.isArray(h) ? h : [h]).filter(Boolean);
  if (list.length === 0) return { status: 'COMING_UP', summary: '(no services reported)', services: [] };
  const status = list.every(x => x.status === HEALTHY) ? HEALTHY
    : (list.some(x => x.status === 'UNHEALTHY') ? 'UNHEALTHY' : 'COMING_UP');
  return { status, summary: list.map(x => (x.name || 'svc') + '=' + x.status).join(' '), services: list };
}
export async function waitHealthy(token, ref, { timeoutMs = 240000, intervalMs = 6000, onTick } = {}) {
  const t0 = Date.now();
  let last = 'UNKNOWN';
  while (Date.now() - t0 < timeoutMs) {
    let status = last;
    try { status = summariseHealth(await projectHealth(token, ref)).status; }
    catch (e) {
      const st = Number(e && e.status || 0);
      if (st === 401 || st === 403 || st === 402) {
        return { ok: false, status: 'AUTH_ERROR', error: e.message, waitedMs: Date.now() - t0 };
      }
      status = 'POLL_ERROR: ' + e.message;
    }
    last = status;
    if (onTick) onTick(status, Math.round((Date.now() - t0) / 1000));
    if (status === HEALTHY) return { ok: true, status, waitedMs: Date.now() - t0 };
    if (/INIT_FAILED|REMOVED|RESTORE_FAILED/.test(status)) return { ok: false, status, waitedMs: Date.now() - t0 };
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return { ok: false, status: last, waitedMs: Date.now() - t0, timedOut: true };
}

export async function ensurePublishableKey(token, ref) {
  const p = encodeURIComponent(ref);
  let arr = await call(token, '/v1/projects/' + p + '/api-keys?reveal=true');
  arr = Array.isArray(arr) ? arr : [];
  let pub = arr.find(k => k && k.type === 'publishable' && k.api_key);
  if (!pub) {
    await call(token, '/v1/projects/' + p + '/api-keys', { method: 'POST', body: { type: 'publishable', name: 'default' } });
    arr = await call(token, '/v1/projects/' + p + '/api-keys?reveal=true');
    arr = Array.isArray(arr) ? arr : [];
    pub = arr.find(k => k && k.type === 'publishable' && k.api_key);
  }
  if (!pub) {
    const legacy = arr.find(k => k && k.name === 'anon' && k.api_key);
    if (legacy) return { key: legacy.api_key, kind: 'legacy-anon' };
    throw new MgmtError('No publishable key returned by the Management API.', 0, arr);
  }
  return { key: pub.api_key, kind: 'publishable' };
}
export async function listKeyTypes(token, ref) {
  const arr = await call(token, '/v1/projects/' + encodeURIComponent(ref) + '/api-keys');
  return (Array.isArray(arr) ? arr : []).map(k => ({ id: k.id, type: k.type, name: k.name }));
}

export async function runQuery(token, ref, query, { read_only = false, parameters } = {}) {
  const body = { query, read_only };
  if (Array.isArray(parameters) && parameters.length) body.parameters = parameters;
  return call(token, '/v1/projects/' + encodeURIComponent(ref) + '/database/query', { method: 'POST', body });
}
export async function listMigrations(token, ref) {
  return call(token, '/v1/projects/' + encodeURIComponent(ref) + '/database/migrations');
}
export async function applyMigration(token, ref, name, query, version) {
  const url = '/v1/projects/' + encodeURIComponent(ref) + '/database/migrations';
  // A5: without an explicit version Supabase invents a timestamp, so every
  // Bootstrap click added an orphan remote version. Send it; self-heal if refused.
  if (version) {
    try {
      const r = await call(token, url, { method: 'POST', body: { name, query, version } });
      return { ok: true, via: 'migrations', version, result: r };
    } catch (ev) {
      if (ev.status !== 400 && ev.status !== 422) {
        if (ev.status === 403 || ev.status === 404 || ev.status === 402) return { ok: false, restricted: true, status: ev.status, error: ev.message };
        throw ev;
      }
    }
  }
  try {
    const r = await call(token, url, { method: 'POST', body: { name, query } });
    return { ok: true, via: 'migrations', version_generated: true, result: r };
  } catch (e) {
    if (e.status === 403 || e.status === 404 || e.status === 402) return { ok: false, restricted: true, status: e.status, error: e.message };
    throw e;
  }
}
async function recordVersion(token, ref, version, name) {
  const lit = v => "'" + String(v).replace(/'/g, "''") + "'";
  await runQuery(token, ref, [
    'create schema if not exists supabase_migrations;',
    'create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);',
    'insert into supabase_migrations.schema_migrations (version, statements, name)',
    'values (' + lit(version) + ', array[' + lit('applied via management-api query fallback') + '], ' + lit(name) + ')',
    'on conflict (version) do nothing;'
  ].join('\n'));
}
export function migrationFiles(repoRoot, { bootstrap = true } = {}) {
  const dir = join(repoRoot, 'supabase', 'migrations');
  let files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  if (bootstrap) files = BOOTSTRAP_FILES.filter(f => files.includes(f));
  return files.map(f => ({ name: f.replace(/\.sql$/, ''), file: f, sql: readFileSync(join(dir, f), 'utf8') }));
}
/**
 * A4 FIX: bootstrap is the DEFAULT. The legacy sample history is only reachable
 * with full_history:true AND the legacy ref, so a new tenant can never receive
 * `GRANT ALL … TO anon` by clicking the ordinary button.
 */
export async function applySchema(token, ref, repoRoot, { full_history = false, confirm = '', onStep } = {}) {
  const wantFull = full_history === true;
  if (wantFull && confirm !== ref) {
    throw new MgmtError('full_history applies the LEGACY sample history (includes GRANT ALL TO anon). Type the project ref to confirm.', 0, null);
  }
  const bootstrap = !wantFull;
  const files = migrationFiles(repoRoot, { bootstrap });
  if (files.length === 0) throw new MgmtError('No migration files selected.', 0, null);
  const applied = []; let via = 'migrations';
  for (const m of files) {
    if (onStep) onStep(m.file, 'applying');
    const ver = m.name.replace(/_.*$/, '');
    const r = await applyMigration(token, ref, m.name, m.sql, ver);
    if (r.ok) {
      if (r.version_generated) await recordVersion(token, ref, ver, m.name);
      applied.push(m.file);
      if (onStep) onStep(m.file, 'ok (migrations' + (r.version_generated ? ', version recorded)' : ', version ' + ver + ')'));
      continue;
    }
    if (!r.restricted) throw new MgmtError(r.error || 'migration failed', r.status, null);
    via = 'query';
    await runQuery(token, ref, m.sql);
    await recordVersion(token, ref, m.name.replace(/_.*$/, ''), m.name);
    applied.push(m.file);
    if (onStep) onStep(m.file, 'ok (query fallback, version recorded)');
  }
  return { applied, via, count: applied.length, bootstrap, full_history: wantFull,
    ...(wantFull ? { warning: 'Legacy history applied: contact_messages, legacy_projects and GRANT ALL TO anon are now present.' } : {}) };
}

export async function pauseProject(token, ref) { return call(token, '/v1/projects/' + encodeURIComponent(ref) + '/pause', { method: 'POST' }); }
export async function restartProject(token, ref) { return call(token, '/v1/projects/' + encodeURIComponent(ref) + '/restart', { method: 'POST' }); }
export async function restoreStatus(token, ref) { return call(token, '/v1/projects/' + encodeURIComponent(ref) + '/restore'); }
export async function restoreProject(token, ref) { return call(token, '/v1/projects/' + encodeURIComponent(ref) + '/restore', { method: 'POST' }); }

/** A7: endpoint exists; request body shape UNVERIFIED. Requires confirmation. */
export async function rotateDbPassword(token, ref, password, confirm) {
  if (confirm !== ref) throw new MgmtError('confirmation must equal the project ref', 0, null);
  if (!password || String(password).length < 16) throw new MgmtError('password must be at least 16 characters.', 0, null);
  try {
    const r = await call(token, '/v1/projects/' + encodeURIComponent(ref) + '/database/password', { method: 'PATCH', body: { password } });
    return { ok: true, unverified_shape: true, result: r };
  } catch (e) {
    throw new MgmtError('rotate failed (body shape unverified): ' + e.message, e.status, e.body);
  }
}

export async function listSecrets(token, ref) {
  const arr = await call(token, '/v1/projects/' + encodeURIComponent(ref) + '/secrets');
  return (Array.isArray(arr) ? arr : []).map(s => ({ name: s.name }));
}
/** A6: validate names/values before sending. */
export async function setSecrets(token, ref, pairs) {
  if (!Array.isArray(pairs) || pairs.length === 0) throw new MgmtError('secrets must be a non-empty array of {name,value}', 0, null);
  for (const p of pairs) {
    if (!p || typeof p.name !== 'string' || !/^[A-Z_][A-Z0-9_]*$/.test(p.name)) {
      throw new MgmtError('invalid secret name: ' + (p && p.name) + ' (uppercase letters, digits, underscore)', 0, null);
    }
    if (p.name.startsWith('SUPABASE_')) throw new MgmtError('SUPABASE_ prefix is reserved: ' + p.name, 0, null);
    if (typeof p.value !== 'string' || p.value.length === 0) throw new MgmtError('empty value for ' + p.name, 0, null);
  }
  return call(token, '/v1/projects/' + encodeURIComponent(ref) + '/secrets', {
    method: 'POST', body: pairs.map(p => ({ name: p.name, value: p.value }))
  });
}
/** A5: repeated name= keys, not a comma join. */
export async function deleteSecrets(token, ref, names) {
  const list = (Array.isArray(names) ? names : [names]).filter(Boolean);
  if (list.length === 0) throw new MgmtError('no secret names given', 0, null);
  return call(token, '/v1/projects/' + encodeURIComponent(ref) + '/secrets?' + repeat('name', list), { method: 'DELETE' });
}
export async function typescriptTypes(token, ref) {
  return call(token, '/v1/projects/' + encodeURIComponent(ref) + '/types/typescript');
}
export async function securityAdvisor(token, ref) {
  try { return await call(token, '/v1/projects/' + encodeURIComponent(ref) + '/advisors/security?lint_type=sql'); }
  catch (e) { return { unavailable: true, error: e.message }; }
}
export async function performanceAdvisor(token, ref) {
  try { return await call(token, '/v1/projects/' + encodeURIComponent(ref) + '/advisors/performance'); }
  catch (e) { return { unavailable: true, error: e.message }; }
}
