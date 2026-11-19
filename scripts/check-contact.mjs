/**
 * Contact consistency across every site profile and EVERY markdown document.
 *
 * WHY: the portfolio advertised stjl093@gmail.com while README and SECURITY.md
 * advertised sid200ok@duck.com, so a visitor and a security researcher would
 * email different addresses and disclosure reports could go unmonitored. The
 * resume also carried two LinkedIn slugs.
 *
 * FIX vs previous version: the document list was hand-written
 * (README, SECURITY, CREDITS). When the bio moved into AUTHOR.md, the file that
 * actually holds the email, LinkedIn and phone became UNGATED. The list is now
 * DERIVED from the markdown files present, so any new doc is covered
 * automatically. Same lesson as MIRROR_MAP: no duplicated enumeration.
 *
 *   node scripts/check-contact.mjs                 # report
 *   node scripts/check-contact.mjs --fix           # align site profiles
 *   node scripts/check-contact.mjs --fix --email you@example.com --linkedin slug
 * Docs are reported, never auto-rewritten: prose is yours to edit.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const FIX = process.argv.includes('--fix');
const EMAIL = arg('email', 'sid200ok@duck.com');
const LINKEDIN = arg('linkedin', 'sid200ok');
const GITHUB = arg('github', 'sid200ok');
const LI_URL = 'https://www.linkedin.com/in/' + LINKEDIN + '/';
const GH_URL = 'https://github.com/' + GITHUB;

let bad = 0;
const ok = m => console.log('OK   ' + m);
const fail = m => { bad++; console.log('FAIL ' + m); };
console.log('canonical: ' + EMAIL + ' | ' + LI_URL + ' | ' + GH_URL);

for (const id of readdirSync('sites')) {
  const p = join('sites', id, 'data', 'profile.json');
  if (existsSync(p) === false) continue;
  const prof = JSON.parse(readFileSync(p, 'utf8'));
  const links = prof.links || {};
  let changed = false;
  const checks = [
    ['profile.email', prof.email, EMAIL, v => { prof.email = v; }],
    ['links.email', links.email, EMAIL, v => { links.email = v; }],
    ['links.linkedin', links.linkedin, LI_URL, v => { links.linkedin = v; }],
    ['links.github', links.github, GH_URL, v => { links.github = v; }]
  ];
  for (const [label, cur, want, set] of checks) {
    if (cur === undefined && label === 'links.email') continue;
    if (String(cur || '') === want) { ok(id + ' ' + label); continue; }
    fail(id + ' ' + label + ' = ' + (cur || '(unset)') + ' (expected ' + want + ')');
    if (FIX) { set(want); changed = true; console.log('     FIXED'); bad--; }
  }
  if (changed) { prof.links = links; writeFileSync(p, JSON.stringify(prof, null, 2) + '\n'); }
}

// DERIVED, not enumerated. Top-level markdown plus docs/.
const docs = [];
for (const f of readdirSync('.').sort()) {
  if (f.endsWith('.md') && statSync(f).isFile()) docs.push(f);
}
if (existsSync('docs')) {
  for (const f of readdirSync('docs').sort()) if (f.endsWith('.md')) docs.push(join('docs', f));
}
console.log('scanning ' + docs.length + ' document(s): ' + docs.join(', '));
for (const f of docs) {
  const s = readFileSync(f, 'utf8');
  const emails = [...new Set((s.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [])
    .filter(e => !/example\.(com|invalid|org|net)$/.test(e) && !/noreply/.test(e)))];
  const foreign = emails.filter(e => e !== EMAIL);
  foreign.length === 0 ? ok(f + ' emails (' + (emails.join(', ') || 'none') + ')')
    : fail(f + ' other address(es): ' + foreign.join(', '));
  const slugs = [...new Set((s.match(/linkedin\.com\/in\/[A-Za-z0-9_-]+/g) || []))];
  const wrong = slugs.filter(x => x.replace(/\/$/, '') !== ('linkedin.com/in/' + LINKEDIN));
  wrong.length === 0 ? ok(f + ' LinkedIn') : fail(f + ' other LinkedIn slug(s): ' + wrong.join(', '));
  const handles = [...new Set((s.match(/github\.com\/[A-Za-z0-9_-]+/g) || [])
    .map(x => x.replace('github.com/', ''))
    .filter(h => !['sponsors', 'topics', 'features', 'about', 'pricing', 'enterprise'].includes(h)))];
  const wrongGh = handles.filter(h => h !== GITHUB && !/^(gitleaks|pre-commit|pre-commit-hooks|supabase)$/.test(h));
  wrongGh.length === 0 ? ok(f + ' GitHub handle') : fail(f + ' other GitHub handle(s): ' + wrongGh.join(', '));
}

if (bad === 0) console.log('CONTACT OK');
else console.log('CONTACT BAD=' + bad + (FIX ? '' : '  (run --fix for profiles; edit docs by hand)'));
process.exit(bad === 0 ? 0 : 1);
