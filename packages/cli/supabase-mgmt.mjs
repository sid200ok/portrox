/**
 * Supabase Management API client. ONE account token, MANY projects.
 * Verified against the published reference:
 *  - POST /v1/projects            body: name, db_pass, organization_slug, region_selection
 *                                 (organization_id / region / plan are DEPRECATED)
 *  - GET  /v1/projects/{ref}/health          poll until ACTIVE_HEALTHY
 *  - GET  /v1/projects/{ref}/api-keys?reveal=true   then POST to create if absent
 *  - POST /v1/projects/{ref}/database/migrations    SELECT CUSTOMERS ONLY -> fallback
 *  - POST /v1/projects/{ref}/database/query         experimental/Beta, always available
 *  - GET  /v1/projects/available-regions            smartGroup: americas | emea | apac
 * The token is read from the local store and never returned to the browser.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const API = 'https://api.supabase.com';

export class MgmtError extends Error {
  constructor(message, status, body) { super(message); this.status = status; this.body = body; }
}

async function call(token, path, opts = {}) {
  if (!token) throw new MgmtError('Supabase access token not set. Add it in Settings -> Supabase account.', 0, null);
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

export const SMART_GROUPS = ['americas', 'emea', 'apac'];

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

export async function projectHealth(token, ref) {
  return call(token, '/v1/projects/' + encodeURIComponent(ref) + '/health');
}

/** Create returns status INACTIVE; caller MUST wait for ACTIVE_HEALTHY. */
export async function createProject(token, { name, organization_slug, db_pass, region_code }) {
  if (!name) throw new MgmtError('Project name is required.', 0, null);
  if (!organization_slug) throw new MgmtError('organization_slug is required (organization_id is deprecated).', 0, null);
  if (!db_pass || db_pass.length < 16) throw new MgmtError('db_pass must be at least 16 characters.', 0, null);
  const code = SMART_GROUPS.includes(region_code) ? region_code : 'apac';
  return call(token, '/v1/projects', {
    method: 'POST',
    body: { name, organization_slug, db_pass, region_selection: { type: 'smartGroup', code } }
    // desired_instance_size intentionally omitted: >= micro cannot scale to zero.
  });
}

const HEALTHY = 'ACTIVE_HEALTHY';

export async function waitHealthy(token, ref, { timeoutMs = 240000, intervalMs = 5000, onTick } = {}) {
  const t0 = Date.now();
  let last = 'UNKNOWN';
  while (Date.now() - t0 < timeoutMs) {
    let status = last;
    try {
      const h = await projectHealth(token, ref);
      const list = Array.isArray(h) ? h : [h];
      const db = list.find(x => x && (x.name === 'db' || x.identifier === 'db')) || list[0];
      status = (db && db.status) || last;
      if (list.length && list.every(x => !x || x.status === HEALTHY)) status = HEALTHY;
    } catch (e) { status = 'POLL_ERROR: ' + e.message; }
    last = status;
    if (onTick) onTick(status, Math.round((Date.now() - t0) / 1000));
    if (status === HEALTHY) return { ok: true, status, waitedMs: Date.now() - t0 };
    if (/INIT_FAILED|REMOVED|RESTORE_FAILED/.test(status)) return { ok: false, status, waitedMs: Date.now() - t0 };
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return { ok: false, status: last, waitedMs: Date.now() - t0, timedOut: true };
}

/** GET keys; create the publishable key if the project predates the new key model. */
export async function ensurePublishableKey(token, ref) {
  const p = encodeURIComponent(ref);
  let keys = await call(token, '/v1/projects/' + p + '/api-keys?reveal=true');
  let arr = Array.isArray(keys) ? keys : [];
  let pub = arr.find(k => k && k.type === 'publishable' && k.api_key);
  if (!pub) {
    await call(token, '/v1/projects/' + p + '/api-keys', { method: 'POST', body: { type: 'publishable', name: 'default' } });
    keys = await call(token, '/v1/projects/' + p + '/api-keys?reveal=true');
    arr = Array.isArray(keys) ? keys : [];
    pub = arr.find(k => k && k.type === 'publishable' && k.api_key);
  }
  if (!pub) {
    const legacy = arr.find(k => k && k.name === 'anon' && k.api_key);
    if (legacy) return { key: legacy.api_key, kind: 'legacy-anon' };
    throw new MgmtError('No publishable key returned by the Management API.', 0, arr);
  }
  return { key: pub.api_key, kind: 'publishable' };
}

/** Experimental/Beta but broadly available. */
export async function runQuery(token, ref, query, { read_only = false, parameters } = {}) {
  const body = { query, read_only };
  if (Array.isArray(parameters) && parameters.length) body.parameters = parameters;
  return call(token, '/v1/projects/' + encodeURIComponent(ref) + '/database/query', { method: 'POST', body });
}

/** Restricted endpoint; returns {restricted:true} so the caller can fall back. */
export async function applyMigration(token, ref, name, query) {
  try {
    const r = await call(token, '/v1/projects/' + encodeURIComponent(ref) + '/database/migrations', {
      method: 'POST', body: { name, query }
    });
    return { ok: true, via: 'migrations', result: r };
  } catch (e) {
    if (e.status === 403 || e.status === 404 || e.status === 402) return { ok: false, restricted: true, status: e.status, error: e.message };
    throw e;
  }
}

export async function securityAdvisor(token, ref) {
  try { return await call(token, '/v1/projects/' + encodeURIComponent(ref) + '/advisors/security'); }
  catch (e) { return { unavailable: true, error: e.message }; }
}

/** Ordered migration files from the repo. */
export function migrationFiles(repoRoot) {
  const dir = join(repoRoot, 'supabase', 'migrations');
  return readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
    .map(f => ({ name: f.replace(/\.sql$/, ''), file: f, sql: readFileSync(join(dir, f), 'utf8') }));
}

/**
 * Apply the Portrox schema to a project. Tries the restricted migrations
 * endpoint first (transactional, recorded in supabase_migrations), then falls
 * back to the experimental query endpoint. Idempotent because every migration
 * uses IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS.
 */
export async function applySchema(token, ref, repoRoot, { onStep } = {}) {
  const files = migrationFiles(repoRoot);
  const applied = [];
  let via = 'migrations';
  for (const m of files) {
    if (onStep) onStep(m.file, 'applying');
    const r = await applyMigration(token, ref, m.name, m.sql);
    if (r.ok) { applied.push(m.file); if (onStep) onStep(m.file, 'ok (migrations)'); continue; }
    if (!r.restricted) throw new MgmtError(r.error || 'migration failed', r.status, null);
    via = 'query';
    await runQuery(token, ref, m.sql);
    applied.push(m.file);
    if (onStep) onStep(m.file, 'ok (query fallback)');
  }
  return { applied, via, count: applied.length };
}
