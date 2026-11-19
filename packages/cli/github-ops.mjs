/**
 * GitHub operations for the Studio — every call goes through gh-bridge (gh CLI).
 * Exported signatures are unchanged so the 23 existing daemon routes keep working.
 */
import { apiJson, api, apiWithHeaders, assertEndpoint, allowlist, riskOf, ghInstalled, tokenSource, setSecret, setVariable, GhError } from './gh-bridge.mjs';
import { loadConfig, saveConfig, maskedConfig } from './config-store.mjs';

const enc = encodeURIComponent;
const rp = full => {
  const p = String(full || '').split('/');
  if (p.length !== 2 || !p[0] || !p[1]) throw new GhError('repo must be "owner/name"', 0, '');
  return '/repos/' + enc(p[0]) + '/' + enc(p[1]);
};
function needGh() {
  if (ghInstalled() === false) throw new GhError('gh CLI not installed on this machine. Install it, then retry.', 0, '');
}
const arr = j => Array.isArray(j) ? j : [];

/* ---------------- connection ---------------- */
export async function authStatus() {
  const installed = ghInstalled();
  const source = tokenSource();
  if (!installed) return { installed: false, connected: false, source, error: 'gh CLI not installed' };
  try {
    const { headers, json } = apiWithHeaders('/user');
    const scopes = headers['x-oauth-scopes'] || '';
    // A2: adopting the system gh session stores no token, so `login` was never
    // populated and every consumer reported GITHUB EMPTY while calls succeeded.
    // Record identity only — never a secret.
    const login = (json && json.login) || '';
    if (login) {
      const cur = loadConfig();
      const want = scopes ? scopes.split(',').map(s => s.trim()).filter(Boolean).join(', ') : '';
      if (cur.github.login !== login || cur.github.scopes !== want) {
        cur.github.login = login; cur.github.scopes = want; saveConfig(cur);
      }
    }
    return {
      installed: true, connected: true, source: tokenSource(),
      login: json && json.login, name: json && json.name, type: json && json.type,
      html_url: json && json.html_url, public_repos: json && json.public_repos,
      scopes: scopes ? scopes.split(',').map(s => s.trim()).filter(Boolean) : [],
      scope_kind: scopes ? 'classic' : 'fine-grained',
      rate_remaining: headers['x-ratelimit-remaining'] || null
    };
  } catch (e) {
    return { installed: true, connected: false, source, error: e.message };
  }
}

/** Validate a candidate PAT through gh, then persist. Token never touches argv. */
export async function connect({ token }) {
  needGh();
  const t = String(token || '').trim();
  if (!t) throw new GhError('token required', 0, '');
  if (/^(ghp_|github_pat_)/.test(t) === false) throw new GhError('expected a GitHub PAT (ghp_… or github_pat_…)', 0, '');
  const c = loadConfig();
  const prev = c.github.token;
  c.github.token = t; saveConfig(c);                 // gh reads it from ENV
  try {
    const st = await authStatus();
    if (!st.connected) throw new GhError(st.error || 'token rejected', 0, '');
    c.github.login = st.login || '';
    c.github.scopes = (st.scopes || []).join(', ');
    saveConfig(c);
    return { ...st, saved: true };
  } catch (e) {
    const r = loadConfig(); r.github.token = prev; saveConfig(r);   // roll back
    throw e;
  }
}

/** Adopt the machine's existing gh session (the WSL login). Non-destructive. */
export async function useSystemSession() {
  needGh();
  const c = loadConfig();
  c.github.token = ''; saveConfig(c);
  const st = await authStatus();
  if (st.connected) { c.github.login = st.login || ''; c.github.scopes = (st.scopes || []).join(', '); saveConfig(c); }
  return { ...st, adopted: st.connected };
}

/** Clears the Portrox token only. The system gh session is left untouched. */
export async function disconnect() {
  const c = loadConfig();
  c.github.token = ''; c.github.login = ''; c.github.scopes = ''; saveConfig(c);
  return { disconnected: true, system_session_preserved: true, status: await authStatus() };
}

export async function rateLimit() { needGh(); return apiJson('/rate_limit'); }
export function policy() { return allowlist(); }
/** Constrained console: any allowlisted endpoint/method. */
export async function console_({ endpoint, method, body, confirm }) {
  needGh();
  const m = String(method || 'GET').toUpperCase();
  assertEndpoint(endpoint, m);
  const risk = riskOf(endpoint, m);
  // A3: the console must not bypass the typed-confirmation gates.
  if (risk === 'destructive') {
    throw new GhError('console refuses ' + m + ' on this path. Use the dedicated button, which requires typing the exact target name.', 0, '');
  }
  if (risk === 'write' && confirm !== endpoint) {
    throw new GhError('write requires confirm equal to the endpoint string', 0, '');
  }
  return apiJson(endpoint, { method: m, body });
}

/* ---------------- identity + repositories ---------------- */
export async function whoami() {
  needGh();
  const j = apiJson('/user');
  return { login: j.login, name: j.name, type: j.type, public_repos: j.public_repos };
}
export async function listRepos() {
  needGh();
  const j = apiJson('/user/repos', { query: { per_page: 100, sort: 'updated', affiliation: 'owner,collaborator,organization_member' } });
  return arr(j).map(x => ({
    full_name: x.full_name, name: x.name, owner: x.owner && x.owner.login,
    private: x.private, fork: x.fork, archived: x.archived,
    default_branch: x.default_branch, html_url: x.html_url,
    has_pages: x.has_pages, pushed_at: x.pushed_at, description: x.description
  }));
}
export async function getRepo(full) { needGh(); return apiJson(rp(full)); }
export async function createRepo({ name, owner, description, private: priv }) {
  needGh();
  const n = String(name || '').trim();
  if (!n) throw new GhError('repo name required', 0, '');
  const me = (await whoami()).login;
  const body = { name: n, description: description || 'Portfolio published by Portrox', private: priv === true, has_issues: false, has_wiki: false, auto_init: false };
  const target = (owner && owner !== me) ? '/orgs/' + enc(owner) + '/repos' : '/user/repos';
  const j = apiJson(target, { method: 'POST', body });
  return { full_name: j.full_name, html_url: j.html_url, default_branch: j.default_branch, owner: (j.owner && j.owner.login) || owner || me };
}
export async function deleteRepo(full, confirm) {
  needGh();
  if (confirm !== full) throw new GhError('confirmation must equal the full repo name', 0, '');
  api(rp(full), { method: 'DELETE' });
  return { deleted: full };
}
export async function listBranches(full) {
  needGh();
  return arr(apiJson(rp(full) + '/branches', { query: { per_page: 100 } }))
    .map(b => ({ name: b.name, sha: b.commit && b.commit.sha, protected: b.protected }));
}
export async function listCommits(full, branch) {
  needGh();
  return arr(apiJson(rp(full) + '/commits', { query: { per_page: 20, sha: branch || undefined } }))
    .map(c => ({ sha: c.sha, message: ((c.commit && c.commit.message) || '').split('\n')[0],
      author: c.commit && c.commit.author && c.commit.author.name,
      date: c.commit && c.commit.author && c.commit.author.date, html_url: c.html_url }));
}
export async function listReleases(full) {
  needGh();
  return arr(apiJson(rp(full) + '/releases', { query: { per_page: 10 } }))
    .map(r => ({ tag: r.tag_name, name: r.name, draft: r.draft, prerelease: r.prerelease, published_at: r.published_at, html_url: r.html_url }));
}

/* ---------------- Pages ---------------- */
export async function pagesStatus(full) {
  needGh();
  try {
    const j = apiJson(rp(full) + '/pages');
    return { enabled: true, status: j.status, build_type: j.build_type, source: j.source, cname: j.cname,
      https_enforced: j.https_enforced, html_url: j.html_url, protected_domain_state: j.protected_domain_state,
      https_certificate: j.https_certificate };
  } catch (e) { if (Number(e.status) === 404) return { enabled: false }; throw e; }
}
export async function pagesEnable(full, { branch, path, build_type }) {
  needGh();
  const body = { build_type: build_type === 'workflow' ? 'workflow' : 'legacy',
    source: { branch: branch || 'gh-pages', path: path === '/docs' ? '/docs' : '/' } };
  try { apiJson(rp(full) + '/pages', { method: 'POST', body }); }
  catch (e) { if (Number(e.status) === 409) return pagesUpdate(full, { branch: body.source.branch, path: body.source.path, build_type: body.build_type }); throw e; }
  return pagesStatus(full);
}
export async function pagesUpdate(full, { branch, path, build_type, cname, https_enforced }) {
  needGh();
  const body = {};
  if (build_type) body.build_type = build_type === 'workflow' ? 'workflow' : 'legacy';
  if (branch && body.build_type !== 'workflow') body.source = { branch, path: path === '/docs' ? '/docs' : '/' };
  if (cname !== undefined) body.cname = cname === '' ? null : String(cname);
  if (https_enforced !== undefined) body.https_enforced = https_enforced === true;
  api(rp(full) + '/pages', { method: 'PUT', body });
  return pagesStatus(full);
}
export async function pagesDisable(full, confirm) {
  needGh();
  if (confirm !== full) throw new GhError('confirmation must equal the full repo name', 0, '');
  api(rp(full) + '/pages', { method: 'DELETE' });
  return { enabled: false };
}
export async function pagesBuilds(full) {
  needGh();
  return arr(apiJson(rp(full) + '/pages/builds', { query: { per_page: 10 } }))
    .map(b => ({ status: b.status, commit: b.commit, duration: b.duration, created_at: b.created_at, error: b.error && b.error.message }));
}
export async function pagesLatestBuild(full) {
  needGh();
  try {
    const b = apiJson(rp(full) + '/pages/builds/latest');
    return { status: b.status, commit: b.commit, duration: b.duration, created_at: b.created_at, error: b.error && b.error.message };
  } catch (e) { if (Number(e.status) === 404) return { none: true }; throw e; }
}
export async function pagesRequestBuild(full) {
  needGh();
  const j = apiJson(rp(full) + '/pages/builds', { method: 'POST' });
  return { status: j.status, url: j.url };
}
export async function pagesDnsHealth(full) {
  needGh();
  try { return apiJson(rp(full) + '/pages/health'); }
  catch (e) {
    const s = Number(e.status);
    if (s === 202) return { pending: true, note: 'async check started; re-run in a few seconds' };
    if (s === 422) return { no_cname: true };
    if (s === 400) return { unavailable: true, note: 'custom domains not available for this Pages site' };
    throw e;
  }
}

/* ---------------- Actions ---------------- */
export async function listWorkflows(full) {
  needGh();
  const j = apiJson(rp(full) + '/actions/workflows', { query: { per_page: 100 } });
  return (j.workflows || []).map(w => ({ id: w.id, name: w.name, path: w.path, state: w.state, html_url: w.html_url }));
}
export async function workflowSetState(full, file, enable) {
  needGh();
  const verb = enable ? 'enable' : 'disable';
  api(rp(full) + '/actions/workflows/' + enc(file) + '/' + verb, { method: 'PUT' });
  return { file, state: enable ? 'active' : 'disabled_manually' };
}
export async function workflowDispatch(full, file, ref, inputs) {
  needGh();
  api(rp(full) + '/actions/workflows/' + enc(file) + '/dispatches', { method: 'POST', body: { ref: ref || 'main', inputs: inputs || {} } });
  return { dispatched: file, ref: ref || 'main' };
}
export async function listRuns(full) {
  needGh();
  const j = apiJson(rp(full) + '/actions/runs', { query: { per_page: 20 } });
  return (j.workflow_runs || []).map(r => ({ id: r.id, name: r.name, status: r.status, conclusion: r.conclusion,
    head_branch: r.head_branch, head_sha: r.head_sha, event: r.event, created_at: r.created_at, html_url: r.html_url }));
}
export async function runAction(full, id, action) {
  needGh();
  if (['cancel', 'rerun', 'rerun-failed-jobs'].includes(action) === false) throw new GhError('unsupported run action', 0, '');
  if (/^\d+$/.test(String(id)) === false) throw new GhError('run id must be numeric', 0, '');
  api(rp(full) + '/actions/runs/' + id + '/' + action, { method: 'POST' });
  return { id, action, accepted: true };
}
export async function listSecretNames(full) {
  needGh();
  const j = apiJson(rp(full) + '/actions/secrets', { query: { per_page: 100 } });
  return (j.secrets || []).map(s => ({ name: s.name, created_at: s.created_at, updated_at: s.updated_at }));
}
export async function deleteSecret(full, name, confirm) {
  needGh();
  if (confirm !== name) throw new GhError('confirmation must equal the secret name', 0, '');
  api(rp(full) + '/actions/secrets/' + enc(name), { method: 'DELETE' });
  return { deleted: name };
}
/** Now possible because gh performs the sealed-box encryption. Value on stdin. */
export async function putSecret(full, name, value) { needGh(); return setSecret(full, name, value); }
export async function listVariables(full) {
  needGh();
  const j = apiJson(rp(full) + '/actions/variables', { query: { per_page: 100 } });
  return (j.variables || []).map(v => ({ name: v.name, value: v.value, created_at: v.created_at }));
}
export async function putVariable(full, name, value) { needGh(); return setVariable(full, name, value); }
export async function deleteVariable(full, name, confirm) {
  needGh();
  if (confirm !== name) throw new GhError('confirmation must equal the variable name', 0, '');
  api(rp(full) + '/actions/variables/' + enc(name), { method: 'DELETE' });
  return { deleted: name };
}
export async function listArtifacts(full) {
  needGh();
  const j = apiJson(rp(full) + '/actions/artifacts', { query: { per_page: 20 } });
  return (j.artifacts || []).map(a => ({ id: a.id, name: a.name, size_in_bytes: a.size_in_bytes, expired: a.expired, created_at: a.created_at }));
}
