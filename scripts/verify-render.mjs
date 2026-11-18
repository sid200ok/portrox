/**
 * Render gate. Rebuilds first, then asserts the artifact matches the CURRENT
 * config. A stale dist/ must never produce a pass.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { publicSupabaseFor, loadConfig } from '../packages/cli/config-store.mjs';

let bad = 0;
const ok = m => console.log('OK   ' + m);
const fail = m => { bad++; console.log('FAIL ' + m); };

// Always rebuild. Never trust a leftover dist/.
const b = spawnSync('node', ['packages/cli/portrox.mjs', 'build', '--all'], { encoding: 'utf8' });
process.stdout.write(b.stdout || ''); process.stderr.write(b.stderr || '');
if (b.status !== 0) { console.log('FAIL build failed'); process.exit(1); }
ok('rebuilt all sites before verifying');

if (existsSync('dist') === false) { console.log('FAIL dist/ missing'); process.exit(1); }
const cfgAll = loadConfig();

function newestUnder(dir) {
  let t = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    const s = statSync(p);
    if (e.isDirectory()) t = Math.max(t, newestUnder(p));
    else t = Math.max(t, s.mtimeMs);
  }
  return t;
}

for (const site of readdirSync('dist')) {
  const dir = 'dist/' + site;
  const cfgPath = 'sites/' + site + '/site.json';
  if (existsSync(cfgPath) === false) { fail(site + ': site.json missing'); continue; }
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  const idx = dir + '/index.html';
  if (existsSync(idx) === false) { fail(site + ': index.html missing'); continue; }
  const home = readFileSync(idx, 'utf8');
  const about = existsSync(dir + '/about.html') ? readFileSync(dir + '/about.html', 'utf8') : '';
  const locked = existsSync(dir + '/about-website.html') ? readFileSync(dir + '/about-website.html', 'utf8') : '';

  const want = (cfg.pages.base_path || '') === '' ? './' : cfg.pages.base_path + '/';
  home.includes('href="' + want + 'assets/portrox.css"') ? ok(site + ': css base ' + want) : fail(site + ': css base wrong');
  for (const r of ['about.html','services.html','book.html','about-website.html','404.html','sitemap.xml','robots.txt','.nojekyll'])
    existsSync(dir + '/' + r) ? ok(site + ': ' + r) : fail(site + ': ' + r + ' missing');
  (home.includes('cdn.tailwindcss.com') || home.includes('unpkg.com')) ? fail(site + ': runtime CDN') : ok(site + ': zero CDN');
  (home.match(/<style id="portrox-theme">/g) || []).length === 1 ? ok(site + ': theme block x1') : fail(site + ': theme block count');
  (about.includes('PORTROX_LINKS') || about.includes('mailto:')) ? ok(site + ': links on about.html') : fail(site + ': links missing');
  locked.length > 4000 ? ok(site + ': locked page real (' + locked.length + 'B)') : fail(site + ': locked page stub');

  // Freshness: artifact must be newer than every source input.
  const srcNewest = Math.max(newestUnder('sites/' + site), statSync('packages/core/render.mjs').mtimeMs, statSync('packages/core/portrox.css').mtimeMs);
  statSync(idx).mtimeMs >= srcNewest ? ok(site + ': artifact newer than sources') : fail(site + ': STALE artifact');

  // Consistency: injected credentials must equal what the bound project resolves to.
  const ref = (cfg.database && cfg.database.project_ref) || cfgAll.supabase.default_project_ref || '';
  const expect = publicSupabaseFor(ref);
  const got = cfg.supabase || {};
  (got.url || '') === expect.url ? ok(site + ': supabase url matches bound project (' + (ref || 'none') + ')') : fail(site + ': url mismatch — got "' + (got.url || '') + '" expected "' + expect.url + '"');
  const formsShipped = existsSync(dir + '/assets/forms.js');
  if (expect.url) {
    formsShipped ? ok(site + ': forms.js shipped (project bound)') : fail(site + ': forms.js missing but project bound');
    const c = readFileSync(dir + '/assets/site-config.js', 'utf8');
    /sb_(secret|service)_/.test(c) ? fail(site + ': SECRET KEY IN BUNDLE') : ok(site + ': publishable only');
  } else {
    formsShipped ? fail(site + ': forms.js shipped with NO bound project (stale)') : ok(site + ': forms correctly disabled (no project)');
  }
}
console.log('\n' + (bad === 0 ? 'RENDER OK' : 'RENDER BAD=' + bad));
process.exit(bad === 0 ? 0 : 1);
