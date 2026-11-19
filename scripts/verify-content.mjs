/**
 * Content-structure gate on the rendered artifact.
 *   node scripts/verify-content.mjs [site_id]
 * verify-live compares live to dist, so a defect present in BOTH passes it.
 * This checks the artifact itself: one h1 per page, unique titles, meta
 * description, lang, viewport, charset, no duplicate ids, resolvable internal
 * links, alt on images, no inline event handlers.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';

const siteId = process.argv[2] || 'sid200ok.github.io';
const root = join(process.cwd(), 'dist', siteId);
if (existsSync(root) === false) { console.error('FAIL no dist for ' + siteId + ' - run a build first'); process.exit(1); }
let bad = 0;
const ok = m => console.log('OK   ' + m);
const fail = m => { bad++; console.log('FAIL ' + m); };
const note = m => console.log('NOTE ' + m);
const all = (s, re) => [...s.matchAll(re)].map(m => m[1] || m[0]);

const pages = readdirSync(root).filter(f => f.endsWith('.html'));
if (pages.length === 0) { console.error('FAIL no HTML pages in dist'); process.exit(1); }
console.log('site: ' + siteId + ' | ' + pages.length + ' HTML pages');
const titles = new Map();

for (const f of pages) {
  const p = join(root, f);
  const html = readFileSync(p, 'utf8');
  const tag = siteId + '/' + f;

  const h1 = (html.match(/<h1[\s>]/gi) || []).length;
  h1 === 1 ? ok(tag + ' exactly one h1') : fail(tag + ' has ' + h1 + ' h1 elements (expected 1)');

  const t = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  if (!t || !t.trim()) fail(tag + ' missing <title>');
  else {
    const key = t.trim();
    if (titles.has(key)) fail(tag + ' duplicate <title> with ' + titles.get(key));
    else { titles.set(key, tag); ok(tag + ' title unique'); }
  }

  /<meta[^>]+name=["']description["'][^>]+content=["'][^"']{20,}/i.test(html)
    ? ok(tag + ' meta description') : fail(tag + ' meta description missing or too short');
  /<html[^>]+lang=["'][a-z]{2}/i.test(html) ? ok(tag + ' html lang') : fail(tag + ' html lang missing');
  /<meta[^>]+name=["']viewport["']/i.test(html) ? ok(tag + ' viewport') : fail(tag + ' viewport missing');
  /<meta[^>]+charset=/i.test(html) ? ok(tag + ' charset') : fail(tag + ' charset missing');

  const ids = all(html, /\sid=["']([^"']+)["']/gi);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  dup.length === 0 ? ok(tag + ' no duplicate ids') : fail(tag + ' duplicate ids: ' + [...new Set(dup)].join(', '));

  const imgs = html.match(/<img\b[^>]*>/gi) || [];
  const noAlt = imgs.filter(x => /\balt=/i.test(x) === false);
  noAlt.length === 0 ? ok(tag + ' all images have alt (' + imgs.length + ')') : fail(tag + ' ' + noAlt.length + ' image(s) without alt');

  const inline = html.match(/\son(?:click|load|error|mouseover)\s*=/gi) || [];
  inline.length === 0 ? ok(tag + ' no inline event handlers') : fail(tag + ' inline event handlers: ' + inline.length);

  const refs = [...all(html, /\shref=["']([^"']+)["']/gi), ...all(html, /\ssrc=["']([^"']+)["']/gi)];
  const missing = [];
  for (const r of refs) {
    if (/^(https?:|mailto:|tel:|data:|#|\/\/)/i.test(r)) continue;
    const clean = r.split('#')[0].split('?')[0];
    if (!clean) continue;
    const target = resolve(dirname(p), clean);
    const rel = relative(root, target);
    if (rel.startsWith('..')) { missing.push(r + ' (escapes site root)'); continue; }
    if (existsSync(target) === false) missing.push(r);
  }
  missing.length === 0 ? ok(tag + ' all internal refs resolve') : fail(tag + ' broken internal refs: ' + missing.join(', '));
}

for (const f of ['sitemap.xml', 'robots.txt', '.nojekyll', 'assets/portrox.css']) {
  existsSync(join(root, f)) ? ok('asset ' + f) : fail('asset missing ' + f);
}
console.log('\n' + (bad === 0 ? 'CONTENT OK' : 'CONTENT BAD=' + bad));
process.exit(bad === 0 ? 0 : 1);
