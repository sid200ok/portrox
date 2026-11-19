/**
 * Proves the content store round-trips BEFORE any UI depends on it.
 *
 * ISOLATION (corrected): the previous version wrote to the LIVE site 40 times
 * per release. Between "modification applied" and "restored" a probe entry
 * really was in experience.json, so a concurrent build could ship it.
 * restore-db.mjs already used a scratch schema; this now uses a scratch COPY
 * of the site and additionally proves the real files are byte-identical
 * before and after. Zero production writes.
 *
 * Also covers: canonical protected-field comparison (key order is not a
 * change), the site.json accept/refuse contract, and nine refusals.
 */
import { mkdtempSync, mkdirSync, cpSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import * as CS from '../packages/cli/content-store.mjs';

const REAL = process.cwd();
const site = process.argv[2] || 'sid200ok.github.io';
let bad = 0;
const ok = m => console.log('OK   ' + m);
const fail = m => { bad++; console.log('FAIL ' + m); };
const mustThrow = (fn, re, label) => {
  try { fn(); fail(label + ' did NOT refuse'); }
  catch (e) { re.test(e.message) ? ok(label + ' refused') : fail(label + ' wrong error: ' + e.message); }
};
const mustNotThrow = (fn, label) => {
  try { fn(); ok(label); } catch (e) { fail(label + ' threw: ' + e.message); }
};
const sha = p => existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex') : 'absent';

const realFiles = Object.keys(CS.EDITABLE).map(f => join(REAL, 'sites', site, f));
const before = realFiles.map(sha);

const box = mkdtempSync(join(tmpdir(), 'portrox-content-'));
const REPO = box;
mkdirSync(join(box, 'sites'), { recursive: true });
cpSync(join(REAL, 'sites', site), join(box, 'sites', site), {
  recursive: true,
  filter: src => src.includes('.content-history') === false
});
console.log('site ' + site + ' | scratch copy at ' + box + ' (production untouched)');

function mutate(file, kind, orig) {
  if (kind === 'markdown') return orig + '\n\n<!-- portrox round-trip probe -->\n';
  const j = JSON.parse(orig);
  if (file === 'site.json') {
    const d = JSON.parse(orig);
    d.seo = { ...(d.seo || {}), description: ((d.seo && d.seo.description) || 'portfolio') + ' (probe)' };
    return JSON.stringify(d, null, 2) + '\n';
  }
  if (Array.isArray(j)) return JSON.stringify([...j, { _px_probe: 1 }], null, 2) + '\n';
  return JSON.stringify({ ...j, _px_probe: 1 }, null, 2) + '\n';
}

try {
  const files = CS.listContent(REPO, site);
  console.log(files.length + ' editable files');
  for (const f of files) {
    if (!f.exists) { fail(f.file + ' missing'); continue; }
    const orig = CS.readContent(REPO, site, f.file).text;
    try {
      CS.writeContent(REPO, site, f.file, orig);
      CS.readContent(REPO, site, f.file).text === orig
        ? ok(f.file + ' identity round trip') : fail(f.file + ' identity CHANGED bytes');
      const mod = mutate(f.file, f.kind, orig);
      if (mod === orig) fail(f.file + ' test bug: mutation produced identical bytes');
      else {
        CS.writeContent(REPO, site, f.file, mod);
        CS.readContent(REPO, site, f.file).text !== orig
          ? ok(f.file + ' modification applied') : fail(f.file + ' modification did NOT apply');
      }
    } catch (e) { fail(f.file + ' round trip threw: ' + e.message); }
    finally {
      try {
        CS.writeContent(REPO, site, f.file, orig);
        CS.readContent(REPO, site, f.file).text === orig
          ? ok(f.file + ' restored byte-identical') : fail(f.file + ' NOT restored');
      } catch (e) { fail(f.file + ' restore failed: ' + e.message); }
    }
  }

  console.log('\n-- site.json contract --');
  const siteOrig = CS.readContent(REPO, site, 'site.json').text;
  const full = JSON.parse(siteOrig);
  mustNotThrow(() => CS.writeContent(REPO, site, 'site.json', siteOrig), 'full document, nothing changed');
  mustNotThrow(() => CS.writeContent(REPO, site, 'site.json', JSON.stringify({ seo: full.seo }, null, 2)), 'partial document, mutable only');
  const d = full.database || {}; const rev = {};
  Object.keys(d).reverse().forEach(k => { rev[k] = d[k]; });
  mustNotThrow(() => CS.writeContent(REPO, site, 'site.json', JSON.stringify({ ...full, database: rev }, null, 2)), 'protected field with reordered keys (not a change)');
  mustThrow(() => CS.writeContent(REPO, site, 'site.json', JSON.stringify({ ...full, database: { ...d, project_ref: 'evil' } })), /not editable/, 'changed database');
  mustThrow(() => CS.writeContent(REPO, site, 'site.json', JSON.stringify({ ...full, published: false })), /not editable/, 'changed published');
  mustThrow(() => CS.writeContent(REPO, site, 'site.json', JSON.stringify({ ...full, id: 'other' })), /not editable/, 'changed id');
  mustThrow(() => CS.writeContent(REPO, site, 'site.json', JSON.stringify({ pages: { ...(full.pages || {}), repo: 'evil/evil' } })), /pages\.repo|only pages\.cname/, 'changed pages.repo');
  try { CS.writeContent(REPO, site, 'site.json', siteOrig); } catch {}
  CS.readContent(REPO, site, 'site.json').text === siteOrig ? ok('site.json restored') : fail('site.json NOT restored');

  console.log('\n-- refusals --');
  mustThrow(() => CS.readContent(REPO, site, '../../package.json'), /editable|escapes/, 'path traversal');
  mustThrow(() => CS.readContent(REPO, site, 'data/secrets.json'), /not an editable file/, 'non-allowlisted file');
  mustThrow(() => CS.writeContent(REPO, site, 'data/profile.json', '{ nope'), /invalid JSON/, 'malformed JSON');
  mustThrow(() => CS.writeContent(REPO, site, 'data/profile.json', '{}'), /full_name/, 'missing required field');
  mustThrow(() => CS.writeContent(REPO, site, 'data/experience.json', '{}'), /array/, 'wrong top-level type');
  mustThrow(() => CS.writeContent(REPO, site, 'data/availability.json', JSON.stringify({ timezone: 'UTC', weekly: [], duration_minutes: 1 })), /duration_minutes/, 'out-of-range duration');
  mustThrow(() => CS.writeContent(REPO, site, 'content/intro.md', 'hi'), /too short/, 'stub markdown');
  mustThrow(() => CS.writeContent(REPO, site, 'content/intro.md', 'hello world from portrox <script>alert(1)</script>'), /script/, 'raw script injection');
  mustThrow(() => CS.writeContent(REPO, site, 'content/intro.md', 'x '.repeat(300000)), /too large/, 'oversize payload');
} finally {
  try { rmSync(box, { recursive: true, force: true }); ok('scratch copy removed'); } catch (e) { fail('cleanup: ' + e.message); }
}

console.log('\n-- production integrity --');
const after = realFiles.map(sha);
let touched = 0;
realFiles.forEach((p, i) => { if (before[i] !== after[i]) { touched++; fail('PRODUCTION FILE CHANGED: ' + p); } });
if (touched === 0) ok('all ' + realFiles.length + ' live content files byte-identical (sha256)');

console.log('\n' + (bad === 0 ? 'CONTENT API OK' : 'CONTENT API BAD=' + bad));
process.exit(bad === 0 ? 0 : 1);
