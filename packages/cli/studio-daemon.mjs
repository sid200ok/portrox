/**
 * Portrox Studio daemon.
 * Binds 127.0.0.1:0 -> kernel assigns the port. State 0600 in a 0700 dir.
 * Every data route requires a session cookie AND the CSRF token AND a valid Host.
 * Supabase is configured with URL + publishable key + DATABASE PASSWORD.
 * The Studio writes to Postgres as administrator via db-bridge (psql, env-only creds).
 */
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, rmSync, cpSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, extname, normalize, resolve, dirname, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { maskedConfig, setSupabase, setGithub, gh, gitEnv, publicSupabase, loadConfig } from './config-store.mjs';
import { testConnection, registerSiteSql, markPublishedSql, psqlPath } from './db-bridge.mjs';
import * as AUTHSTORE from './auth-store.mjs';
import { renderLogin, renderApp } from './studio-ui.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = process.env.PORTROX_REPO || resolve(HERE, '../..');
const HOME = process.env.PORTROX_HOME || join(homedir(), '.portrox');
const HOST = '127.0.0.1';
const STATE = join(HOME, 'state.json');
const VERSION = '0.4.0';
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
const redact = s => String(s || '').replace(/ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|sb_secret_[A-Za-z0-9_-]+/g, '[REDACTED]').replace(/postgresql:\/\/[^\s@]+@/g, 'postgresql://[REDACTED]@');

function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...(opts || {}) });
  return { ok: r.status === 0, out: String(r.stdout || '').trim(), err: String(r.stderr || '').trim() };
}
const git = (args, cwd) => { let env; try { env = gitEnv(); } catch (e) { return { ok: false, out: '', err: e.message }; } return run('git', args, { cwd, env }); };
const slug = raw => String(raw || '').trim().toLowerCase().replace(/[^a-z0-9.-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

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
  const cfg = {
    id: folder, name: folder, owner,
    pages: { mode: m, repo, branch: 'gh-pages', base_path, cname: '' },
    seo: { title: (headline || base || folder) + ' — Portfolio', description: 'Portfolio built with Portrox.', og_image: '' },
    nav: { services: true, appointments: true, about: true, client_auth: false },
    theme: { bg: '#020617', panel: '#0f172a', accent: '#22d3ee' },
    supabase: publicSupabase(),
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

function registerSite(id) {
  const cfg = cfgOf(id);
  const studioOwner = AUTHSTORE.publicState().username;
  const r = registerSiteSql(id, cfg, studioOwner);
  if (!r.ok) throw new Error('register failed: ' + redact(r.error));
  cfg.registered = true; writeCfg(id, cfg);
  return { registered: true, site_id: id, studio_owner: studioOwner, via: r.mode, result: r.out };
}

function buildOne(id) {
  const cfg = cfgOf(id);
  cfg.supabase = publicSupabase();
  writeCfg(id, cfg);
  return import(join(REPO, 'packages/core/render.mjs')).then(m => m.renderSite(join(sitesDir, id), join(REPO, 'dist', id)));
}

async function ensureRepo(cfg) {
  const owner = cfg.pages.repo.split('/')[0];
  const name = cfg.pages.repo.split('/')[1];
  const view = await gh('/repos/' + cfg.pages.repo);
  if (view.ok) return { repo: cfg.pages.repo, created: false };
  const g = maskedConfig().github;
  const body = { name, private: false, description: 'Portfolio published by Portrox', has_issues: false, has_wiki: false };
  const cr = owner === g.login ? await gh('/user/repos', { method: 'POST', body }) : await gh('/orgs/' + owner + '/repos', { method: 'POST', body });
  if (!cr.ok) throw new Error('repo create failed: ' + cr.status + ' ' + cr.text.slice(0, 200));
  return { repo: cfg.pages.repo, created: true };
}

async function configurePages(cfg) {
  const body = {
    build_type: 'legacy',
    source: { branch: cfg.pages.branch || 'gh-pages', path: '/' },
    ...(cfg.pages.mode === 'custom' && cfg.pages.cname ? { cname: cfg.pages.cname, https_enforced: true } : {})
  };
  let r = await gh('/repos/' + cfg.pages.repo + '/pages', { method: 'POST', body });
  if (!r.ok) r = await gh('/repos/' + cfg.pages.repo + '/pages', { method: 'PUT', body });
  if (!r.ok) throw new Error('pages config failed: ' + r.status + ' ' + r.text.slice(0, 200));
  const disabled = [];
  for (const wf of ['deploy-pages.yml', 'pages.yml']) {
    const d = await gh('/repos/' + cfg.pages.repo + '/actions/workflows/' + wf + '/disable', { method: 'PUT' });
    if (d.ok) disabled.push(wf);
  }
  const check = await gh('/repos/' + cfg.pages.repo + '/pages');
  return { pages: check.json ? { build_type: check.json.build_type, source: check.json.source, status: check.json.status } : null, disabled_workflows: disabled };
}

async function publish(id) {
  const cfg = cfgOf(id);
  if (cfg.pages.mode === 'custom' && !cfg.pages.cname) throw new Error('custom mode: set pages.cname in site.json before publishing.');
  if (cfg.registered !== true) registerSite(id);
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
    const local = 'publish-' + Date.now();
    if (git(['checkout', '--orphan', local], tmp).ok === false) throw new Error('orphan checkout failed');
    for (const e of readdirSync(tmp)) if (e !== '.git') rmSync(join(tmp, e), { recursive: true, force: true });
    cpSync(src, tmp, { recursive: true });
    writeFileSync(join(tmp, '.nojekyll'), '');
    git(['add', '-A'], tmp);
    const cm = git(['-c', 'user.name=Portrox', '-c', 'user.email=portrox@localhost', 'commit', '-m', 'Publish via Portrox'], tmp);
    if (cm.ok === false && /nothing to commit/i.test(cm.out + cm.err) === false) throw new Error('commit failed: ' + cm.err);
    const push = git(['push', '-f', 'origin', 'HEAD:refs/heads/' + (cfg.pages.branch || 'gh-pages')], tmp);
    if (push.ok === false) throw new Error('push failed: ' + redact(push.err));
    const pages = await configurePages(cfg);
    const mark = markPublishedSql(id, true);
    if (!mark.ok) throw new Error('mark published failed: ' + redact(mark.error));
    const c2 = cfgOf(id); c2.published = true; c2.registered = true; writeCfg(id, c2);
    return { url: cfg.live_url || '(set cname)', repo: cfg.pages.repo, branch: cfg.pages.branch || 'gh-pages', is_published: true, ...pages };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
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

    if (req.method === 'GET' && u.pathname === '/api/health') return json(200, { ok: true, pid: process.pid, port, psql: Boolean(psqlPath()) });
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
        try {
          const r = AUTHSTORE.login(b);
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
        try { const a = AUTHSTORE.changeCredentials(b); return json(200, a, { 'Set-Cookie': 'portrox_sid=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' }); }
        catch (e) { return json(400, { error: e.message }); }
      }
      if (p === '/api/auth/recovery/setup') { try { return json(200, AUTHSTORE.setupRecovery(b)); } catch (e) { return json(400, { error: e.message }); } }
      if (p === '/api/auth/recovery/key') { try { return json(200, AUTHSTORE.issueRecoveryKey(b)); } catch (e) { return json(400, { error: e.message }); } }

      if (p === '/api/config/supabase' || p === '/api/config/supabase-project') {
        try { return json(200, setSupabase(b)); } catch (e) { return json(400, { error: redact(e.message) }); }
      }
      if (p === '/api/config/test-db') { try { return json(200, testConnection()); } catch (e) { return json(400, { error: redact(e.message) }); } }
      if (p === '/api/config/github') { try { return json(200, await setGithub(b)); } catch (e) { return json(400, { error: redact(e.message) }); } }
      if (p === '/api/sites') { try { return json(200, createSite(b)); } catch (e) { return json(400, { error: e.message }); } }

      const m = p.match(/^\/api\/sites\/([^/]+)\/(build|register|publish)$/);
      if (m) {
        const id = decodeURIComponent(m[1]);
        if (listSites().includes(id) === false) return json(404, { error: 'unknown site' });
        try {
          if (m[2] === 'build') return json(200, await buildOne(id));
          if (m[2] === 'register') return json(200, registerSite(id));
          return json(200, await publish(id));
        } catch (e) { return json(400, { error: redact(e.message) }); }
      }
      return json(404, { error: 'not found' });
    }

    if (req.method === 'GET') {
      if (!sess) return json(401, { error: 'authentication required' });
      if (u.pathname === '/api/config') return json(200, maskedConfig());
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
  if (!psqlPath()) log('WARNING psql not found — install postgresql-client to enable database operations');
  if (AUTHSTORE.isDefaultCredentials()) log('WARNING default credentials admin/admin are active — rotate on first sign-in');
});
const bye = s => { log(s + ' -> shutdown'); try { server.close(); } catch {} process.exit(0); };
process.on('SIGTERM', () => bye('SIGTERM'));
process.on('SIGINT', () => bye('SIGINT'));
