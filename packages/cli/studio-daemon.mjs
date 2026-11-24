/**
 * Portrox Studio daemon. 127.0.0.1:0 -> kernel-assigned port.
 * Every data route needs: valid Host + session cookie + CSRF token.
 * ONE Supabase account token -> MANY projects. Each site binds one project_ref.
 */
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, rmSync, cpSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, extname, normalize, resolve, dirname, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  maskedConfig, loadConfig, setAccessToken, recordTokenError, clearAccessToken, setDefaultProject,
  accessToken, upsertProject, projectRecord, generateDbPassword, publicSupabaseFor,
  setGithub, gh, gitEnv, FREE_ACTIVE_PROJECT_LIMIT, reconcileSchema, schemaComplete, schemaMissing
} from './config-store.mjs';
import * as M from './supabase-mgmt.mjs';
import * as DB from './db-bridge.mjs';
import * as GH from './github-ops.mjs';
import * as CS from './content-store.mjs'; // PORTROX_CONTENT_API
import * as IB from './inbox-store.mjs'; // PORTROX_INBOX_API
import * as MD from './media-store.mjs'; // PORTROX_MEDIA_API
import * as IW from './intro-wizard.mjs'; // PORTROX_INTRO_API
import * as BK from './backup-key.mjs'; // PORTROX_BACKUP_KEY_API // PORTROX_GH_ROUTES
import * as AUTHSTORE from './auth-store.mjs';
import { renderLogin, renderApp } from './studio-ui.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = process.env.PORTROX_REPO || resolve(HERE, '../..');
const HOME = process.env.PORTROX_HOME || join(homedir(), '.portrox');
const HOST = '127.0.0.1';
const STATE = join(HOME, 'state.json');
const VERSION = '0.5.0';
const CSRF = randomBytes(24).toString('hex');
mkdirSync(HOME, { recursive: true, mode: 0o700 });
try { chmodSync(HOME, 0o700); } catch {}
AUTHSTORE.load();

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8' };
const sitesDir = join(REPO, 'sites');
const listSites = () => existsSync(sitesDir) ? readdirSync(sitesDir).filter(n => { try { return statSync(join(sitesDir, n)).isDirectory(); } catch { return false; } }) : [];
const cfgOf = n => { try { return JSON.parse(readFileSync(join(sitesDir, n, 'site.json'), 'utf8')); } catch { return {}; } };
const writeCfg = (n, c) => writeFileSync(join(sitesDir, n, 'site.json'), JSON.stringify(c, null, 2) + '\n');
const log = (...a) => console.log('[portrox]', ...a);
const redact = s => String(s || '')
  .replace(/sbp_[A-Za-z0-9]+/g, '[REDACTED_PAT]')
  .replace(/ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+/g, '[REDACTED_PAT]')
  .replace(/sb_secret_[A-Za-z0-9_-]+/g, '[REDACTED_KEY]')
  .replace(/postgresql:\/\/[^\s@]+@/g, 'postgresql://[REDACTED]@');
const slug = raw => String(raw || '').trim().toLowerCase().replace(/[^a-z0-9.-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...(opts || {}) });
  return { ok: r.status === 0, out: String(r.stdout || '').trim(), err: String(r.stderr || '').trim() };
}
const git = (args, cwd) => { let env; try { env = gitEnv(); } catch (e) { return { ok: false, out: '', err: e.message }; } return run('git', args, { cwd, env }); };

function createSite({ name, mode, headline }) {
  const g = maskedConfig().github;
  if (!g.login) throw new Error('Connect GitHub in Settings first — the token determines the account.');
  const base = slug(name);
  const m = ['user', 'project', 'org', 'custom'].includes(mode) ? mode : 'project';
  let folder, repo, base_path, url, owner;
  if (m === 'user') { folder = g.login + '.github.io'; repo = g.login + '/' + folder; base_path = ''; url = 'https://' + folder; owner = g.login; }
  else if (m === 'org') { if (!base) throw new Error('org mode needs the organisation login as name'); folder = base + '.github.io'; repo = base + '/' + folder; base_path = ''; url = 'https://' + folder; owner = base; }
  else {
    if (!base) throw new Error('Site name is required.');
    folder = base + '.github.io'; repo = g.login + '/' + base; owner = g.login;
    if (m === 'custom') { base_path = ''; url = ''; } else { base_path = '/' + base; url = 'https://' + g.login + '.github.io/' + base; }
  }
  const root = join(sitesDir, folder);
  if (existsSync(root)) throw new Error('Site already exists: ' + folder);
  for (const d of ['content', 'data', 'assets/avatars', 'assets/covers', 'assets/backgrounds']) mkdirSync(join(root, d), { recursive: true });
  const def = loadConfig().supabase.default_project_ref;
  const cfg = {
    id: folder, name: folder, owner,
    pages: { mode: m, repo, branch: 'gh-pages', base_path, cname: '' },
    database: { mode: def ? 'shared' : 'dedicated', project_ref: def || '' },
    seo: { title: (headline || base || folder) + ' — Portfolio', description: 'Portfolio built with Portrox.', og_image: '' },
    nav: { services: true, appointments: true, about: true, client_auth: false },
    theme: { bg: '#020617', panel: '#0f172a', accent: '#22d3ee' },
    supabase: { url: '', publishable_key: '' },
    flags: { available_for_hire: true, paid_booking: false, auto_email: false },
    live_url: url, registered: false, published: false
  };
  writeCfg(folder, cfg);
  writeFileSync(join(root, 'content/intro.md'), '# ' + (headline || base || folder) + '\n\nBuilder. Engineer. Available for remote work.\n');
  writeFileSync(join(root, 'content/about.md'), '## About me\n\nWrite your professional overview here.\n');
  writeFileSync(join(root, 'data/profile.json'), JSON.stringify({ full_name: headline || base || folder, headline: '', location: '', hourly_rate: null, avatar: '', skills: [], links: {} }, null, 2) + '\n');
  for (const f of ['experience', 'projects', 'services']) writeFileSync(join(root, 'data', f + '.json'), '[]\n');
  writeFileSync(join(root, 'data/availability.json'), JSON.stringify({ timezone: 'UTC', duration_minutes: 30, weekly: [] }, null, 2) + '\n');
  return cfg;
}

function bindDatabase(id, { mode, project_ref }) {
  const cfg = cfgOf(id);
  const m = mode === 'dedicated' ? 'dedicated' : 'shared';
  const ref = String(project_ref || '').trim();
  if (!ref) throw new Error('Select a Supabase project for this site.');
  if (!projectRecord(ref)) throw new Error('Unknown project ref: ' + ref);
  cfg.database = { mode: m, project_ref: ref };
  cfg.registered = false;
  writeCfg(id, cfg);
  return { site_id: id, database: cfg.database };
}

async function registerSite(id) {
  const cfg = cfgOf(id);
  const ref = DB.boundRef(cfg);
  if (!ref) throw new Error('No Supabase project bound. Studio -> site -> Database.');
  const p = projectRecord(ref);
  // PORTROX_SCHEMA_GATE: require the actual bootstrap files, not a count.
  if (!p || schemaComplete(p) === false) {
    throw new Error('Portrox schema incomplete on ' + ref + ' — missing: ' + schemaMissing(p).join(', ') + '. Click Bootstrap first.');
  }
  const r = await DB.registerSite(ref, id, cfg, AUTHSTORE.publicState().username);
  if (!r.ok) throw new Error('register failed: ' + redact(r.error));
  cfg.registered = true; writeCfg(id, cfg);
  return { registered: true, site_id: id, project_ref: ref, via: r.via };
}

function buildOne(id) {
  const cfg = cfgOf(id);
  cfg.supabase = publicSupabaseFor(DB.boundRef(cfg));
  writeCfg(id, cfg);
  return import(join(REPO, 'packages/core/render.mjs')).then(m => m.renderSite(join(sitesDir, id), join(REPO, 'dist', id)));
}

async function ensureRepo(cfg) {
  const owner = cfg.pages.repo.split('/')[0];
  const name = cfg.pages.repo.split('/')[1];
  if ((await gh('/repos/' + cfg.pages.repo)).ok) return { repo: cfg.pages.repo, created: false };
  const g = maskedConfig().github;
  const body = { name, private: false, description: 'Portfolio published by Portrox', has_issues: false, has_wiki: false };
  const cr = owner === g.login ? await gh('/user/repos', { method: 'POST', body }) : await gh('/orgs/' + owner + '/repos', { method: 'POST', body });
  if (!cr.ok) throw new Error('repo create failed: ' + cr.status + ' ' + cr.text.slice(0, 200));
  return { repo: cfg.pages.repo, created: true };
}

async function configurePages(cfg) {
  const body = { build_type: 'legacy', source: { branch: cfg.pages.branch || 'gh-pages', path: '/' },
    ...(cfg.pages.mode === 'custom' && cfg.pages.cname ? { cname: cfg.pages.cname, https_enforced: true } : {}) };
  let r = await gh('/repos/' + cfg.pages.repo + '/pages', { method: 'POST', body });
  if (!r.ok) r = await gh('/repos/' + cfg.pages.repo + '/pages', { method: 'PUT', body });
  if (!r.ok) throw new Error('pages config failed: ' + r.status + ' ' + r.text.slice(0, 200));
  const disabled = [];
  for (const wf of ['deploy-pages.yml', 'pages.yml']) {
    if ((await gh('/repos/' + cfg.pages.repo + '/actions/workflows/' + wf + '/disable', { method: 'PUT' })).ok) disabled.push(wf);
  }
  const check = await gh('/repos/' + cfg.pages.repo + '/pages');
  return { pages: check.json ? { build_type: check.json.build_type, source: check.json.source, status: check.json.status } : null, disabled_workflows: disabled };
}

async function publish(id) {
  const cfg = cfgOf(id);
  if (cfg.pages.mode === 'custom' && !cfg.pages.cname) throw new Error('custom mode: set pages.cname in site.json before publishing.');
  const ref = DB.boundRef(cfg);
  if (!ref) throw new Error('No Supabase project bound to this site.');
  if (cfg.registered !== true) await registerSite(id);
  await ensureRepo(cfg);
  await buildOne(id);
  const src = join(REPO, 'dist', id);
  const tmp = join(HOME, 'publish-' + id.replace(/[^a-z0-9.-]/gi, '_') + '-' + Date.now());
  mkdirSync(tmp, { recursive: true, mode: 0o700 });
  try {
    const remote = 'https://github.com/' + cfg.pages.repo + '.git';
    if (git(['clone', '--depth', '1', remote, tmp]).ok === false) {
      git(['init', '-q', '-b', 'portrox-publish'], tmp);
      if (git(['remote', 'get-url', 'origin'], tmp).ok) git(['remote', 'set-url', 'origin', remote], tmp);
      else git(['remote', 'add', 'origin', remote], tmp);
    }
    if (git(['checkout', '--orphan', 'publish-' + Date.now()], tmp).ok === false) throw new Error('orphan checkout failed');
    for (const e of readdirSync(tmp)) if (e !== '.git') rmSync(join(tmp, e), { recursive: true, force: true });
    cpSync(src, tmp, { recursive: true });
    writeFileSync(join(tmp, '.nojekyll'), '');
    git(['add', '-A'], tmp);
    const cm = git(['-c', 'user.name=Portrox', '-c', 'user.email=portrox@localhost', 'commit', '-m', 'Publish via Portrox'], tmp);
    if (cm.ok === false && /nothing to commit/i.test(cm.out + cm.err) === false) throw new Error('commit failed: ' + cm.err);
    const push = git(['push', '-f', 'origin', 'HEAD:refs/heads/' + (cfg.pages.branch || 'gh-pages')], tmp);
    if (push.ok === false) throw new Error('push failed: ' + redact(push.err));
    const pages = await configurePages(cfg);
    const mark = await DB.markPublished(ref, id, true);
    if (!mark.ok) throw new Error('mark published failed: ' + redact(mark.error));
    const c2 = cfgOf(id); c2.published = true; c2.registered = true; writeCfg(id, c2);
    return { url: cfg.live_url || '(set cname)', repo: cfg.pages.repo, project_ref: ref, is_published: true, ...pages };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

/** Refresh the project list from the account. Keys are fetched lazily per project. */
async function refreshProjects() {
  const t = accessToken();
  const [orgs, projects] = [await M.listOrganizations(t), await M.listProjects(t)];
  const c = loadConfig();
  c.supabase.orgs = orgs;
  for (const p of projects) {
    const cur = c.supabase.projects[p.ref] || {};
    c.supabase.projects[p.ref] = { ...cur, ref: p.ref, name: p.name, organization_slug: p.organization_slug,
      region: p.region, status: p.status, created_at: p.created_at, url: 'https://' + p.ref + '.supabase.co' };
  }
  const { saveConfig } = await import('./config-store.mjs');
  saveConfig(c);
  return maskedConfig();
}

async function createProject({ name, organization_slug, region_code, store_password, site_id }) {
  const t = accessToken();
  const c = loadConfig();
  const active = Object.values(c.supabase.projects).filter(p => /ACTIVE/.test(p.status || '')).length;
  const slugOrg = String(organization_slug || (c.supabase.orgs[0] && c.supabase.orgs[0].slug) || '').trim();
  if (!slugOrg) throw new Error('organization_slug is required. Validate the token first so organisations load.');
  const pass = generateDbPassword();
  const created = await M.createProject(t, { name: String(name || '').trim() || 'portrox-site', organization_slug: slugOrg, db_pass: pass, region_code });
  const ref = created.ref || created.id;
  upsertProject(ref, {
    ref, name: created.name, organization_slug: created.organization_slug || slugOrg,
    region: created.region || '', status: created.status || 'INACTIVE',
    created_at: created.created_at || '', url: 'https://' + ref + '.supabase.co',
    db_password: store_password === true ? pass : '', db_password_stored: store_password === true
  });
  // Non-blocking: return immediately, let the UI poll /projects/:ref/health.
  const wait = await M.waitHealthy(t, ref, { timeoutMs: 25000, intervalMs: 5000 });
  upsertProject(ref, { status: wait.status, health: wait.status, health_at: Date.now() });
  let key = null, schema = null;
  if (wait.ok) {
    key = await DB.ensureKey(ref);
    schema = await DB.applySchema(ref, REPO, {});
  }
  if (site_id && listSites().includes(site_id)) bindDatabase(site_id, { mode: 'dedicated', project_ref: ref });
  return {
    ref, status: wait.status, healthy: wait.ok, waited_seconds: Math.round(wait.waitedMs / 1000),
    key, schema, free_limit: FREE_ACTIVE_PROJECT_LIMIT, active_before: active,
    at_free_cap: active >= FREE_ACTIVE_PROJECT_LIMIT,
    next_action: wait.ok ? 'ready' : 'poll /api/supabase/projects/' + ref + '/health until ACTIVE_HEALTHY, then Fetch key + Apply schema',
    db_password_once: pass,
    password_stored: store_password === true,
    notice: 'This password CANNOT be changed via the API later. Save it now.'
  };
}

function safeJoin(root, rel) {
  const base = resolve(root);
  const p = resolve(join(base, normalize(rel)));
  return (p === base || p.startsWith(base + sep)) ? p : null;
}
function readBody(req) {
  return new Promise(res => {
    let b = '', over = false;
    req.on('data', c => { b += c; if (b.length > 1e6) { over = true; req.removeAllListeners('data'); res({ __oversize: true }); } });
    req.on('end', () => { if (over) return; try { res(JSON.parse(b || '{}')); } catch { res({}); } });
    req.on('error', () => res({}));
  });
}
function cookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

const server = createServer(async (req, res) => {
  const port = server.address().port;
  const u = new URL(req.url, 'http://127.0.0.1');
  const send = (c, b, t, extra) => {
    res.writeHead(c, { 'Content-Type': t || 'text/plain; charset=utf-8', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', ...(extra || {}) });
    res.end(b);
  };
  const json = (c, o, extra) => send(c, JSON.stringify(o), MIME['.json'], extra);
  const html = (c, b, extra) => send(c, b, MIME['.html'], extra);

  try {
    const host = String(req.headers.host || '');
    if (host !== HOST + ':' + port && host !== 'localhost:' + port) return json(403, { error: 'bad host' });
    const sid = cookie(req, 'portrox_sid');
    const sess = AUTHSTORE.session(sid);

    if (req.method === 'GET' && u.pathname === '/api/health') return json(200, { ok: true, pid: process.pid, port, psql: Boolean(DB.psqlPath()) });
    if (req.method === 'GET' && u.pathname === '/api/session') return json(200, { authenticated: Boolean(sess), csrf: CSRF, auth: AUTHSTORE.publicState() });
    if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) {
      return sess
        ? html(200, renderApp({ csrf: CSRF, auth: AUTHSTORE.publicState(), port, pid: process.pid, version: VERSION }))
        : html(200, renderLogin({ csrf: CSRF, state: AUTHSTORE.publicState(), port }));
    }

    if (req.method === 'POST') {
      if (req.headers['x-portrox-token'] !== CSRF) return json(403, { error: 'bad token' });
      const origin = req.headers.origin;
      if (origin && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin) === false) return json(403, { error: 'bad origin' });
      const b = await readBody(req);
      if (b.__oversize) return json(413, { error: 'body too large' });
      const p = u.pathname;

      if (p === '/api/auth/login') {
        try { const r = AUTHSTORE.login(b);
          return json(200, { ok: true, auth: AUTHSTORE.publicState() },
            { 'Set-Cookie': 'portrox_sid=' + r.sid + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800' });
        } catch (e) { return json(401, { error: e.message }); }
      }
      if (p === '/api/auth/recover') { try { return json(200, AUTHSTORE.recover(b)); } catch (e) { return json(400, { error: e.message }); } }
      if (p === '/api/auth/reset') { try { return json(200, AUTHSTORE.resetWithToken(b)); } catch (e) { return json(400, { error: e.message }); } }

      if (!sess) return json(401, { error: 'authentication required' });

      if (p === '/api/auth/logout') { AUTHSTORE.logout(sid); return json(200, { ok: true }, { 'Set-Cookie': 'portrox_sid=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' }); }
      if (p === '/api/auth/dismiss') { try { return json(200, AUTHSTORE.dismissPrompt()); } catch (e) { return json(400, { error: e.message }); } }
      if (p === '/api/auth/credentials') {
        try { return json(200, AUTHSTORE.changeCredentials(b), { 'Set-Cookie': 'portrox_sid=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' }); }
        catch (e) { return json(400, { error: e.message }); }
      }
      if (p === '/api/auth/recovery/setup') { try { return json(200, AUTHSTORE.setupRecovery(b)); } catch (e) { return json(400, { error: e.message }); } }
      if (p === '/api/auth/recovery/key') { try { return json(200, AUTHSTORE.issueRecoveryKey(b)); } catch (e) { return json(400, { error: e.message }); } }

      /* ---------- ONE Supabase account ---------- */
      if (p === '/api/supabase/token') {
        try {
          const t = String(b.access_token || '').trim();
          if (!/^sbp_/.test(t)) throw new Error('Supabase personal access tokens start with sbp_.');
          const orgs = await M.listOrganizations(t);
          setAccessToken(t, orgs);
          return json(200, await refreshProjects());
        } catch (e) { recordTokenError(e.message); return json(400, { error: redact(e.message) }); }
      }
      if (p === '/api/supabase/forget') { try { return json(200, clearAccessToken()); } catch (e) { return json(400, { error: e.message }); } }
      if (p === '/api/supabase/refresh') { try { return json(200, await refreshProjects()); } catch (e) { return json(400, { error: redact(e.message) }); } }
      if (p === '/api/supabase/default') { try { return json(200, setDefaultProject(String(b.ref || ''))); } catch (e) { return json(400, { error: e.message }); } }
      if (p === '/api/supabase/regions') { try { return json(200, await M.availableRegions(accessToken())); } catch (e) { return json(400, { error: redact(e.message) }); } }
      if (p === '/api/supabase/projects') { try { return json(200, await createProject(b)); } catch (e) { return json(400, { error: redact(e.message) }); } }

      const pk = p.match(/^\/api\/supabase\/projects\/([a-z0-9]+)\/(key|schema|health|advisor|reconcile)$/);
      if (pk) {
        const ref = pk[1];
        if (!projectRecord(ref)) return json(404, { error: 'unknown project ref' });
        try {
          if (pk[2] === 'key') return json(200, await DB.ensureKey(ref));
          if (pk[2] === 'schema') return json(200, await DB.applySchema(ref, REPO, { full_history: b.full_history === true, confirm: b.confirm || '' }));
          if (pk[2] === 'health') return json(200, await DB.health(ref));
          // PORTROX_RECONCILE: observe migrations applied by the Supabase CLI.
          if (pk[2] === 'reconcile') {
            const r = await DB.schemaStatus(ref);
            if (!r.ok) throw new Error('cannot read supabase_migrations: ' + redact(r.error));
            // PORTROX_CANONICAL: map each observed version to its real filename,
            // so entries match what applySchema() records. No '_observed' suffix.
            const raw = Array.isArray(r.rows) ? (r.rows[0] && r.rows[0].versions) : r.out;
            const versions = String(raw || '').split(',').map(x => x.trim()).filter(Boolean);
            const files = readdirSync(join(REPO, 'supabase', 'migrations')).filter(f => f.endsWith('.sql')).sort();
            const canonical = [], unmatched = [];
            for (const v of versions) {
              const hit = files.find(f => f.startsWith(v + '_'));
              if (hit) canonical.push(hit); else unmatched.push(v);
            }
            const merged = reconcileSchema(ref, canonical, 'supabase-cli');
            return json(200, { ref, observed: versions, recorded: merged, unmatched });
          }
          return json(200, await M.securityAdvisor(accessToken(), ref));
        } catch (e) { upsertProject(ref, { last_error: redact(e.message) }); return json(400, { error: redact(e.message) }); }
      }

      /* ---------- GitHub operations: the button equivalent of gh ---------- */
      /* ---------- GitHub connection (gh CLI in the backend) ---------- */
      if (p === '/api/gh/auth/status') { try { return json(200, await GH.authStatus()); } catch (e) { return json(400, { error: redact(e.message) }); } }
      if (p === '/api/gh/auth/connect') { try { return json(200, await GH.connect(b)); } catch (e) { return json(400, { error: redact(e.message) }); } }
      if (p === '/api/gh/auth/system') { try { return json(200, await GH.useSystemSession()); } catch (e) { return json(400, { error: redact(e.message) }); } }
      if (p === '/api/gh/auth/disconnect') { try { return json(200, await GH.disconnect()); } catch (e) { return json(400, { error: redact(e.message) }); } }
      if (p === '/api/gh/rate') { try { return json(200, await GH.rateLimit()); } catch (e) { return json(400, { error: redact(e.message) }); } }
      if (p === '/api/gh/policy') { try { return json(200, GH.policy()); } catch (e) { return json(400, { error: redact(e.message) }); } }
      if (p === '/api/gh/console') { try { return json(200, await GH.console_(b)); } catch (e) { return json(400, { error: redact(e.message) }); } }
      if (p === '/api/github/secret/set') { try { return json(200, await GH.putSecret(b.repo, b.name, b.value)); } catch (e) { return json(400, { error: redact(e.message) }); } }
      if (p === '/api/github/variables') { try { return json(200, await GH.listVariables(b.repo)); } catch (e) { return json(400, { error: redact(e.message) }); } }
      if (p === '/api/github/variable/set') { try { return json(200, await GH.putVariable(b.repo, b.name, b.value)); } catch (e) { return json(400, { error: redact(e.message) }); } }
      if (p === '/api/github/artifacts') { try { return json(200, await GH.listArtifacts(b.repo)); } catch (e) { return json(400, { error: redact(e.message) }); } }
      /* ---------- Supabase advisors: report, do not merely count ---------- */
      if (p === '/api/supabase/advisors') {
        try {
          const ref = String(b.ref || loadConfig().supabase.default_project_ref || '');
          if (!projectRecord(ref)) return json(404, { error: 'unknown project ref' });
          const sec = await M.securityAdvisor(accessToken(), ref);
          const perf = await M.performanceAdvisor(accessToken(), ref);
          return json(200, { ref, security: sec, performance: perf });
        } catch (e) { return json(400, { error: redact(e.message) }); }
      }

      if (p === '/api/github/whoami') { try { return json(200, await GH.whoami()); } catch (e) { return json(400, { error: redact(e.message) }); } }
      if (p === '/api/github/repos') { try { return json(200, await GH.listRepos()); } catch (e) { return json(400, { error: redact(e.message) }); } }
      if (p === '/api/github/repo/get') { try { return json(200, await GH.getRepo(b.repo)); } catch (e) { return json(400, { error: redact(e.message) }); } }
      if (p === '/api/github/repo/create') { try { return json(200, await GH.createRepo(b)); } catch (e) { return json(400, { error: redact(e.message) }); } }
      if (p === '/api/github/repo/delete') { try { return json(200, await GH.deleteRepo(b.repo, b.confirm)); } catch (e) { return json(400, { error: redact(e.message) }); } }
      if (p === '/api/github/branches') { try { return json(200, await GH.listBranches(b.repo)); } catch (e) { return json(400, { error: redact(e.message) }); } }
      if (p === '/api/github/commits') { try { return json(200, await GH.listCommits(b.repo, b.branch)); } catch (e) { return json(400, { error: redact(e.message) }); } }
      if (p === '/api/github/releases') { try { return json(200, await GH.listReleases(b.repo)); } catch (e) { return json(400, { error: redact(e.message) }); } }
      if (p === '/api/github/pages/status') { try { return json(200, await GH.pagesStatus(b.repo)); } catch (e) { return json(400, { error: redact(e.message) }); } }
      if (p === '/api/github/pages/enable') { try { return json(200, await GH.pagesEnable(b.repo, b)); } catch (e) { return json(400, { error: redact(e.message) }); } }
      if (p === '/api/github/pages/update') { try { return json(200, await GH.pagesUpdate(b.repo, b)); } catch (e) { return json(400, { error: redact(e.message) }); } }
      if (p === '/api/github/pages/disable') { try { return json(200, await GH.pagesDisable(b.repo, b.confirm)); } catch (e) { return json(400, { error: redact(e.message) }); } }
      if (p === '/api/github/pages/builds') { try { return json(200, await GH.pagesBuilds(b.repo)); } catch (e) { return json(400, { error: redact(e.message) }); } }
      if (p === '/api/github/pages/latest') { try { return json(200, await GH.pagesLatestBuild(b.repo)); } catch (e) { return json(400, { error: redact(e.message) }); } }
      if (p === '/api/github/pages/build') { try { return json(200, await GH.pagesRequestBuild(b.repo)); } catch (e) { return json(400, { error: redact(e.message) }); } }
      if (p === '/api/github/pages/dns') { try { return json(200, await GH.pagesDnsHealth(b.repo)); } catch (e) { return json(400, { error: redact(e.message) }); } }
      if (p === '/api/github/workflows') { try { return json(200, await GH.listWorkflows(b.repo)); } catch (e) { return json(400, { error: redact(e.message) }); } }
      if (p === '/api/github/workflow/state') { try { return json(200, await GH.workflowSetState(b.repo, b.file, b.enable === true)); } catch (e) { return json(400, { error: redact(e.message) }); } }
      if (p === '/api/github/workflow/dispatch') { try { return json(200, await GH.workflowDispatch(b.repo, b.file, b.ref, b.inputs)); } catch (e) { return json(400, { error: redact(e.message) }); } }
      if (p === '/api/github/runs') { try { return json(200, await GH.listRuns(b.repo)); } catch (e) { return json(400, { error: redact(e.message) }); } }
      if (p === '/api/github/run/action') { try { return json(200, await GH.runAction(b.repo, b.id, b.action)); } catch (e) { return json(400, { error: redact(e.message) }); } }
      if (p === '/api/github/secrets') { try { return json(200, await GH.listSecretNames(b.repo)); } catch (e) { return json(400, { error: redact(e.message) }); } }
      if (p === '/api/github/secret/delete') { try { return json(200, await GH.deleteSecret(b.repo, b.name, b.confirm)); } catch (e) { return json(400, { error: redact(e.message) }); } }

      /* ---------- Phase 2: content editor ---------- */
      /* ---------- Inbox ---------- */
      if (p === '/api/inbox/triage') {
        try { return json(200, await IB.setTriage(String(b.id || ''), String(b.value || ''), b.project)); }
        catch (e) { return json(e.code || 400, { error: redact(e.message) }); }
      }
      if (p === '/api/inbox/delete') {
        try { return json(200, await IB.deleteSubmission(String(b.id || ''), String(b.confirm || ''), b.project)); }
        catch (e) { return json(e.code || 400, { error: redact(e.message) }); }
      }

      /* ---------- Media ---------- */
      if (p === '/api/media/upload') {
        try { return json(200, await MD.uploadMedia(REPO, String(b.site || ''), String(b.name || ''), b.data, { alt: String(b.alt || ''), kind: String(b.kind || 'image') })); }
        catch (e) { return json(e.code || 400, { error: redact(e.message) }); }
      }
      if (p === '/api/media/delete') {
        try { return json(200, await MD.deleteMedia(REPO, String(b.site || ''), String(b.name || ''), String(b.confirm || ''))); }
        catch (e) { return json(e.code || 400, { error: redact(e.message) }); }
      }
      if (p === '/api/media/avatar') {
        try { return json(200, await MD.setAvatar(REPO, String(b.site || ''), String(b.name || ''))); }
        catch (e) { return json(e.code || 400, { error: redact(e.message) }); }
      }

      /* ---------- Intro wizard ---------- */
      if (p === '/api/intro/preview') {
        try { return json(200, IW.previewIntro(REPO, String(b.site || ''), b.answers || {})); }
        catch (e) { return json(e.code || 400, { error: redact(e.message) }); }
      }
      if (p === '/api/intro/save') {
        try { return json(200, IW.saveIntro(REPO, String(b.site || ''), b.answers || {})); }
        catch (e) { return json(e.code || 400, { error: redact(e.message) }); }
      }

      /* ---------- Backup key custody (UI only) ---------- */
      if (p === '/api/backup/key/generate') {
        try { return json(200, BK.generateKey()); } catch (e) { return json(e.code || 400, { error: redact(e.message) }); }
      }
      if (p === '/api/backup/key/confirm') {
        try { return json(200, BK.confirmCustody()); } catch (e) { return json(e.code || 400, { error: redact(e.message) }); }
      }
      if (p === '/api/backup/key/clear') {
        try { return json(200, BK.clearKey(String(b.confirm || ''))); } catch (e) { return json(e.code || 400, { error: redact(e.message) }); }
      }

      if (p === '/api/content/write') {
        try { return json(200, CS.writeContent(REPO, String(b.site || ''), String(b.file || ''), b.text)); }
        catch (e) { return json(e.code || 400, { error: redact(e.message) }); }
      }

      if (p === '/api/config/github') { try { return json(200, await setGithub(b)); } catch (e) { return json(400, { error: redact(e.message) }); } }
      if (p === '/api/sites') { try { return json(200, createSite(b)); } catch (e) { return json(400, { error: e.message }); } }

      const sm = p.match(/^\/api\/sites\/([^/]+)\/(build|register|publish|db|db\/apply|db\/health|db\/key)$/);
      if (sm) {
        const id = decodeURIComponent(sm[1]);
        if (listSites().includes(id) === false) return json(404, { error: 'unknown site' });
        const act = sm[2];
        try {
          if (act === 'build') return json(200, await buildOne(id));
          if (act === 'register') return json(200, await registerSite(id));
          if (act === 'publish') return json(200, await publish(id));
          if (act === 'db') return json(200, bindDatabase(id, b));
          const ref = DB.boundRef(cfgOf(id));
          if (!ref) throw new Error('No Supabase project bound to this site.');
          if (act === 'db/apply') return json(200, await DB.applySchema(ref, REPO, { full_history: b.full_history === true, confirm: b.confirm || '' }));
          if (act === 'db/health') return json(200, await DB.health(ref));
          return json(200, await DB.ensureKey(ref));
        } catch (e) { return json(400, { error: redact(e.message) }); }
      }
      return json(404, { error: 'not found' });
    }

    if (req.method === 'GET') {
      if (!sess) return json(401, { error: 'authentication required' });
      if (u.pathname === '/api/config') return json(200, maskedConfig());
      if (u.pathname === '/api/backup/key') return json(200, BK.status());
      const iw = u.pathname.match(/^\/api\/intro\/([^/]+)$/);
      if (iw) {
        try {
          const sid = decodeURIComponent(iw[1]);
          return json(200, { markdown: IW.currentIntro(REPO, sid), defaults: IW.defaultsFromProfile(REPO, sid) });
        } catch (e) { return json(e.code || 400, { error: redact(e.message) }); }
      }
      const mm = u.pathname.match(/^\/api\/media\/([^/]+)$/);
      if (mm) {
        try {
          const sid = decodeURIComponent(mm[1]);
          return json(200, { files: MD.listMedia(REPO, sid), rows: await MD.dbRows(sid) });
        } catch (e) { return json(e.code || 400, { error: redact(e.message) }); }
      }
      const im = u.pathname.match(/^\/api\/inbox\/([^/]+)$/);
      if (im) {
        const sid = decodeURIComponent(im[1]);
        try {
          const q = u.searchParams;
          const list = await IB.listInbox(sid, { kind: q.get('kind') || '', triage: q.get('triage') || '', limit: q.get('limit') || 100 });
          return json(200, { rows: list, counts: await IB.counts(sid) });
        } catch (e) { return json(e.code || 400, { error: redact(e.message) }); }
      }
      const cm = u.pathname.match(/^\/api\/content\/([^/]+)(?:\/(.+))?$/);
      if (cm) {
        const sid = decodeURIComponent(cm[1]);
        try {
          if (cm[2] === undefined) return json(200, CS.listContent(REPO, sid));
          return json(200, CS.readContent(REPO, sid, decodeURIComponent(cm[2])));
        } catch (e) { return json(e.code || 400, { error: redact(e.message) }); }
      }
      if (u.pathname === '/api/sites') return json(200, listSites().map(n => ({ id: n, cfg: cfgOf(n) })));
      const pm = u.pathname.match(/^\/preview\/([^/]+)\/?(.*)$/);
      if (pm) {
        const site = decodeURIComponent(pm[1]);
        if (listSites().includes(site) === false) return send(404, 'unknown site');
        let rel = decodeURIComponent(pm[2] || '');
        if (rel === '' || rel.endsWith('/')) rel += 'index.html';
        const f = safeJoin(join(REPO, 'dist', site), rel);
        if (f === null || existsSync(f) === false || statSync(f).isFile() === false) return send(404, 'not built — click Build');
        return send(200, readFileSync(f), MIME[extname(f).toLowerCase()] || 'application/octet-stream');
      }
    }
    send(404, 'not found');
  } catch (e) { send(500, 'error: ' + redact(e && e.message ? e.message : e)); }
});

server.on('error', e => { log('server error', e && e.message); process.exit(1); });
server.listen(Number(process.env.PORTROX_PORT || 0), HOST, () => {
  const port = server.address().port;
  writeFileSync(STATE, JSON.stringify({ pid: process.pid, port, host: HOST, url: 'http://' + HOST + ':' + port,
    token: CSRF, startedAt: Date.now(), repo: REPO, version: VERSION }, null, 2), { mode: 0o600 });
  try { chmodSync(STATE, 0o600); } catch {}
  log('studio listening http://' + HOST + ':' + port + ' pid=' + process.pid);
  const m = maskedConfig();
  log('supabase account=' + (m.supabase.account.configured ? 'set' : 'MISSING') + ' projects=' + m.supabase.project_count + ' github=' + (m.github.configured ? m.github.login : 'MISSING'));
  if (AUTHSTORE.isDefaultCredentials()) log('WARNING default credentials admin/admin are active');
});
const bye = s => { log(s + ' -> shutdown'); try { server.close(); } catch {} process.exit(0); };
process.on('SIGTERM', () => bye('SIGTERM'));
process.on('SIGINT', () => bye('SIGINT'));
