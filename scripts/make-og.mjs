/**
 * Generates the 1200x630 Open Graph share card from the owner's own profile.
 *
 *   node scripts/make-og.mjs [--site <id>]        # write the card
 *   node scripts/make-og.mjs [--site <id>] --check # prove freshness, write nothing
 *
 * WHY: twitter:card was downgraded to summary because og_image was empty, so
 * every shared link rendered without a picture. A portrait is optional; a card
 * is not. This draws one from profile.json with a 5x7 bitmap font and a PNG
 * encoder built on node:zlib. No dependency, no network, no browser.
 *
 * DETERMINISTIC: same profile in, same bytes out.
 * SELF-VALIDATING: it re-parses what it produced - signature, every chunk CRC,
 * IHDR dimensions, and a full inflate compared byte-for-byte against the raster.
 *
 * --check EXISTS BECAUSE THE CARD IS A COMMITTED DERIVATIVE. Edit the headline
 * and republish without regenerating, and the site text changes while the share
 * card still advertises the old one. That is the same drift sync-mirrors was
 * built to stop for migrations. --check regenerates in memory and compares.
 * The raster code below is byte-for-byte the version that produced sha256
 * 5a291c4786a38e234d710e1aae6b34102db3eb63dad122e46b48463dea10ba54.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';

const argSite = process.argv.indexOf('--site');
const ID = argSite > -1 ? process.argv[argSite + 1] : 'sid200ok.github.io';
const CHECK = process.argv.includes('--check');
const SITE = join('sites', ID);
if (!existsSync(join(SITE, 'site.json'))) { console.log('FAIL no such site: ' + ID); process.exit(1); }

const W = 1200, H = 630, MARGIN = 80, USABLE = W - MARGIN * 2;
const BG = [2, 6, 23], ACC = [34, 211, 238], FG = [226, 232, 240], DIM = [148, 163, 184];

/* 5x7 bitmap font. '#' is ink. Anything outside this set is dropped, so the
   card can never render a tofu box or silently mangle a character. */
const F = {
  A: '.###.|#...#|#...#|#####|#...#|#...#|#...#',
  B: '####.|#...#|#...#|####.|#...#|#...#|####.',
  C: '.###.|#...#|#....|#....|#....|#...#|.###.',
  D: '####.|#...#|#...#|#...#|#...#|#...#|####.',
  E: '#####|#....|#....|####.|#....|#....|#####',
  F: '#####|#....|#....|####.|#....|#....|#....',
  G: '.###.|#...#|#....|#.###|#...#|#...#|.###.',
  H: '#...#|#...#|#...#|#####|#...#|#...#|#...#',
  I: '#####|..#..|..#..|..#..|..#..|..#..|#####',
  J: '..###|...#.|...#.|...#.|...#.|#..#.|.##..',
  K: '#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#',
  L: '#....|#....|#....|#....|#....|#....|#####',
  M: '#...#|##.##|#.#.#|#...#|#...#|#...#|#...#',
  N: '#...#|##..#|#.#.#|#..##|#...#|#...#|#...#',
  O: '.###.|#...#|#...#|#...#|#...#|#...#|.###.',
  P: '####.|#...#|#...#|####.|#....|#....|#....',
  Q: '.###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#',
  R: '####.|#...#|#...#|####.|#.#..|#..#.|#...#',
  S: '.####|#....|#....|.###.|....#|....#|####.',
  T: '#####|..#..|..#..|..#..|..#..|..#..|..#..',
  U: '#...#|#...#|#...#|#...#|#...#|#...#|.###.',
  V: '#...#|#...#|#...#|#...#|#...#|.#.#.|..#..',
  W: '#...#|#...#|#...#|#...#|#.#.#|##.##|#...#',
  X: '#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#',
  Y: '#...#|#...#|.#.#.|..#..|..#..|..#..|..#..',
  Z: '#####|....#|...#.|..#..|.#...|#....|#####',
  '0': '.###.|#...#|#..##|#.#.#|##..#|#...#|.###.',
  '1': '..#..|.##..|..#..|..#..|..#..|..#..|.###.',
  '2': '.###.|#...#|....#|...#.|..#..|.#...|#####',
  '3': '####.|....#|....#|.###.|....#|....#|####.',
  '4': '...#.|..##.|.#.#.|#..#.|#####|...#.|...#.',
  '5': '#####|#....|####.|....#|....#|#...#|.###.',
  '6': '..##.|.#...|#....|####.|#...#|#...#|.###.',
  '7': '#####|....#|...#.|..#..|.#...|.#...|.#...',
  '8': '.###.|#...#|#...#|.###.|#...#|#...#|.###.',
  '9': '.###.|#...#|#...#|.####|....#|...#.|.##..',
  ' ': '.....|.....|.....|.....|.....|.....|.....',
  '-': '.....|.....|.....|#####|.....|.....|.....',
  '.': '.....|.....|.....|.....|.....|.##..|.##..',
  ',': '.....|.....|.....|.....|.##..|.##..|.#...',
  '/': '....#|....#|...#.|..#..|.#...|#....|#....',
  ':': '.....|.##..|.##..|.....|.##..|.##..|.....',
  '&': '.##..|#..#.|#.#..|.#...|#.#.#|#..#.|.##.#',
  '+': '.....|..#..|..#..|#####|..#..|..#..|.....',
  '#': '.#.#.|.#.#.|#####|.#.#.|#####|.#.#.|.#.#.'
};
const GLYPH = {};
for (const k of Object.keys(F)) GLYPH[k] = F[k].split('|');

const clean = s => String(s || '')
  .replace(/[·•–—]/g, '-')
  .toUpperCase()
  .split('').filter(ch => GLYPH[ch]).join('')
  .replace(/\s+/g, ' ').trim();

const textW = (t, s) => t.length ? t.length * (5 * s + s) - s : 0;
const wrap = (t, s, max) => {
  const out = []; let cur = '';
  for (const w of t.split(' ')) {
    const cand = (cur + ' ' + w).trim();
    if (textW(cand, s) <= max) cur = cand;
    else { if (cur) out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  return out;
};

/* raster */
const px = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H; i++) { px[i * 3] = BG[0]; px[i * 3 + 1] = BG[1]; px[i * 3 + 2] = BG[2]; }
const put = (x, y, c) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const o = (y * W + x) * 3; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2];
};
const rect = (x, y, w, h, c) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(x + i, y + j, c); };
const draw = (t, x, y, s, c) => {
  let cx = x;
  for (const ch of t) {
    const g = GLYPH[ch];
    for (let r = 0; r < 7; r++) for (let k = 0; k < 5; k++) if (g[r][k] === '#') rect(cx + k * s, y + r * s, s, s, c);
    cx += 6 * s;
  }
  return cx - s;
};

/* content, all from the owner's data */
const profile = JSON.parse(readFileSync(join(SITE, 'data', 'profile.json'), 'utf8'));
const cfg = JSON.parse(readFileSync(join(SITE, 'site.json'), 'utf8'));
const name = clean(profile.full_name || cfg.owner || ID);
const head = clean(profile.headline || '');
const loc = clean(profile.location || '');
const host = clean(String(cfg.live_url || '').replace(/^https?:\/\//, '').replace(/\/+$/, ''));

rect(0, 0, W, 6, ACC);
rect(MARGIN, 84, 120, 6, ACC);
let y = 130;
draw(name, MARGIN, y, 9, FG); y += 7 * 9 + 46;
for (const line of wrap(head, 4, USABLE).slice(0, 3)) { draw(line, MARGIN, y, 4, ACC); y += 7 * 4 + 16; }
y += 22;
if (loc) { draw(loc, MARGIN, y, 3, DIM); y += 7 * 3 + 20; }
draw(host, MARGIN, H - 122, 4, FG);
rect(MARGIN, H - 64, USABLE, 2, [30, 41, 59]);
draw('AVAILABLE FOR REMOTE WORK', MARGIN, H - 48, 2, DIM);
rect(0, H - 6, W, 6, ACC);

/* PNG assembly */
const crc32 = buf => {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  let c, t = [];
  for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  let crc = 0xFFFFFFFF;
  for (const b of buf) crc = t[(crc ^ b) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
};
const chunk = (type, data) => {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
};
const raw = Buffer.alloc(H * (1 + W * 3));
for (let r = 0; r < H; r++) { raw[r * (1 + W * 3)] = 0; px.copy(raw, r * (1 + W * 3) + 1, r * W * 3, (r + 1) * W * 3); }
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const idat = zlib.deflateSync(raw, { level: 9 });
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);

/* self-validation: re-parse the bytes we produced */
let bad = 0;
const ok = m => console.log('OK   ' + m);
const fail = m => { bad++; console.log('FAIL ' + m); };
png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) ? ok('PNG signature') : fail('PNG signature');
let off = 8; const seen = []; let idatBody = null;
while (off < png.length) {
  const ln = png.readUInt32BE(off), type = png.subarray(off + 4, off + 8).toString('ascii');
  const body = png.subarray(off + 8, off + 8 + ln);
  const want = png.readUInt32BE(off + 8 + ln);
  crc32(Buffer.concat([Buffer.from(type, 'ascii'), body])) === want ? ok('chunk ' + type + ' CRC (' + ln + ' bytes)') : fail('chunk ' + type + ' CRC');
  seen.push(type); if (type === 'IDAT') idatBody = body;
  off += 12 + ln;
}
seen.join(',') === 'IHDR,IDAT,IEND' ? ok('chunk order IHDR,IDAT,IEND') : fail('chunk order ' + seen.join(','));
const gw = png.readUInt32BE(16), gh = png.readUInt32BE(20);
(gw === W && gh === H) ? ok('IHDR ' + gw + 'x' + gh) : fail('IHDR ' + gw + 'x' + gh);
try {
  const back = zlib.inflateSync(idatBody);
  back.equals(raw) ? ok('inflate round trip byte-identical (' + back.length + ' bytes)') : fail('inflate round trip differs');
} catch (e) { fail('inflate threw: ' + e.message); }
if (bad) { console.log('\nOG CARD BAD=' + bad + ' - nothing written'); process.exit(1); }

const dest = join(SITE, 'assets', 'covers', 'og-card.png');
const sha = b => createHash('sha256').update(b).digest('hex');

if (CHECK) {
  console.log('\n-- freshness: does the committed card match the current profile? --');
  if (!existsSync(dest)) { fail('card missing: ' + dest + ' - run node scripts/make-og.mjs'); }
  else {
    const cur = readFileSync(dest);
    if (cur.equals(png)) ok('shipped card is byte-identical to what profile.json now produces');
    else {
      fail('DRIFT: the shipped card was generated from an older profile');
      console.log('     shipped : ' + sha(cur));
      console.log('     current : ' + sha(png));
      console.log('     ACTION  : node scripts/make-og.mjs, then republish');
    }
  }
  console.log('text   : ' + name + ' | ' + head + ' | ' + loc + ' | ' + host);
  console.log(bad === 0 ? '\nOG CARD FRESH' : '\nOG CARD BAD=' + bad);
  process.exit(bad === 0 ? 0 : 1);
}

mkdirSync(dirname(dest), { recursive: true });
writeFileSync(dest, png);
console.log('\nwrote ' + dest);
console.log('bytes  : ' + png.length);
console.log('sha256 : ' + sha(png));
console.log('text   : ' + name + ' | ' + head + ' | ' + loc + ' | ' + host);
console.log('OG CARD OK');
