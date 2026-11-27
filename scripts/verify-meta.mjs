/**
 * Search snippets and share cards: the quality contract, not the structural one.
 *
 *   node scripts/verify-meta.mjs
 *
 * THREE CORRECTIONS, all mine, recorded so they are not repeated:
 *  1. v1 printed "0 HTML pages ... META OK" against a dist/ a FAILED build had
 *     wiped. A gate that passes on an empty artifact is worse than no gate. The
 *     expected page set is now derived from cfg.nav and every member must exist.
 *  2. v2 demanded og:description on EVERY page including the noindex 404. The
 *     normalizer correctly REMOVES the empty description and og:description from
 *     a noindex page, and verify-content's own header already settled this:
 *     "A 404 page must be noindex; requiring a meta description there was wrong."
 *     Social metadata describes shareable content; an error page is neither
 *     shared nor indexed. Demanding it forces either fabricated text (R8) or the
 *     return of the empty tag the normalizer just removed.
 *  3. Length is measured on DECODED text. verify-content measures the escaped
 *     attribute, which overstates by 4 per '&' - that is why it reported 168 for
 *     a 164-character string.
 *
 * RULES
 *   expected pages : all present; zero-page or partial build is a FAIL
 *   indexable page : description 50-160 decoded chars, og:title and
 *                    og:description present and non-empty
 *   noindex page   : snippet and social descriptions NOT required; any tag that
 *                    IS present must be non-empty
 *   every page     : twitter:card present and valid; summary_large_image only
 *                    when og:image exists, is absolute https on this site, and
 *                    the file ships in dist
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ID = 'sid200ok.github.io';
const DIR = join('dist', ID);
let bad = 0, checked = 0;
const ok = m => console.log('OK   ' + m);
const fail = m => { bad++; console.log('FAIL ' + m); };
const note = m => console.log('NOTE ' + m);

if (!existsSync(DIR)) { console.log('FAIL no build directory for ' + ID + ' - run a build first'); process.exit(1); }
const cfg = JSON.parse(readFileSync(join('sites', ID, 'site.json'), 'utf8'));
const LIVE = String(cfg.live_url || '').replace(/\/+$/, '');
const nav = cfg.nav || {};

const expected = ['index.html', 'about-website.html', '404.html'];
if (nav.services !== false) expected.push('services.html');
if (nav.appointments !== false) expected.push('book.html');
if (nav.about !== false) expected.push('about.html');
if (nav.client_auth === true) expected.push('login.html');

const pages = readdirSync(DIR).filter(f => f.endsWith('.html')).sort();
console.log('site ' + ID + ' | ' + pages.length + ' HTML pages | expected ' + expected.length + ' | live ' + LIVE);

if (pages.length === 0) {
  console.log('FAIL zero HTML pages in dist - the build failed or was wiped. Nothing was verified.');
  process.exit(1);
}
for (const f of expected) {
  pages.includes(f) ? ok('expected page present: ' + f) : fail('expected page MISSING: ' + f + ' - partial build');
}
if (bad) { console.log('\nMETA BAD=' + bad + ' (artifact incomplete)'); process.exit(1); }

const decode = s => String(s || '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");
const meta = (html, key, val) => {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const k = new RegExp('\\b' + key + '=["\']([^"\']*)["\']', 'i').exec(tag);
    if (!k || k[1].toLowerCase() !== val.toLowerCase()) continue;
    const c = /\bcontent=["']([^"']*)["']/i.exec(tag);
    return decode(c ? c[1] : '');
  }
  return null;
};

for (const f of pages) {
  const html = readFileSync(join(DIR, f), 'utf8');
  const tag = ID + '/' + f;
  const noindex = /name=["']robots["'][^>]*noindex/i.test(html);
  const desc = meta(html, 'name', 'description');
  const ogT = meta(html, 'property', 'og:title');
  const ogD = meta(html, 'property', 'og:description');
  const ogI = meta(html, 'property', 'og:image');
  const card = meta(html, 'name', 'twitter:card');
  checked++;

  /* 1. snippet */
  if (noindex) {
    if (desc === null) ok(tag + ' noindex - no description required, empty tag correctly removed');
    else if (desc.trim() === '') fail(tag + ' noindex but carries an EMPTY description tag');
    else ok(tag + ' noindex - description present and non-empty (' + desc.trim().length + ' chars)');
  } else if (desc === null || desc.trim() === '') {
    fail(tag + ' indexable but has no description');
  } else if (desc.trim().length < 50 || desc.trim().length > 160) {
    fail(tag + ' description ' + desc.trim().length + ' chars, outside 50-160: "' + desc.trim().slice(0, 90) + '"');
  } else {
    ok(tag + ' description ' + desc.trim().length + ' chars (decoded)');
  }

  /* 2. social tags: required on indexable, optional-but-non-empty on noindex */
  for (const [name, v] of [['og:title', ogT], ['og:description', ogD]]) {
    if (v === null) {
      noindex ? ok(tag + ' ' + name + ' absent on a noindex page - not required')
              : fail(tag + ' ' + name + ' missing');
    } else if (v.trim() === '') {
      fail(tag + ' ' + name + ' present but EMPTY');
    } else {
      ok(tag + ' ' + name + ' present');
    }
  }
  if (ogI !== null && ogI.trim() === '') fail(tag + ' og:image present but EMPTY');

  /* 3. the card must match the image that actually exists */
  if (card === null) { fail(tag + ' twitter:card missing'); continue; }
  if (!['summary', 'summary_large_image'].includes(card)) { fail(tag + ' unknown twitter:card ' + card); continue; }
  if (card === 'summary_large_image') {
    if (!ogI) { fail(tag + ' declares summary_large_image with NO og:image - the card renders empty'); continue; }
    if (!/^https:\/\//i.test(ogI)) { fail(tag + ' og:image is not an absolute https URL: ' + ogI); continue; }
    if (LIVE && !ogI.startsWith(LIVE + '/')) { fail(tag + ' og:image is not on this site: ' + ogI); continue; }
    const rel = ogI.slice(LIVE.length + 1);
    existsSync(join(DIR, rel))
      ? ok(tag + ' large-image card, image ships at ' + rel)
      : fail(tag + ' og:image points at ' + rel + ' which is NOT in the build');
  } else {
    ogI ? note(tag + ' summary card although an og:image exists - acceptable until the image is final')
        : ok(tag + ' summary card, honestly matching the absence of an image');
  }
}

console.log('\n' + checked + ' page(s) examined, ' + expected.length + ' expected');
console.log(bad === 0 ? 'META OK' : 'META BAD=' + bad);
process.exit(bad === 0 ? 0 : 1);
