/**
 * gh CLI transport. THE backend for every GitHub operation.
 *
 * HARD RULES
 *  - argv array only. Never shell:true. Never string interpolation into a shell.
 *  - Token in ENV (GH_TOKEN) or the system gh session. NEVER in argv.
 *  - Bodies on STDIN (--input -). Never -f with user-controlled keys.
 *  - Endpoints are DENY-BY-DEFAULT allowlisted, must start with '/', and may
 *    never start with '-' (an argv element starting with '-' becomes a FLAG,
 *    e.g. --hostname evil.tld would exfiltrate the token).
 *  - --hostname github.com is always forced. GH_HOST is pinned.
 *  - Output capped, every call timed out.
 *
 * BOUNDARY: gh subcommands that execute arbitrary code (extension exec, alias,
 * codespace ssh) or manipulate the local filesystem (worktrees) are NOT exposed.
 */
import { spawnSync } from 'node:child_process';
import { loadConfig } from './config-store.mjs';

const HOST = 'github.com';
const MAX_OUT = 8 * 1024 * 1024;
const TIMEOUT = 60000;

export class GhError extends Error {
  constructor(message, status, stderr) { super(message); this.status = status; this.stderr = stderr; }
}

export function ghPath() {
  const r = spawnSync('command', ['-v', 'gh'], { encoding: 'utf8', shell: '/bin/bash' });
  const p = String(r.stdout || '').trim();
  return p && p.startsWith('/') ? p : '';
}
export function ghInstalled() { return Boolean(ghPath()); }

/** Token source: Portrox store wins; otherwise the system gh session is adopted. */
export function tokenSource() {
  const c = loadConfig();
  return (c.github && c.github.token) ? 'portrox' : 'system';
}

function env() {
  const c = loadConfig();
  const e = {
    ...process.env,
    GH_HOST: HOST,
    GH_PROMPT_DISABLED: '1',
    GH_PAGER: 'cat',
    GH_NO_UPDATE_NOTIFIER: '1',
    NO_COLOR: '1',
    CLICOLOR: '0',
    CLICOLOR_FORCE: '0'
  };
  if (c.github && c.github.token) e.GH_TOKEN = c.github.token;
  else { delete e.GH_TOKEN; delete e.GITHUB_TOKEN; }   // adopt ~/.config/gh
  return e;
}

function run(args, { input } = {}) {
  const bin = ghPath();
  if (!bin) throw new GhError('gh CLI not installed. Install: sudo apt-get install -y gh  (or see https://cli.github.com)', 0, '');
  const r = spawnSync(bin, args, {
    env: env(), input, encoding: 'utf8', timeout: TIMEOUT, maxBuffer: MAX_OUT, shell: false
  });
  if (r.error) throw new GhError('gh spawn failed: ' + r.error.message, 0, '');
  return { status: r.status, stdout: String(r.stdout || ''), stderr: String(r.stderr || '') };
}

/* ---------------- endpoint policy ---------------- */
const O = '[A-Za-z0-9_.-]+';
const R = '[A-Za-z0-9_.-]+';
const OR = `\\/repos\\/${O}\\/${R}`;
const ALLOW = [
  { re: /^\/user$/, m: ['GET'] },
  { re: /^\/user\/repos$/, m: ['GET', 'POST'] },
  { re: /^\/user\/orgs$/, m: ['GET'] },
  { re: /^\/rate_limit$/, m: ['GET'] },
  { re: new RegExp(`^${OR}$`), m: ['GET', 'PATCH', 'DELETE'] },
  { re: new RegExp(`^${OR}\\/(branches|commits|tags|releases|topics|languages|contributors)(\\/[A-Za-z0-9_.\\/-]+)?$`), m: ['GET'] },
  { re: new RegExp(`^${OR}\\/releases$`), m: ['GET', 'POST'] },
  { re: new RegExp(`^${OR}\\/pages$`), m: ['GET', 'POST', 'PUT', 'DELETE'] },
  { re: new RegExp(`^${OR}\\/pages\\/builds$`), m: ['GET', 'POST'] },
  { re: new RegExp(`^${OR}\\/pages\\/builds\\/latest$`), m: ['GET'] },
  { re: new RegExp(`^${OR}\\/pages\\/health$`), m: ['GET'] },
  { re: new RegExp(`^${OR}\\/actions\\/workflows$`), m: ['GET'] },
  { re: new RegExp(`^${OR}\\/actions\\/workflows\\/[A-Za-z0-9_.%-]+\\/(enable|disable|dispatches)$`), m: ['PUT', 'POST'] },
  { re: new RegExp(`^${OR}\\/actions\\/runs$`), m: ['GET'] },
  { re: new RegExp(`^${OR}\\/actions\\/runs\\/\\d+$`), m: ['GET', 'DELETE'] },
  { re: new RegExp(`^${OR}\\/actions\\/runs\\/\\d+\\/(cancel|rerun|rerun-failed-jobs)$`), m: ['POST'] },
  { re: new RegExp(`^${OR}\\/actions\\/runs\\/\\d+\\/(jobs|artifacts)$`), m: ['GET'] },
  { re: new RegExp(`^${OR}\\/actions\\/artifacts(\\/\\d+)?$`), m: ['GET', 'DELETE'] },
  { re: new RegExp(`^${OR}\\/actions\\/secrets$`), m: ['GET'] },
  { re: new RegExp(`^${OR}\\/actions\\/secrets\\/public-key$`), m: ['GET'] },
  { re: new RegExp(`^${OR}\\/actions\\/secrets\\/[A-Za-z0-9_]+$`), m: ['GET', 'PUT', 'DELETE'] },
  { re: new RegExp(`^${OR}\\/actions\\/variables$`), m: ['GET', 'POST'] },
  { re: new RegExp(`^${OR}\\/actions\\/variables\\/[A-Za-z0-9_]+$`), m: ['GET', 'PATCH', 'DELETE'] },
  { re: new RegExp(`^${OR}\\/(issues|pulls|labels|milestones)(\\/\\d+)?$`), m: ['GET', 'POST', 'PATCH'] },
  { re: new RegExp(`^${OR}\\/(issues|pulls)\\/\\d+\\/comments$`), m: ['GET', 'POST'] },
  { re: new RegExp(`^${OR}\\/deployments$`), m: ['GET'] },
  { re: new RegExp(`^${OR}\\/environments$`), m: ['GET'] },
  { re: /^\/orgs\/[A-Za-z0-9_.-]+$/, m: ['GET'] },
  { re: /^\/orgs\/[A-Za-z0-9_.-]+\/repos$/, m: ['GET', 'POST'] },
  { re: /^\/orgs\/[A-Za-z0-9_.-]+\/members$/, m: ['GET'] }
];

export function assertEndpoint(endpoint, method) {
  const e = String(endpoint || '');
  const m = String(method || 'GET').toUpperCase();
  if (e.startsWith('-')) throw new GhError('endpoint may not start with "-" (argv flag injection)', 0, '');
  if (e.startsWith('/') === false) throw new GhError('endpoint must start with "/"', 0, '');
  if (/[\s"'`\\]/.test(e) || e.includes('..') || e.includes('://') || e.includes('@')) {
    throw new GhError('endpoint contains forbidden characters', 0, '');
  }
  const path = e.split('?')[0];
  const hit = ALLOW.find(a => a.re.test(path));
  if (!hit) throw new GhError('endpoint not in the allowlist: ' + path, 0, '');
  if (hit.m.includes(m) === false) throw new GhError('method ' + m + ' not permitted for ' + path, 0, '');
  return { path, method: m };
}
export function allowlist() { return ALLOW.map(a => ({ pattern: a.re.source, methods: a.m })); }

/* ---------------- transport ---------------- */
export function api(endpoint, { method = 'GET', body, query, paginate = false, include = false } = {}) {
  const { path, method: m } = assertEndpoint(endpoint, method);
  let target = path;
  if (query && typeof query === 'object') {
    const qs = Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(String(v))).join('&');
    if (qs) target += (target.includes('?') ? '&' : '?') + qs;
  }
  const args = ['api', '--hostname', HOST, '--method', m];
  if (paginate) args.push('--paginate');
  if (include) args.push('--include');
  const hasBody = body !== undefined && m !== 'GET' && m !== 'HEAD';
  if (hasBody) args.push('--input', '-');
  args.push(target);
  const r = run(args, hasBody ? { input: JSON.stringify(body) } : {});
  if (r.status !== 0) {
    let msg = r.stderr.trim() || r.stdout.trim() || ('gh api exit ' + r.status);
    let st = 0;
    const hm = msg.match(/HTTP (\d{3})/); if (hm) st = Number(hm[1]);
    try { const j = JSON.parse(r.stdout); if (j && j.message) { msg = j.message; st = st || 400; } } catch {}
    throw new GhError(msg.replace(/ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+/g, '[REDACTED]'), st, r.stderr);
  }
  return { raw: r.stdout, status: r.status };
}

export function apiJson(endpoint, opts = {}) {
  const { raw } = api(endpoint, opts);
  const t = raw.trim();
  if (!t) return {};                       // 204 No Content
  try { return JSON.parse(t); }
  catch { throw new GhError('gh returned non-JSON for ' + endpoint, 0, t.slice(0, 200)); }
}

/** Headers + body, for x-oauth-scopes. */
export function apiWithHeaders(endpoint) {
  const { raw } = api(endpoint, { include: true });
  const i = raw.search(/\r?\n\r?\n/);
  const head = i < 0 ? raw : raw.slice(0, i);
  const body = i < 0 ? '' : raw.slice(i).trim();
  const headers = {};
  for (const line of head.split(/\r?\n/)) {
    const k = line.indexOf(':');
    if (k > 0) headers[line.slice(0, k).trim().toLowerCase()] = line.slice(k + 1).trim();
  }
  let json = null; try { json = body ? JSON.parse(body) : null; } catch {}
  return { headers, json };
}

/** Native subcommands. Fixed argv, secrets on stdin. */
export function native(args, { input } = {}) {
  if (Array.isArray(args) === false || args.length === 0) throw new GhError('native args required', 0, '');
  for (const a of args) if (typeof a !== 'string') throw new GhError('native args must be strings', 0, '');
  const banned = ['extension', 'alias', 'codespace', 'copilot', 'auth'];
  if (banned.includes(args[0])) throw new GhError('subcommand not exposed: ' + args[0], 0, '');
  const r = run(args, { input });
  if (r.status !== 0) throw new GhError((r.stderr || r.stdout || 'gh failed').trim(), r.status, r.stderr);
  return r.stdout;
}

/** gh secret set reads the value from stdin — never argv. */
export function setSecret(full, name, value) {
  if (!/^[A-Za-z0-9_]+$/.test(String(name || ''))) throw new GhError('invalid secret name', 0, '');
  if (typeof value !== 'string' || value.length === 0) throw new GhError('empty secret value', 0, '');
  const [o, r] = String(full || '').split('/');
  if (!o || !r) throw new GhError('repo must be owner/name', 0, '');
  native(['secret', 'set', name, '--repo', o + '/' + r, '--body', '-'], { input: value });
  return { set: name, repo: o + '/' + r };
}
export function setVariable(full, name, value) {
  if (!/^[A-Za-z0-9_]+$/.test(String(name || ''))) throw new GhError('invalid variable name', 0, '');
  const [o, r] = String(full || '').split('/');
  if (!o || !r) throw new GhError('repo must be owner/name', 0, '');
  native(['variable', 'set', name, '--repo', o + '/' + r, '--body', String(value ?? '')]);
  return { set: name, repo: o + '/' + r };
}
