/**
 * Proves upload -> render -> avatar -> delete with ZERO residue, and that the
 * renderer actually SHIPS the file (render into a temp outDir, not real dist).
 * Refusals: SVG, renamed non-image, traversal, oversize, wrong confirm.
 */
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as MD from '../packages/cli/media-store.mjs';

const REPO = process.cwd();
const site = process.argv[2] || 'sid200ok.github.io';
let bad = 0;
const ok = m => console.log('OK   ' + m);
const fail = m => { bad++; console.log('FAIL ' + m); };
const mustThrow = async (fn, re, label) => {
  try { await fn(); fail(label + ' did NOT refuse'); }
  catch (e) { re.test(e.message) ? ok(label + ' refused') : fail(label + ' wrong error: ' + e.message); }
};
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
const NAME = 'px-probe.png';
const profPath = join(REPO, 'sites', site, 'data', 'profile.json');
const profOrig = readFileSync(profPath, 'utf8');
const filePath = join(REPO, 'sites', site, 'assets', NAME);

try {
  const up = await MD.uploadMedia(REPO, site, NAME, PNG, { alt: 'probe pixel' });
  up.bytes > 0 ? ok('uploaded ' + up.name + ' (' + up.bytes + 'B)') : fail('upload reported 0 bytes');
  existsSync(filePath) ? ok('file present in site assets') : fail('file NOT written');

  const list = MD.listMedia(REPO, site);
  list.some(f => f.name === NAME) ? ok('listed') : fail('not listed');
  const db = await MD.dbRows(site);
  db.some(r => r.storage_path === 'assets/media/' + NAME) ? ok('metadata row present') : fail('metadata row missing');

  const out = mkdtempSync(join(tmpdir(), 'px-media-out-'));
  try {
    const { renderSite } = await import(join(REPO, 'packages/core/render.mjs'));
    await renderSite(join(REPO, 'sites', site), out);
    existsSync(join(out, 'assets/media', NAME)) ? ok('renderer SHIPS it to dist/assets/media/') : fail('renderer did NOT copy it');
  } finally { rmSync(out, { recursive: true, force: true }); }

  const av = await MD.setAvatar(REPO, site, NAME);
  av.avatar === NAME ? ok('avatar set') : fail('avatar not set');
  JSON.parse(readFileSync(profPath, 'utf8')).avatar === NAME ? ok('profile.json updated') : fail('profile.json not updated');
} catch (e) { fail('round trip threw: ' + e.message); }

console.log('\n-- refusals --');
await mustThrow(() => MD.uploadMedia(REPO, site, 'x.png', PNG, { kind: 'image' }), /invalid kind/, 'kind not in the DB constraint');
await mustThrow(() => MD.uploadMedia(REPO, site, 'evil.svg', PNG), /SVG|extension/, 'SVG upload');
await mustThrow(() => MD.uploadMedia(REPO, site, 'evil.html', PNG), /extension/, 'HTML upload');
await mustThrow(() => MD.uploadMedia(REPO, site, 'fake.png', Buffer.from('<html>hi</html>').toString('base64')), /magic bytes/, 'renamed non-image');
await mustThrow(() => MD.uploadMedia(REPO, site, '../escape.png', PNG), /filename/, 'traversal filename');
await mustThrow(() => MD.uploadMedia(REPO, site, 'big.png', Buffer.alloc(MD.MAX_BYTES + 10).toString('base64')), /too large|magic/, 'oversize');
await mustThrow(() => MD.deleteMedia(REPO, site, NAME, 'wrong'), /confirmation/, 'delete wrong confirm');

console.log('\n-- cleanup --');
try {
  await MD.deleteMedia(REPO, site, NAME, NAME);
  existsSync(filePath) === false ? ok('file removed') : fail('file STILL present');
  const db2 = await MD.dbRows(site);
  db2.some(r => r.storage_path === 'assets/media/' + NAME) === false ? ok('metadata row removed') : fail('metadata row remains');
} catch (e) { fail('cleanup threw: ' + e.message); }
writeFileSync(profPath, profOrig);
readFileSync(profPath, 'utf8') === profOrig ? ok('profile.json restored byte-identical') : fail('profile.json NOT restored');

console.log('\n' + (bad === 0 ? 'MEDIA OK' : 'MEDIA BAD=' + bad));
process.exit(bad === 0 ? 0 : 1);
