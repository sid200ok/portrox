import { readFileSync, existsSync, readdirSync } from 'node:fs';
let bad = 0;
const fail = m => { bad++; console.log('FAIL ' + m); };
const ok = m => console.log('OK   ' + m);
if (existsSync('dist') === false) { console.log('FAIL dist/ missing — run: portrox build --all'); process.exit(1); }
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
  (home.match(/<style id="portrox-theme">/g) || []).length === 1 ? ok(site + ': theme block x1') : fail(site + ': theme block count wrong');
  // Links live on about.html, NOT index.html.
  const hasLinks = about.includes('PORTROX_LINKS') || about.includes('mailto:');
  hasLinks ? ok(site + ': links on about.html') : fail(site + ': links missing on about.html');
  locked.length > 1500 ? ok(site + ': locked page has real content (' + locked.length + 'B)') : fail(site + ': locked page is a stub (' + locked.length + 'B)');
  existsSync(dir + '/assets/portrox.css') ? ok(site + ': css shipped') : fail(site + ': css not shipped');
  if (cfg.supabase && cfg.supabase.url) {
    existsSync(dir + '/assets/forms.js') ? ok(site + ': forms.js shipped') : fail(site + ': forms.js missing');
    const c = readFileSync(dir + '/assets/site-config.js', 'utf8');
    /sb_(secret|service)_/.test(c) ? fail(site + ': SECRET KEY IN BUNDLE') : ok(site + ': publishable only');
  } else ok(site + ': supabase unconfigured (forms guarded)');
}
console.log(bad === 0 ? 'RENDER OK' : 'RENDER BAD=' + bad);
process.exit(bad === 0 ? 0 : 1);
