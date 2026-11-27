/**
 * Search snippets and share cards: the quality contract, not the structural one.
 *
 *   node scripts/verify-meta.mjs
 *
 * CORRECTIONS, all mine, recorded so they are not repeated:
 *  1. v1 printed "0 HTML pages ... META OK" against a dist/ a FAILED build had
 *     wiped. The expected page set is now derived from cfg.nav.
 *  2. v2 demanded og:description on the noindex 404, reversing a decision
 *     verify-content had already recorded. noindex pages are exempt.
 *  3. v4 accepted og:image on existsSync alone. A 1x1 pixel, a truncated file or
 *     a 0-byte placeholder would all have passed - a proxy for the property.
 *     A PNG is now parsed: signature, IHDR dimensions, IEND present. Open Graph
 *     needs at least 200x200; 1200x630 is the shape platforms expect.
 *
 * Length is measured on DECODED text: verify-content measures the escaped
 * attribute, which overstates by 4 per '&'.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
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
if (pages.length === 0) { console.log('FAIL zero HTML pages in dist - the build failed or was wiped.'); process.exit(1); }
for (const f of expected) pages.includes(f) ? ok('expected page present: ' + f) : fail('expected page MISSING: ' + f);
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

/** The image must be a usable image, not merely a file that exists. */
const imageVerdict = (abs) => {
  const size = statSync(abs).size;
  if (size < 1024) return { ok: false, why: 'only ' + size + ' bytes - not a usable share image' };
  if (size > 5 * 1024 * 1024) return { ok: false, why: size + ' bytes - platforms cap share images around 5MB' };
  const b = readFileSync(abs);
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  if (b.subarray(0, 8).equals(sig)) {
    if (b.length < 33 || b.subarray(12, 16).toString('ascii') !== 'IHDR') return { ok: false, why: 'PNG has no IHDR' };
    const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
    if (b.subarray(b.length - 8, b.length - 4).toString('ascii') !== 'IEND') return { ok: false, why: 'PNG has no IEND - truncated' };
    if (w < 200 || h < 200) return { ok: false, why: 'PNG is ' + w + 'x' + h + ', Open Graph needs at least 200x200' };
    const ratio = w / h;
    return { ok: true, why: 'PNG ' + w + 'x' + h + ', ' + size + ' bytes' + (Math.abs(ratio - 1.91) < 0.06 ? ' (1.91:1, ideal)' : ' (ratio ' + ratio.toFixed(2) + ', 1.91:1 preferred)') };
  }
  if (b[0] === 0xFF && b[1] === 0xD8) return { ok: true, why: 'JPEG ' + size + ' bytes (dimensions not parsed - confirm 1200x630 yourself)' };
  if (b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP') return { ok: true, why: 'WebP ' + size + ' bytes (dimensions not parsed)' };
  return { ok: false, why: 'not a PNG, JPEG or WebP' };
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

  if (noindex) {
    if (desc === null) ok(tag + ' noindex - no description required, empty tag correctly removed');
    else if (desc.trim() === '') fail(tag + ' noindex but carries an EMPTY description tag');
    else ok(tag + ' noindex - description present and non-empty (' + desc.trim().length + ' chars)');
  } else if (desc === null || desc.trim() === '') {
    fail(tag + ' indexable but has no description');
  } else if (desc.trim().length < 50 || desc.trim().length > 160) {
    fail(tag + ' description ' + desc.trim().length + ' chars, outside 50-160: "' + desc.trim().slice(0, 90) + '"');
  } else ok(tag + ' description ' + desc.trim().length + ' chars (decoded)');

  for (const [name, v] of [['og:title', ogT], ['og:description', ogD]]) {
    if (v === null) noindex ? ok(tag + ' ' + name + ' absent on a noindex page - not required') : fail(tag + ' ' + name + ' missing');
    else if (v.trim() === '') fail(tag + ' ' + name + ' present but EMPTY');
    else ok(tag + ' ' + name + ' present');
  }
  if (ogI !== null && ogI.trim() === '') fail(tag + ' og:image present but EMPTY');

  if (card === null) { fail(tag + ' twitter:card missing'); continue; }
  if (!['summary', 'summary_large_image'].includes(card)) { fail(tag + ' unknown twitter:card ' + card); continue; }
  if (card === 'summary_large_image') {
    if (!ogI) { fail(tag + ' declares summary_large_image with NO og:image'); continue; }
    if (!/^https:\/\//i.test(ogI)) { fail(tag + ' og:image is not absolute https: ' + ogI); continue; }
    if (LIVE && !ogI.startsWith(LIVE + '/')) { fail(tag + ' og:image is not on this site: ' + ogI); continue; }
    const rel = ogI.slice(LIVE.length + 1);
    const abs = join(DIR, rel);
    if (!existsSync(abs)) { fail(tag + ' og:image points at ' + rel + ' which is NOT in the build'); continue; }
    const v = imageVerdict(abs);
    v.ok ? ok(tag + ' large-image card, ' + v.why) : fail(tag + ' og:image unusable: ' + v.why);
  } else {
    ogI ? note(tag + ' summary card although an og:image exists - upgrade when the image is final')
        : ok(tag + ' summary card, honestly matching the absence of an image');
  }
}

console.log('\n' + checked + ' page(s) examined, ' + expected.length + ' expected');
console.log(bad === 0 ? 'META OK' : 'META BAD=' + bad);
process.exit(bad === 0 ? 0 : 1);
