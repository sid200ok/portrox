/**
 * GitHub operations for the Studio — the button equivalent of `gh`.
 * Reuses config-store.gh() so the PAT is handled in exactly one place.
 * Pages endpoints follow the published REST reference: POST/PUT/DELETE /pages,
 * GET /pages/builds, GET /pages/builds/latest, POST /pages/builds, GET /pages/health.
 * DEFERRED: creating an Actions secret needs libsodium sealed-box encryption
 * against the repo public key. `gh secret set` does that; we do not yet.
 */
import { gh, maskedConfig } from './config-store.mjs';

const enc = encodeURIComponent;
const rp = (owner, repo) => '/repos/' + enc(owner) + '/' + enc(repo);
function needGh() {
  if (maskedConfig().github.configured === false) throw new Error('GitHub token not set. Studio → Settings → GitHub.');
}
function split(full) {
  const p = String(full || '').split('/');
  if (p.length !== 2 || !p[0] || !p[1]) throw new Error('repo must be "owner/name"');
  return { owner: p[0], repo: p[1] };
}
async function must(res, label) {
  // 204 / empty 2xx yields null; never hand null to a caller that reads fields.
  if (res.ok) return res.json === null || res.json === undefined ? {} : res.json;
  const msg = (res.json && (res.json.message || res.json.error)) || res.text.slice(0, 240) || ('HTTP ' + res.status);
  const e = new Error(label + ': ' + msg); e.status = res.status; throw e;
}

export async function whoami() {
  needGh();
  const j = await must(await gh('/user'), 'user');
  return { login: j.login, name: j.name, type: j.type, public_repos: j.public_repos };
}
export async function listRepos() {
  needGh();
  const j = await must(await gh('/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member'), 'repos');
  return (Array.isArray(j) ? j : []).map(x => ({
    full_name: x.full_name, name: x.name, owner: x.owner && x.owner.login,
    private: x.private, fork: x.fork, archived: x.archived,
    default_branch: x.default_branch, html_url: x.html_url,
    has_pages: x.has_pages, pushed_at: x.pushed_at, description: x.description
  }));
}
export async function getRepo(full) { needGh(); const { owner, repo } = split(full); return must(await gh(rp(owner, repo)), 'repo'); }
export async function createRepo({ name, owner, description, private: priv }) {
  needGh();
  const me = maskedConfig().github.login;
  const body = { name: String(name || '').trim(), description: description || 'Portfolio published by Portrox',
    private: priv === true, has_issues: false, has_wiki: false, auto_init: false };
  if (!body.name) throw new Error('repo name required');
  const target = (owner && owner !== me) ? '/orgs/' + enc(owner) + '/repos' : '/user/repos';
  const j = await must(await gh(target, { method: 'POST', body }), 'create repo');
  return { full_name: j.full_name, html_url: j.html_url, default_branch: j.default_branch, owner: (j.owner && j.owner.login) || owner || me };
}
export async function deleteRepo(full, confirm) {
  needGh();
  if (confirm !== full) throw new Error('confirmation must equal the full repo name');
  const { owner, repo } = split(full);
  const r = await gh(rp(owner, repo), { method: 'DELETE' });
  if (r.ok || r.status === 204) return { deleted: full };
  if (r.status === 403) throw new Error('delete needs the delete_repo scope (classic PAT) or Administration:write');
  if (r.status === 404) throw new Error('repo not found, or the token cannot see it: ' + full);
  return must(r, 'delete repo');
}
export async function listBranches(full) {
  needGh(); const { owner, repo } = split(full);
  const j = await must(await gh(rp(owner, repo) + '/branches?per_page=100'), 'branches');
  return (Array.isArray(j) ? j : []).map(b => ({ name: b.name, sha: b.commit && b.commit.sha, protected: b.protected }));
}
export async function listCommits(full, branch) {
  needGh(); const { owner, repo } = split(full);
  const q = branch ? '?per_page=20&sha=' + enc(branch) : '?per_page=20';
  const j = await must(await gh(rp(owner, repo) + '/commits' + q), 'commits');
  return (Array.isArray(j) ? j : []).map(c => ({
    sha: c.sha, message: (c.commit && c.commit.message || '').split('\n')[0],
    author: c.commit && c.commit.author && c.commit.author.name,
    date: c.commit && c.commit.author && c.commit.author.date, html_url: c.html_url
  }));
}
export async function listReleases(full) {
  needGh(); const { owner, repo } = split(full);
  const j = await must(await gh(rp(owner, repo) + '/releases?per_page=10'), 'releases');
  return (Array.isArray(j) ? j : []).map(r => ({ tag: r.tag_name, name: r.name, draft: r.draft, prerelease: r.prerelease, published_at: r.published_at, html_url: r.html_url }));
}

export async function pagesStatus(full) {
  needGh(); const { owner, repo } = split(full);
  const r = await gh(rp(owner, repo) + '/pages');
  if (r.status === 404) return { enabled: false };
  const j = await must(r, 'pages');
  return { enabled: true, status: j.status, build_type: j.build_type, source: j.source, cname: j.cname,
    https_enforced: j.https_enforced, html_url: j.html_url, protected_domain_state: j.protected_domain_state,
    https_certificate: j.https_certificate };
}
export async function pagesEnable(full, { branch, path, build_type }) {
  needGh(); const { owner, repo } = split(full);
  const body = { build_type: build_type === 'workflow' ? 'workflow' : 'legacy',
    source: { branch: branch || 'gh-pages', path: path === '/docs' ? '/docs' : '/' } };
  const r = await gh(rp(owner, repo) + '/pages', { method: 'POST', body });
  if (r.status === 409) return pagesUpdate(full, { branch: body.source.branch, path: body.source.path, build_type: body.build_type });
  await must(r, 'pages enable');
  return pagesStatus(full);
}
export async function pagesUpdate(full, { branch, path, build_type, cname, https_enforced }) {
  needGh(); const { owner, repo } = split(full);
  const body = {};
  if (build_type) body.build_type = build_type === 'workflow' ? 'workflow' : 'legacy';
  // GitHub ignores `source` when build_type is workflow; do not imply otherwise.
  if (branch && body.build_type !== 'workflow') body.source = { branch, path: path === '/docs' ? '/docs' : '/' };
  if (cname !== undefined) body.cname = cname === '' ? null : String(cname);
  if (https_enforced !== undefined) body.https_enforced = https_enforced === true;
  const r = await gh(rp(owner, repo) + '/pages', { method: 'PUT', body });
  if (r.ok || r.status === 204) return pagesStatus(full);
  return must(r, 'pages update');
}
export async function pagesDisable(full, confirm) {
  needGh();
  if (confirm !== full) throw new Error('confirmation must equal the full repo name');
  const { owner, repo } = split(full);
  const r = await gh(rp(owner, repo) + '/pages', { method: 'DELETE' });
  if (r.ok || r.status === 204) return { enabled: false };
  return must(r, 'pages disable');
}
export async function pagesBuilds(full) {
  needGh(); const { owner, repo } = split(full);
  const j = await must(await gh(rp(owner, repo) + '/pages/builds?per_page=10'), 'pages builds');
  return (Array.isArray(j) ? j : []).map(b => ({ status: b.status, commit: b.commit, duration: b.duration, created_at: b.created_at, error: b.error && b.error.message }));
}
export async function pagesLatestBuild(full) {
  needGh(); const { owner, repo } = split(full);
  const r = await gh(rp(owner, repo) + '/pages/builds/latest');
  if (r.status === 404) return { none: true };
  const b = await must(r, 'latest build');
  return { status: b.status, commit: b.commit, duration: b.duration, created_at: b.created_at, error: b.error && b.error.message };
}
export async function pagesRequestBuild(full) {
  needGh(); const { owner, repo } = split(full);
  const j = await must(await gh(rp(owner, repo) + '/pages/builds', { method: 'POST' }), 'request build');
  return { status: j.status, url: j.url };
}
export async function pagesDnsHealth(full) {
  needGh(); const { owner, repo } = split(full);
  const r = await gh(rp(owner, repo) + '/pages/health');
  if (r.status === 202) return { pending: true, note: 'async check started; re-run in a few seconds' };
  if (r.status === 422) return { no_cname: true };
  if (r.status === 400) return { unavailable: true, note: 'custom domains not available for this Pages site' };
  return must(r, 'dns health');
}

export async function listWorkflows(full) {
  needGh(); const { owner, repo } = split(full);
  const j = await must(await gh(rp(owner, repo) + '/actions/workflows?per_page=100'), 'workflows');
  return (j && j.workflows || []).map(w => ({ id: w.id, name: w.name, path: w.path, state: w.state, html_url: w.html_url }));
}
export async function workflowSetState(full, file, enable) {
  needGh(); const { owner, repo } = split(full);
  const verb = enable ? 'enable' : 'disable';
  const r = await gh(rp(owner, repo) + '/actions/workflows/' + enc(file) + '/' + verb, { method: 'PUT' });
  if (r.ok || r.status === 204) return { file, state: enable ? 'active' : 'disabled_manually' };
  return must(r, 'workflow ' + verb);
}
export async function workflowDispatch(full, file, ref, inputs) {
  needGh(); const { owner, repo } = split(full);
  const r = await gh(rp(owner, repo) + '/actions/workflows/' + enc(file) + '/dispatches', { method: 'POST', body: { ref: ref || 'main', inputs: inputs || {} } });
  if (r.ok || r.status === 204) return { dispatched: file, ref: ref || 'main' };
  return must(r, 'dispatch');
}
export async function listRuns(full) {
  needGh(); const { owner, repo } = split(full);
  const j = await must(await gh(rp(owner, repo) + '/actions/runs?per_page=20'), 'runs');
  return (j && j.workflow_runs || []).map(r => ({ id: r.id, name: r.name, status: r.status, conclusion: r.conclusion,
    head_branch: r.head_branch, head_sha: r.head_sha, event: r.event, created_at: r.created_at, html_url: r.html_url }));
}
export async function runAction(full, id, action) {
  needGh();
  if (!['cancel', 'rerun', 'rerun-failed-jobs'].includes(action)) throw new Error('unsupported run action');
  const { owner, repo } = split(full);
  const r = await gh(rp(owner, repo) + '/actions/runs/' + enc(String(id)) + '/' + action, { method: 'POST' });
  if (r.ok || r.status === 202 || r.status === 204) return { id, action, accepted: true };
  return must(r, 'run ' + action);
}
export async function listSecretNames(full) {
  needGh(); const { owner, repo } = split(full);
  const j = await must(await gh(rp(owner, repo) + '/actions/secrets?per_page=100'), 'secrets');
  return (j && j.secrets || []).map(s => ({ name: s.name, created_at: s.created_at, updated_at: s.updated_at }));
}
export async function deleteSecret(full, name, confirm) {
  needGh();
  if (confirm !== name) throw new Error('confirmation must equal the secret name');
  const { owner, repo } = split(full);
  const r = await gh(rp(owner, repo) + '/actions/secrets/' + enc(name), { method: 'DELETE' });
  if (r.ok || r.status === 204) return { deleted: name };
  return must(r, 'delete secret');
}
