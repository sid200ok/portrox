/**
 * Functional test for github-ops.mjs. READ-ONLY: never creates, deletes,
 * dispatches, or mutates anything. Skips cleanly (exit 0) with no PAT so a
 * fresh install is not blocked, but FAILS loudly once a PAT is present.
 *   node scripts/verify-github.mjs [owner/repo]
 */
import { maskedConfig } from '../packages/cli/config-store.mjs';
import * as GH from '../packages/cli/github-ops.mjs';

let bad = 0;
const ok = m => console.log('OK   ' + m);
const fail = m => { bad++; console.log('FAIL ' + m); };
const note = m => console.log('NOTE ' + m);

if (maskedConfig().github.configured === false) {
  note('no GitHub PAT — Studio → Settings → GitHub. Skipping (no verdict).');
  process.exit(0);
}

let who = null;
try { who = await GH.whoami(); ok('whoami → ' + who.login); }
catch (e) { fail('whoami: ' + e.message); console.log('GITHUB BAD=' + bad); process.exit(1); }

let repos = [];
try {
  repos = await GH.listRepos();
  ok('listRepos → ' + repos.length + ' repos');
  const shape = repos.every(r => typeof r.full_name === 'string' && r.full_name.includes('/'));
  shape ? ok('repo shape has owner/name') : fail('repo shape wrong');
} catch (e) { fail('listRepos: ' + e.message); }

const target = process.argv[2]
  || (repos.find(r => r.full_name === who.login + '/' + who.login + '.github.io') || {}).full_name
  || (repos.find(r => r.has_pages) || {}).full_name
  || (repos[0] || {}).full_name;

if (!target) { note('no repository available to probe'); console.log(bad === 0 ? 'GITHUB OK' : 'GITHUB BAD=' + bad); process.exit(bad ? 1 : 0); }
console.log('probing: ' + target);

const probes = [
  ['getRepo',        () => GH.getRepo(target),            j => typeof j.full_name === 'string'],
  ['listBranches',   () => GH.listBranches(target),       a => Array.isArray(a) && a.every(b => typeof b.name === 'string')],
  ['listCommits',    () => GH.listCommits(target),        a => Array.isArray(a)],
  ['listReleases',   () => GH.listReleases(target),       a => Array.isArray(a)],
  ['pagesStatus',    () => GH.pagesStatus(target),        j => typeof j.enabled === 'boolean'],
  ['pagesBuilds',    () => GH.pagesBuilds(target),        a => Array.isArray(a)],
  ['pagesLatestBuild',() => GH.pagesLatestBuild(target),  j => j && typeof j === 'object'],
  ['pagesDnsHealth', () => GH.pagesDnsHealth(target),     j => j && typeof j === 'object'],
  ['listWorkflows',  () => GH.listWorkflows(target),      a => Array.isArray(a)],
  ['listRuns',       () => GH.listRuns(target),           a => Array.isArray(a)],
  ['listSecretNames',() => GH.listSecretNames(target),    a => Array.isArray(a) && a.every(s => typeof s.name === 'string' && s.value === undefined)]
];
for (const [name, fn, shape] of probes) {
  try {
    const r = await fn();
    if (r === null || r === undefined) { fail(name + ' returned null/undefined (null-safety regression)'); continue; }
    shape(r) ? ok(name + ' → ' + (Array.isArray(r) ? r.length + ' item(s)' : JSON.stringify(r).slice(0, 110)))
             : fail(name + ' shape wrong: ' + JSON.stringify(r).slice(0, 160));
  } catch (e) {
    // 404 on Pages/workflows/secrets is legitimate for a repo without them.
    if (Number(e.status) === 404) note(name + ': 404 (not enabled on this repo) — acceptable');
    else fail(name + ': ' + e.message);
  }
}

// Confirmation gates must refuse without a matching confirm value.
const gates = [
  ['deleteRepo gate',   () => GH.deleteRepo(target, 'wrong')],
  ['pagesDisable gate', () => GH.pagesDisable(target, 'wrong')],
  ['deleteSecret gate', () => GH.deleteSecret(target, 'PROBE', 'wrong')]
];
for (const [name, fn] of gates) {
  try { await fn(); fail(name + ' did NOT refuse a wrong confirmation'); }
  catch (e) { /confirmation/i.test(e.message) ? ok(name + ' refused') : fail(name + ' wrong error: ' + e.message); }
}

console.log('\n' + (bad === 0 ? 'GITHUB OK' : 'GITHUB BAD=' + bad));
process.exit(bad === 0 ? 0 : 1);
