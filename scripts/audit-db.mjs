/**
 * Two things no gate has ever checked:
 *  1. TABLE-level privileges for anon/authenticated. The hardening migration
 *     covered definer FUNCTIONS only; legacy sample migrations contained
 *     GRANT ALL TO anon on contact_messages and that was never reviewed.
 *  2. A FUTURE booking. verify-rpc only ever tested a PAST slot, which returns
 *     past_slot whether or not availability exists. availability.json has 3
 *     weekly rules but the availability TABLE has 0 rows, so booking may be
 *     silently impossible.
 * The probe appointment is deleted afterwards. Read-only otherwise.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, accessToken, publicSupabaseFor } from '../packages/cli/config-store.mjs';
import * as M from '../packages/cli/supabase-mgmt.mjs';

const c = loadConfig();
const ref = c.supabase.default_project_ref;
if (!ref || !c.supabase.access_token) { console.log('NOTE no project/token - skipping'); process.exit(0); }
const T = () => accessToken();
const pub = publicSupabaseFor(ref);
let bad = 0;
const ok = m => console.log('OK   ' + m);
const fail = m => { bad++; console.log('FAIL ' + m); };
const note = m => console.log('NOTE ' + m);

console.log('-- anon / authenticated TABLE privileges --');
const PRIV_SQL = "select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privs from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated') group by table_name, grantee order by table_name, grantee";
try {
  const rows = await M.runQuery(T(), ref, PRIV_SQL, { read_only: true });
  const WRITE = /(INSERT|UPDATE|DELETE|TRUNCATE)/;
  for (const r of (Array.isArray(rows) ? rows : [])) {
    const risky = WRITE.test(String(r.privs || ''));
    const intended = (r.table_name === 'submissions' || r.table_name === 'appointments') && r.grantee === 'authenticated';
    if (risky && !intended) fail('WRITE grant: ' + r.grantee + ' on ' + r.table_name + ' -> ' + r.privs);
    else console.log('     ' + r.grantee.padEnd(14) + r.table_name.padEnd(20) + r.privs);
  }
  ok('privilege enumeration complete');
} catch (e) { fail('cannot read privileges: ' + e.message); }

console.log('\n-- availability: file vs table --');
const avPath = join(process.cwd(), 'sites', 'sid200ok.github.io', 'data', 'availability.json');
const av = existsSync(avPath) ? JSON.parse(readFileSync(avPath, 'utf8')) : null;
console.log('     file rules: ' + (av && Array.isArray(av.weekly) ? av.weekly.length : 0) + ' | timezone ' + (av && av.timezone) + ' | ' + (av && av.duration_minutes) + ' min');
try {
  const r = await M.runQuery(T(), ref, "select count(*)::text as n from public.availability", { read_only: true });
  const n = (Array.isArray(r) && r[0] && r[0].n) || '0';
  console.log('     table rows: ' + n);
  if (n === '0') note('availability table is empty - the RPC may reject every future slot');
} catch (e) { note('cannot count availability: ' + e.message); }

console.log('\n-- FUTURE booking probe --');
const siteId = 'sid200ok.github.io';
const start = new Date(Date.now() + 7 * 86400000);
start.setUTCHours(10, 0, 0, 0);
const body = {
  p_site: siteId, p_full_name: 'Probe', p_email: 'probe@example.invalid',
  p_message: 'future slot probe', p_starts_at: start.toISOString(), p_minutes: (av && av.duration_minutes) || 30
};
let created = null;
try {
  const r = await fetch(pub.url + '/rest/v1/rpc/portrox_book', {
    method: 'POST',
    headers: { apikey: pub.publishable_key, Authorization: 'Bearer ' + pub.publishable_key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const txt = await r.text();
  console.log('     HTTP ' + r.status + ' ' + txt.slice(0, 220));
  let j = null; try { j = JSON.parse(txt); } catch {}
  if (r.status === 200 && j && (j.ok === true || j.id)) { ok('future slot ACCEPTED'); created = j.id || null; }
  else if (j && j.error) { fail('future slot REFUSED: ' + j.error + ' - booking is not usable'); }
  else fail('future slot response unrecognised (HTTP ' + r.status + ')');
} catch (e) { fail('booking probe threw: ' + e.message); }

console.log('\n-- probe cleanup --');
try {
  const del = "delete from public.appointments where email ilike '%@example.invalid' or full_name ilike 'probe';"
            + " delete from public.submissions where email ilike '%@example.invalid' and (full_name ilike 'probe' or message ilike '%probe%');";
  await M.runQuery(T(), ref, del);
  const r2 = await M.runQuery(T(), ref, "select count(*)::text as n from public.appointments where email ilike '%@example.invalid'", { read_only: true });
  const left = (Array.isArray(r2) && r2[0] && r2[0].n) || '0';
  left === '0' ? ok('probe appointments removed') : fail(left + ' probe appointment(s) remain');
} catch (e) { note('cleanup: ' + e.message); }

console.log('\n' + (bad === 0 ? 'DB AUDIT OK' : 'DB AUDIT BAD=' + bad));
process.exit(bad === 0 ? 0 : 1);
