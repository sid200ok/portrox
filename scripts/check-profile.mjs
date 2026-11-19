/**
 * The canonical GitHub handle is settled by evidence: gh whoami, the repo, and
 * the live URL all say sid200ok. A resume that mentions a different handle is a
 * CONTENT bug, not an open decision. verify-live only checks that some mailto
 * exists, so a wrong GitHub link would pass. This asserts the real thing.
 *   node scripts/check-profile.mjs [--fix]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import * as GH from '../packages/cli/github-ops.mjs';

const FIX = process.argv.includes('--fix');
const st = await GH.authStatus();
if (st.connected === false) { console.log('NOTE GitHub not connected - skipping'); process.exit(0); }
const login = st.login;
console.log('authenticated handle: ' + login);
let bad = 0;
for (const id of readdirSync('sites')) {
  const p = join('sites', id, 'data', 'profile.json');
  if (existsSync(p) === false) continue;
  const prof = JSON.parse(readFileSync(p, 'utf8'));
  const links = prof.links || {};
  const gh = String(links.github || '');
  const want = 'https://github.com/' + login;
  if (gh === want) { console.log('OK   ' + id + ' links.github = ' + gh); continue; }
  if (!gh) { console.log('FAIL ' + id + ' links.github missing'); bad++; }
  else { console.log('FAIL ' + id + ' links.github = ' + gh + ' (expected ' + want + ')'); bad++; }
  if (FIX) {
    prof.links = { ...links, github: want };
    writeFileSync(p, JSON.stringify(prof, null, 2) + '\n');
    console.log('     FIXED -> ' + want);
    console.log('     REPUBLISH REQUIRED: node scripts/publish-site.mjs ' + id);
    bad--;
  }
}
if (bad === 0) console.log('PROFILE OK');
else console.log('PROFILE BAD=' + bad + ' (re-run with --fix, then republish)');
process.exit(bad === 0 ? 0 : 1);
