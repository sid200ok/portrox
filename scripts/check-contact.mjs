/**
 * Contact consistency across the live site, README and SECURITY.md.
 *
 * WHY: the portfolio advertised stjl093@gmail.com while README and SECURITY.md
 * advertised sid200ok@duck.com. A visitor and a security researcher would email
 * different addresses, and if the disclosure address is unmonitored, vulnerability
 * reports go nowhere. check-profile.mjs only validated the GitHub link, so this
 * passed silently. The resume also carried two different LinkedIn slugs.
 *
 * Canonical defaults match the resume, README and SECURITY.md, and the GitHub
 * handle. Override either if you prefer the alternatives.
 *
 *   node scripts/check-contact.mjs                 # report
 *   node scripts/check-contact.mjs --fix           # align site + docs
 *   node scripts/check-contact.mjs --fix --email you@example.com --linkedin other-slug
 * After --fix, republish so the live site matches: bash scripts/release.sh "..."
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
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

for (const f of ['README.md', 'SECURITY.md', 'CREDITS.md']) {
  if (existsSync(f) === false) continue;
  const s = readFileSync(f, 'utf8');
  const emails = [...new Set((s.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [])
    .filter(e => !/example\.(com|invalid|org|net)$/.test(e) && !/noreply/.test(e)))];
  const foreign = emails.filter(e => e !== EMAIL);
  foreign.length === 0 ? ok(f + ' emails consistent (' + (emails.join(', ') || 'none') + ')')
    : fail(f + ' mentions other address(es): ' + foreign.join(', '));
  const slugs = [...new Set((s.match(/linkedin\.com\/in\/[A-Za-z0-9_-]+/g) || []))];
  const wrongSlug = slugs.filter(x => x.replace(/\/$/, '') !== ('linkedin.com/in/' + LINKEDIN));
  wrongSlug.length === 0 ? ok(f + ' LinkedIn consistent')
    : fail(f + ' other LinkedIn slug(s): ' + wrongSlug.join(', '));
}

if (bad === 0) console.log('CONTACT OK');
else console.log('CONTACT BAD=' + bad + (FIX ? '' : '  (run with --fix, then republish)'));
process.exit(bad === 0 ? 0 : 1);
