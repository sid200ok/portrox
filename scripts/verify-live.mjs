import { readFileSync, existsSync } from 'node:fs';
const ID = 'sid200ok.github.io';
const cfg = JSON.parse(readFileSync('sites/' + ID + '/site.json', 'utf8'));
const BASE = (cfg.live_url || 'https://' + ID).replace(/\/$/, '');
const wantForms = Boolean(cfg.supabase && cfg.supabase.url);

let bad = 0;
const ok = m => console.log('OK   ' + m);
const fail = m => { bad++; console.log('FAIL ' + m); };
const get = async p => { const r = await fetch(BASE + p, { redirect: 'follow' }); return { status: r.status, text: await r.text() }; };

console.log('LIVE ' + BASE);
const home = await get('/');
home.status === 200 ? ok('GET / 200') : fail('GET / ' + home.status);

// Portrox markers must be present; old Tailwind build markers must be gone.
home.text.includes('assets/portrox.css') ? ok('served by Portrox (portrox.css)') : fail('NOT Portrox output — publish has not run or Pages source is wrong');
home.text.includes('cdn.tailwindcss.com') === false ? ok('no Tailwind Play CDN') : fail('old Tailwind CDN still live');
home.text.includes('id="contact-form"') ? ok('contact form present') : fail('contact form missing');
home.text.includes('portrox-theme') ? ok('theme block present') : fail('theme block missing');

for (const p of ['/about.html', '/services.html', '/book.html', '/about-website.html', '/404.html', '/sitemap.xml', '/robots.txt', '/assets/portrox.css']) {
  const r = await get(p);
  r.status === 200 ? ok('GET ' + p + ' 200') : fail('GET ' + p + ' ' + r.status);
}
const about = await get('/about.html');
about.text.includes('mailto:') ? ok('profile links live') : fail('profile links missing on live about.html');

const locked = await get('/about-website.html');
locked.text.length > 4000 ? ok('locked page has real content (' + locked.text.length + 'B)') : fail('locked page looks like a stub');

// Private repo paths must NOT be served.
for (const p of ['/.gitleaks.toml', '/.env', '/supabase/config.toml', '/scripts/verify-daemon.mjs', '/package.json']) {
  const r = await get(p);
  r.status === 200 ? fail('PRIVATE FILE SERVED ' + p) : ok('private path blocked ' + p + ' (' + r.status + ')');
}

const sc = await get('/assets/site-config.js');
if (wantForms) {
  sc.status === 200 ? ok('site-config.js shipped') : fail('site-config.js missing but forms expected');
  /sb_(secret|service)_/.test(sc.text) ? fail('SECRET KEY IN PUBLIC BUNDLE') : ok('publishable key only');
  const f = await get('/assets/forms.js');
  f.status === 200 ? ok('forms.js shipped') : fail('forms.js missing');
} else {
  ok('forms intentionally disabled (Supabase not configured)');
}

console.log(bad === 0 ? 'LIVE OK' : 'LIVE BAD=' + bad);
process.exit(bad === 0 ? 0 : 1);
