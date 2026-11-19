/**
 * Proves the content store round-trips BEFORE any UI depends on it.
 *
 * Corrections vs the first version:
 *  - [...j] on an array is a shallow copy with IDENTICAL contents, so the
 *    "modification" produced the same bytes and three files falsely failed.
 *    Array mutation now APPENDS a probe entry.
 *  - site.json is merge-only. The old test sent the full document, which the
 *    old validator blanket-rejected. The contract is now "protected fields
 *    must not CHANGE", so a full-document save with unchanged identity is
 *    accepted, and that path is explicitly tested here.
 *
 * Net effect on your content: NONE. Every file is restored byte-identical.
 */
import * as CS from '../packages/cli/content-store.mjs';

const REPO = process.cwd();
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

const files = CS.listContent(REPO, site);
console.log('site ' + site + ' | ' + files.length + ' editable files');

function mutate(file, kind, orig) {
  if (kind === 'markdown') return orig + '\n\n<!-- portrox round-trip probe -->\n';
  const j = JSON.parse(orig);
  if (file === 'site.json') {
    // Full document, protected fields UNCHANGED, one mutable field changed.
    const d = JSON.parse(orig);
    d.seo = { ...(d.seo || {}), description: ((d.seo && d.seo.description) || 'portfolio') + ' (probe)' };
    return JSON.stringify(d, null, 2) + '\n';
  }
  if (Array.isArray(j)) return JSON.stringify([...j, { _px_probe: 1 }], null, 2) + '\n';
  return JSON.stringify({ ...j, _px_probe: 1 }, null, 2) + '\n';
}

for (const f of files) {
  if (!f.exists) { fail(f.file + ' missing'); continue; }
  const orig = CS.readContent(REPO, site, f.file).text;
  try {
    CS.writeContent(REPO, site, f.file, orig);
    CS.readContent(REPO, site, f.file).text === orig
      ? ok(f.file + ' identity round trip') : fail(f.file + ' identity round trip CHANGED bytes');

    const mod = mutate(f.file, f.kind, orig);
    if (mod === orig) { fail(f.file + ' test bug: mutation produced identical bytes'); }
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
mustThrow(() => CS.writeContent(REPO, site, 'site.json', JSON.stringify({ ...full, database: { mode: 'shared', project_ref: 'evil' } })), /not editable/, 'changed database');
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

console.log('\n' + (bad === 0 ? 'CONTENT API OK' : 'CONTENT API BAD=' + bad));
process.exit(bad === 0 ? 0 : 1);
