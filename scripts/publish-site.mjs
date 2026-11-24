/**
 * Terminal mirror of Studio -> Register -> Publish.
 *   node scripts/publish-site.mjs [site_id]
 *
 * ORDER (each step is a precondition for the next):
 *   0 prove API + git push access   (never prompt, never mutate before this)
 *   1 ensure repo
 *   2 render with the bound project injected
 *   3 register tenant row
 *   4 orphan push to gh-pages
 *   5 Pages -> legacy branch deploy from gh-pages
 *   6 mark is_published            (true the moment Pages is configured)
 *   7 request a build and POLL until built
 *   8 best-effort workflow cleanup (never fatal)
 *
 * SAFETY: GitHub's own dynamic workflow `pages-build-deployment` is what BUILDS
 * a legacy Pages site. It lives outside .github/workflows/ and must NEVER be
 * disabled. The previous matcher tried to, and 404'd. Pure ASCII.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, cpSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, publicSupabaseFor } from '../packages/cli/config-store.mjs';
import { resolveGitAuth } from '../packages/cli/git-auth.mjs';
import * as DB from '../packages/cli/db-bridge.mjs';
import * as GH from '../packages/cli/github-ops.mjs';

const REPO = process.cwd();
const siteId = process.argv[2] || 'sid200ok.github.io';
const cfgPath = join(REPO, 'sites', siteId, 'site.json');
const ok = m => console.log('OK   ' + m);
const note = m => console.log('NOTE ' + m);
const die = m => { console.error('FAIL ' + m); process.exit(1); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
if (existsSync(cfgPath) === false) die('no such site: ' + siteId);

const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
const ref = (cfg.database && cfg.database.project_ref) || loadConfig().supabase.default_project_ref;
if (!ref) die('site has no bound project');
const repoFull = (cfg.pages && cfg.pages.repo) || ('sid200ok/' + siteId);
const branch = (cfg.pages && cfg.pages.branch) || 'gh-pages';
const liveUrl = (cfg.pages && cfg.pages.live_url) || ('https://' + siteId);

console.log('site   : ' + siteId);
console.log('project: ' + ref);
console.log('repo   : ' + repoFull + ' branch ' + branch);

/* 0. AUTH FIRST */
const ghAuth = await GH.authStatus();
if (ghAuth.connected === false) die('GitHub API not connected: ' + (ghAuth.error || 'unknown'));
ok('GitHub API ' + ghAuth.login + ' via ' + ghAuth.source);
let auth;
try { auth = resolveGitAuth(repoFull); }
catch (e) {
  console.error('FAIL ' + e.message);
  console.error('ACTION: gh auth login, or add an SSH key, or store a PAT in the Studio.');
  process.exit(1);
}
ok('git push auth: ' + auth.method);

function gitIn(args, cwd) {
  const r = spawnSync('git', auth.args.concat(args), { cwd, env: auth.env, encoding: 'utf8', timeout: 180000 });
  if (r.status !== 0) throw new Error('git ' + args.join(' ') + ' :: ' + String(r.stderr || r.stdout || '').trim().slice(0, 300));
  return String(r.stdout || '').trim();
}

/* 1. repo */
try { await GH.getRepo(repoFull); ok('repo exists'); }
catch {
  const [owner, name] = repoFull.split('/');
  const created = await GH.createRepo({ name, owner, description: 'Portfolio published by Portrox' });
  ok('repo created ' + created.full_name);
}

/* 2. render */
cfg.supabase = publicSupabaseFor(ref);
writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
const { renderSite } = await import(join(REPO, 'packages/core/render.mjs'));
const outDir = join(REPO, 'dist', siteId);
const rendered = await renderSite(join(REPO, 'sites', siteId), outDir);
const { normalizeDir } = await import(join(REPO, 'packages/core/html-normalize.mjs'));
const nz = normalizeDir(join(REPO, 'dist', siteId));
for (const d of nz.details) note('normalized ' + d);
ok('rendered ' + rendered.pages + ' pages, ' + rendered.bytes + ' bytes, forms=' + (cfg.supabase.url ? 'on' : 'off'));

/* 3. register */
const reg = await DB.registerSite(ref, siteId, cfg, ghAuth.login);
reg.ok ? ok('registered in DB via ' + reg.via) : die('register: ' + reg.error);

/* 4. orphan push */
let pushedSha = '';
const tmp = mkdtempSync(join(tmpdir(), 'portrox-pub-'));
try {
  gitIn(['init', '-q', '-b', branch], tmp);
  gitIn(['config', 'user.email', 'portrox@localhost'], tmp);
  gitIn(['config', 'user.name', 'Portrox'], tmp);
  cpSync(outDir, tmp, { recursive: true });
  writeFileSync(join(tmp, '.nojekyll'), '');
  gitIn(['add', '-A'], tmp);
  gitIn(['commit', '-q', '-m', 'Publish via Portrox'], tmp);
  pushedSha = gitIn(['rev-parse', 'HEAD'], tmp);
  gitIn(['remote', 'add', 'origin', auth.url], tmp);
  gitIn(['push', '-q', '--force', 'origin', 'HEAD:refs/heads/' + branch], tmp);
  ok('pushed orphan ' + branch + ' at ' + pushedSha.slice(0, 8));
} catch (e) { die(String(e.message)); }
finally { rmSync(tmp, { recursive: true, force: true }); }

const branches = await GH.listBranches(repoFull);
branches.some(b => b.name === branch) ? ok('branch ' + branch + ' present on remote') : die('branch ' + branch + ' missing after push');

/* 5. Pages source */
let pages;
try { pages = await GH.pagesEnable(repoFull, { branch, path: '/', build_type: 'legacy' }); }
catch (e) {
  if (Number(e.status) === 409) pages = await GH.pagesUpdate(repoFull, { branch, path: '/', build_type: 'legacy' });
  else die('pages enable: ' + e.message);
}
ok('Pages build_type=' + (pages.build_type || '?') + ' source=' + JSON.stringify(pages.source || {}));
if ((pages.build_type || '') !== 'legacy') die('Pages did not switch to legacy branch deploy');

/* 6. DB truth NOW, before any optional work */
const mark = await DB.markPublished(ref, siteId, true);
mark.ok ? ok('is_published=true') : die('markPublished: ' + mark.error);
cfg.registered = true; cfg.published = true;
writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');

/* 7. The PUSH already triggers a Pages build once the source points at
   gh-pages. Requesting another unconditionally created a SECOND build for the
   same commit; GitHub allows one concurrent build per repo, so it cancelled the
   first and the cancelled run surfaced as 'errored: Page build failed.' on EVERY
   publish. Only request a build when none exists for our commit - which is the
   first-publish case, where the source was just switched. */
let seen = null;
for (let i = 0; i < 4; i++) {
  try {
    const b = await GH.pagesLatestBuild(repoFull);
    if (String(b.commit || '') === pushedSha) { seen = b; break; }
  } catch {}
  await sleep(4000);
}
if (seen) {
  ok('push already triggered a build (' + (seen.status || 'queued') + ') - not requesting a duplicate');
} else {
  try {
    const req = await GH.pagesRequestBuild(repoFull);
    ok('no build for our commit yet - requested one (' + (req.status || 'queued') + ')');
  } catch (e) { note('build request refused: ' + e.message + ' - polling'); }
}

let build = null;
let retried = false;
for (let i = 0; i < 60; i++) {
  await sleep(8000);
  try { build = await GH.pagesLatestBuild(repoFull); }
  catch (e) { note('latest build: ' + e.message); continue; }
  const st = String(build.status || '');
  const sha = String(build.commit || '');
  const mine = pushedSha && sha === pushedSha;
  console.log('     build ' + (i + 1) + ': ' + st + ' for ' + (sha.slice(0, 8) || '?') + (mine ? ' (ours)' : ' (older)') + (build.error ? ' :: ' + build.error : ''));
  // A build for an OLDER commit tells us nothing about ours. Keep waiting.
  if (!mine) continue;
  if (st === 'built') break;
  if (st === 'errored') {
    if (!retried) {
      retried = true;
      note('Pages build errored for our commit - requesting one retry');
      try { await GH.pagesRequestBuild(repoFull); } catch (e) { note('retry request refused: ' + e.message); }
      continue;
    }
    console.error('FAIL Pages build errored twice for ' + pushedSha.slice(0, 8) + ': ' + (build.error || 'unknown'));
    console.error('ACTION read the real cause:');
    console.error('  gh api "repos/' + repoFull + '/actions/runs?per_page=15" --jq \'.workflow_runs[] | "\(.id) \(.name) \(.conclusion)"\'');
    console.error('  gh run view <id> --repo ' + repoFull + ' --log-failed');
    process.exit(1);
  }
}
if (!build || build.status !== 'built' || String(build.commit || '') !== pushedSha) {
  // A build still in progress is NOT a failed publish. GitHub Pages was slow.
  // Report honestly and let verify-live decide by comparing bytes.
  note('Pages still ' + ((build && build.status) || 'unknown') + ' for ' + pushedSha.slice(0, 8) + ' after the wait window');
  note('not claiming success - verify-live compares the served bytes to dist');
} else {
  ok('Pages built the pushed commit ' + pushedSha.slice(0, 8));
}

/* 8. best-effort cleanup. NEVER disable GitHub's own Pages builder. */
for (const wf of await GH.listWorkflows(repoFull)) {
  const path = String(wf.path || '');
  const base = path.split('/').pop();
  if (base === 'pages-build-deployment' || path.startsWith('.github/workflows/') === false) {
    note('keep ' + (base || wf.name) + ' (GitHub-managed Pages builder or dynamic workflow)');
    continue;
  }
  const label = String(wf.name || '') + ' ' + base;
  if (/pages|deploy|static/i.test(label) === false) { note('keep ' + base + ' (not a Pages deployer)'); continue; }
  if (wf.state !== 'active') { note('already inactive ' + base); continue; }
  try {
    await GH.workflowSetState(repoFull, String(wf.id), false);
    ok('disabled competing workflow ' + base);
  } catch (e) {
    note('could not disable ' + base + ' (' + (e.status || '?') + '): ' + e.message + ' - continuing');
  }
}

console.log('\nLIVE ' + liveUrl);
console.log('NEXT node scripts/verify-rpc.mjs --positive && node scripts/verify-live.mjs');
console.log('PUBLISH OK');
