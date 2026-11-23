/**
 * Live-site verification. Every content assertion is gated on HTTP 200 so a
 * GitHub Pages 404 body can never be measured as "real content".
 * If the homepage is not Portrox output, emit ONE clear verdict and stop,
 * instead of thirteen cascading failures.
 *   node scripts/verify-live.mjs [base_url]
 */
import { loadConfig, publicSupabaseFor } from '../packages/cli/config-store.mjs';

const c = loadConfig();
const siteId = 'sid200ok.github.io';
const base = (process.argv[2] || 'https://' + siteId).replace(/\/$/, '');
let bad = 0;
const ok = m => console.log('OK   ' + m);
const fail = m => { bad++; console.log('FAIL ' + m); };
const note = m => console.log('NOTE ' + m);

// status 0 means the fetch THREW - a transport failure, not an HTTP status.
// WSL drops connections transiently. Retry with backoff and a timeout, and keep
// the error message so the cause is visible instead of being discarded.
async function get(path, tries = 3) {
  let last = '';
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(base + path, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
      return { status: r.status, body: await r.text(), attempts: i };
    } catch (e) {
      last = String(e && e.message || e);
      if (i < tries) await new Promise(r => setTimeout(r, 1000 * i));
    }
  }
  return { status: 0, body: '', error: last, attempts: tries };
}

console.log('LIVE ' + base);
const home = await get('/');
if (home.status === 0) {
  fail('TRANSPORT ERROR after ' + home.attempts + ' attempts: ' + home.error);
  note('This is a network/TLS failure from this machine, NOT a verdict on the published site.');
  note('Check: curl -sSI ' + base + '/  and  getent hosts sid200ok.github.io');
  console.log('\nLIVE BAD=' + bad + ' (transport - no product verdict issued)');
  process.exit(1);
}
if (home.status !== 200) { fail('GET / -> HTTP ' + home.status); console.log('LIVE BAD=' + bad); process.exit(1); }
if (home.attempts > 1) note('homepage needed ' + home.attempts + ' attempts (transient network)');
ok('GET / 200');

const isPortrox = /assets\/portrox\.css|portrox-theme|data-portrox/.test(home.body);
if (isPortrox === false) {
  fail('homepage is NOT Portrox output - the site has never been published by Portrox');
  note('Pages is still serving the previous build. ACTION: Studio -> ' + siteId + ' -> Register -> Publish');
  note('Publish creates gh-pages, switches Pages from workflow to legacy branch deploy, and disables the competing Actions workflow.');
  console.log('\nLIVE BAD=' + bad + ' (not published - remaining checks skipped, no verdict on them)');
  process.exit(1);
}
ok('served by Portrox');

// A3: markers alone cannot distinguish the CURRENT build from an older Portrox
// build served by a stale CDN. Compare the homepage byte-for-byte with dist.
{
  const { readFileSync, existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const localPath = join(process.cwd(), 'dist', siteId, 'index.html');
  if (existsSync(localPath) === false) {
    note('dist index.html absent - run a build first; artifact equality not assessed');
  } else {
    const local = readFileSync(localPath, 'utf8');
    if (local === home.body) ok('live homepage byte-identical to dist (' + local.length + ' chars)');
    else fail('live homepage DIFFERS from dist (local ' + local.length + ' vs live ' + home.body.length + ' chars) - stale build or CDN cache');
  }
}

const want = publicSupabaseFor((c.supabase.default_project_ref || ''));
const formsExpected = Boolean(want.url);

for (const [label, re] of [['theme block', /portrox-theme/], ['contact form', /id="contact-form"|data-portrox-form/]]) {
  re.test(home.body) ? ok(label + ' present') : fail(label + ' missing');
}
/home\.text|cdn\.tailwindcss\.com/.test(home.body) ? fail('runtime CDN present') : ok('no runtime CDN');

const pages = ['/about.html', '/services.html', '/book.html', '/about-website.html', '/404.html', '/sitemap.xml', '/robots.txt', '/assets/portrox.css'];
const fetched = {};
for (const p of pages) {
  const r = await get(p);
  fetched[p] = r;
  r.status === 200 ? ok('GET ' + p + ' 200') : fail('GET ' + p + ' -> HTTP ' + r.status);
}

// Content checks ONLY when the fetch actually succeeded.
const about = fetched['/about.html'];
if (about.status === 200) {
  /mailto:|profile-links/.test(about.body) ? ok('profile links on about.html') : fail('profile links missing on about.html');
} else note('about.html content not assessed (not 200)');

const locked = fetched['/about-website.html'];
if (locked.status === 200) {
  locked.body.length > 4000 ? ok('locked page real (' + locked.body.length + 'B)') : fail('locked page too short (' + locked.body.length + 'B)');
} else note('locked page content not assessed (not 200)');

for (const p of ['/.gitleaks.toml', '/.env', '/supabase/config.toml', '/scripts/verify-daemon.mjs', '/package.json']) {
  const r = await get(p);
  r.status === 200 ? fail('PRIVATE FILE SERVED ' + p) : ok('private path blocked ' + p + ' (' + r.status + ')');
}

const sc = await get('/assets/site-config.js');
if (formsExpected) {
  if (sc.status === 200) {
    ok('site-config.js 200');
    /sb_secret_|sb_service_/.test(sc.body) ? fail('SECRET KEY IN PUBLIC BUNDLE') : ok('publishable key only');
    sc.body.includes(want.url) ? ok('site-config points at the bound project') : fail('site-config project mismatch');
  } else fail('site-config.js missing but form backend expected (HTTP ' + sc.status + ')');
  const f = await get('/assets/forms.js');
  f.status === 200 ? ok('forms.js 200') : fail('forms.js missing (HTTP ' + f.status + ')');
} else {
  note('no project bound - form assets not expected');
  sc.status === 200 ? fail('site-config.js shipped with no project bound') : ok('no site-config.js (correct)');
}

console.log('\n' + (bad === 0 ? 'LIVE OK' : 'LIVE BAD=' + bad));
process.exit(bad === 0 ? 0 : 1);
