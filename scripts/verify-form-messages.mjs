/**
 * Every refusal the server can send must be a sentence the visitor can act on.
 *
 *   node scripts/verify-form-messages.mjs
 *
 * WHY: availability enforcement added eight codes. forms.js mapped three. The
 * other eight fell through to "Booking failed. Please try later.", telling a
 * visitor to retry a request that can never succeed. No gate noticed, because
 * the existing gates only check that forms.js CALLS the RPC.
 *
 * The code list is read from the LIVE function bodies, not from a list here, so
 * a future migration cannot add an unmapped code silently.
 */
import { readFileSync, existsSync } from 'node:fs';
import { loadConfig, accessToken } from '../packages/cli/config-store.mjs';
import * as M from '../packages/cli/supabase-mgmt.mjs';

const ID = 'sid200ok.github.io';
const c = loadConfig();
const ref = c.supabase.default_project_ref;
if (!ref || !c.supabase.access_token) { console.log('NOTE no project/token - skipping'); process.exit(0); }
const q = (sql) => M.runQuery(accessToken(), ref, sql, { read_only: true });

let bad = 0;
const ok = m => console.log('OK   ' + m);
const fail = m => { bad++; console.log('FAIL ' + m); };
const note = m => console.log('NOTE ' + m);

const src = readFileSync('packages/core/forms.js', 'utf8');
const shipped = 'dist/' + ID + '/assets/forms.js';
if (existsSync(shipped)) {
  readFileSync(shipped).equals(Buffer.from(src))
    ? ok('shipped forms.js is byte-identical to the source')
    : fail('shipped forms.js differs from source - rebuild before publishing');
} else note('no built forms.js yet - run a build');

const codes = new Set();
for (const fn of ['portrox_submit', 'portrox_book', 'portrox_payment_ref']) {
  const rows = await q("select prosrc from pg_proc where proname = '" + fn + "'");
  if (!rows || !rows[0]) { fail('function not found: ' + fn); continue; }
  const body = rows[0].prosrc;
  let n = 0;
  for (const m of body.matchAll(/'error'\s*,\s*'([a-z_]+)'/g)) { codes.add(m[1]); n++; }
  for (const m of body.matchAll(/'error'\s*,\s*case([\s\S]*?)end/g)) {
    for (const k of m[1].matchAll(/'([a-z_]+)'/g)) { codes.add(k[1]); n++; }
  }
  ok(fn + ': ' + n + ' refusal code(s) read from the live body');
}

console.log('\n-- every code has a visitor sentence --');
for (const code of [...codes].sort()) {
  new RegExp('\\b' + code + '\\b').test(src)
    ? ok('mapped: ' + code)
    : fail('UNMAPPED refusal code: ' + code + ' - add it to MSG in packages/core/forms.js');
}

console.log('\n-- fallbacks are honest --');
/Please try later\.'\s*\)\s*,\s*false\)/.test(src) && !/Network error\. Please try later\./.test(src)
  ? fail('a non-network fallback still says "try later"')
  : ok('"try later" is reserved for network errors');
/unmapped refusal code/.test(src) ? ok('unmapped codes are logged for the owner') : fail('unmapped codes are swallowed silently');
/CONTACT_FALLBACK|About page/.test(src) ? ok('inactive-form refusals point somewhere useful') : fail('no alternative route offered');

console.log(bad === 0 ? '\nFORM MESSAGES OK (' + codes.size + ' codes)' : '\nFORM MESSAGES BAD=' + bad);
process.exit(bad === 0 ? 0 : 1);
