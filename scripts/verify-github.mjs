/**
 * Functional test for the gh backend.
 *   node scripts/verify-github.mjs [owner/repo]           read-only + refusal gates
 *   node scripts/verify-github.mjs [owner/repo] --write    ALSO set/list/delete a
 *                                                          throwaway secret+variable
 * The write pass exists because `--body -` silently stored "-" instead of the
 * value; only a real round trip can prove that class of bug is gone.
 */
import { randomBytes } from 'node:crypto';
import * as GH from '../packages/cli/github-ops.mjs';

let bad = 0;
const ok = m => console.log('OK   ' + m);
const fail = m => { bad++; console.log('FAIL ' + m); };
const note = m => console.log('NOTE ' + m);
const WRITE = process.argv.includes('--write');
const argRepo = process.argv.slice(2).find(a => !a.startsWith('--'));

const st = await GH.authStatus();
if (st.installed === false) { note('gh CLI not installed. Skipping (no verdict).'); process.exit(0); }
console.log('gh source: ' + st.source + ' connected: ' + st.connected);
if (st.connected === false) {
  note('GitHub not connected — Studio → Settings → GitHub ops → Connect, or Use my WSL gh session. Skipping.');
  process.exit(0);
}

let who = null;
try { who = await GH.whoami(); ok('whoami → ' + who.login); }
catch (e) { fail('whoami: ' + e.message); console.log('GITHUB BAD=' + bad); process.exit(1); }

let repos = [];
try {
  repos = await GH.listRepos();
  ok('listRepos → ' + repos.length + ' repos');
  repos.every(r => typeof r.full_name === 'string' && r.full_name.includes('/'))
    ? ok('repo shape has owner/name') : fail('repo shape wrong');
} catch (e) { fail('listRepos: ' + e.message); }

const target = argRepo
  || (repos.find(r => r.full_name === who.login + '/' + who.login + '.github.io') || {}).full_name
  || (repos.find(r => r.has_pages) || {}).full_name
  || (repos[0] || {}).full_name;
if (!target) { note('no repository to probe'); console.log(bad ? 'GITHUB BAD=' + bad : 'GITHUB OK'); process.exit(bad ? 1 : 0); }
console.log('probing: ' + target);

for (const [name, fn, shape] of [
  ['getRepo', () => GH.getRepo(target), j => typeof j.full_name === 'string'],
  ['listBranches', () => GH.listBranches(target), a => Array.isArray(a)],
  ['listCommits', () => GH.listCommits(target), a => Array.isArray(a)],
  ['listReleases', () => GH.listReleases(target), a => Array.isArray(a)],
  ['pagesStatus', () => GH.pagesStatus(target), j => typeof j.enabled === 'boolean'],
  ['pagesBuilds', () => GH.pagesBuilds(target), a => Array.isArray(a)],
  ['pagesLatestBuild', () => GH.pagesLatestBuild(target), j => j && typeof j === 'object'],
  ['pagesDnsHealth', () => GH.pagesDnsHealth(target), j => j && typeof j === 'object'],
  ['listWorkflows', () => GH.listWorkflows(target), a => Array.isArray(a)],
  ['listRuns', () => GH.listRuns(target), a => Array.isArray(a)],
  ['listVariables', () => GH.listVariables(target), a => Array.isArray(a)],
  ['listArtifacts', () => GH.listArtifacts(target), a => Array.isArray(a)],
  ['listSecretNames', () => GH.listSecretNames(target), a => Array.isArray(a) && a.every(s => typeof s.name === 'string' && s.value === undefined)]
]) {
  try {
    const r = await fn();
    if (r === null || r === undefined) { fail(name + ' returned null/undefined'); continue; }
    shape(r) ? ok(name + ' → ' + (Array.isArray(r) ? r.length + ' item(s)' : JSON.stringify(r).slice(0, 110)))
             : fail(name + ' shape wrong: ' + JSON.stringify(r).slice(0, 160));
  } catch (e) {
    if (Number(e.status) === 404) note(name + ': 404 (not enabled on this repo) — acceptable');
    else fail(name + ': ' + e.message);
  }
}

// A7: a query string in the endpoint must survive.
try {
  const r = await GH.console_({ endpoint: '/user/repos?per_page=3', method: 'GET' });
  Array.isArray(r) && r.length <= 3 ? ok('endpoint query preserved (per_page=3 → ' + r.length + ')')
    : fail('endpoint query dropped or ignored (' + (Array.isArray(r) ? r.length : typeof r) + ')');
} catch (e) { fail('console GET: ' + e.message); }

// Refusal gates.
for (const [name, fn, want] of [
  ['deleteRepo gate', () => GH.deleteRepo(target, 'wrong'), /confirmation/i],
  ['pagesDisable gate', () => GH.pagesDisable(target, 'wrong'), /confirmation/i],
  ['deleteSecret gate', () => GH.deleteSecret(target, 'PROBE', 'wrong'), /confirmation/i],
  ['deleteVariable gate', () => GH.deleteVariable(target, 'PROBE', 'wrong'), /confirmation/i],
  ['console refuses DELETE', () => GH.console_({ endpoint: '/repos/' + target, method: 'DELETE' }), /refuses/i],
  ['console write needs confirm', () => GH.console_({ endpoint: '/repos/' + target + '/pages/builds', method: 'POST' }), /confirm/i],
  ['console blocks flag injection', () => GH.console_({ endpoint: '--hostname', method: 'GET' }), /flag|allowlist|start with/i]
]) {
  try { await fn(); fail(name + ' did NOT refuse'); }
  catch (e) { want.test(e.message) ? ok(name + ' refused') : fail(name + ' wrong error: ' + e.message); }
}

// A1/A8: prove the value actually lands, then clean up.
if (WRITE === false) {
  note('write path untested. Re-run with --write to set/list/delete a throwaway secret and variable.');
} else {
  const sName = 'PORTROX_SELFTEST';
  const vName = 'PORTROX_SELFTEST';
  const sVal = 'probe-' + randomBytes(9).toString('hex');   // must NOT become "-"
  const vVal = 'v-' + randomBytes(6).toString('hex');
  try {
    const r = await GH.putSecret(target, sName, sVal);
    r.via === 'stdin' ? ok('putSecret used stdin (not --body -)') : fail('putSecret did not use stdin');
    const list = await GH.listSecretNames(target);
    list.some(s => s.name === sName) ? ok('secret present after set') : fail('secret missing after set');
    list.every(s => s.value === undefined) ? ok('secret values never exposed') : fail('secret value leaked');
  } catch (e) { fail('putSecret: ' + e.message); }
  try {
    await GH.putVariable(target, vName, vVal);
    const vars = await GH.listVariables(target);
    const hit = vars.find(v => v.name === vName);
    hit && hit.value === vVal ? ok('variable round trip exact (' + vVal + ')')
      : fail('variable value wrong: ' + JSON.stringify(hit));
  } catch (e) { fail('putVariable: ' + e.message); }
  try { await GH.deleteVariable(target, vName, vName); ok('throwaway variable deleted'); }
  catch (e) { fail('deleteVariable cleanup: ' + e.message); }
  try { await GH.deleteSecret(target, sName, sName); ok('throwaway secret deleted'); }
  catch (e) { fail('deleteSecret cleanup: ' + e.message); }
}

console.log('\n' + (bad === 0 ? 'GITHUB OK' : 'GITHUB BAD=' + bad));
process.exit(bad === 0 ? 0 : 1);
