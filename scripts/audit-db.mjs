/**
 * Database audit.
 *
 * 1. TABLE privileges from pg_class + has_table_privilege. information_schema
 *    .role_table_grants is role-filtered and returned ZERO rows while printing
 *    OK. A check that examines nothing must FAIL. anon must have NO write grant
 *    anywhere: intake is a SECURITY DEFINER RPC. This found anon INSERT on
 *    contact_messages and legacy_projects, a real open spam path.
 * 2. RLS enabled on anything anon/authenticated can touch.
 * 3. A FUTURE booking, proven rather than assumed.
 *
 * Probe design fixed: the slot used to be deterministic (now+7d 10:00 UTC) and
 * cleanup ran only afterwards, so a leftover appointment produced slot_taken.
 * slot_taken is CORRECT double-booking protection. Now: clean first, randomise
 * the slot, retry on collision, and delete by the RETURNED IDs.
 * Counting fixed: it asserted total appointments == 0, which would fail forever
 * once a real customer books. Only probe rows are counted now.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, accessToken, publicSupabaseFor } from '../packages/cli/config-store.mjs';
import * as M from '../packages/cli/supabase-mgmt.mjs';
const PX_AV = await import('../packages/core/availability.mjs');
const PX_RULES = PX_AV.loadRules('sid200ok.github.io');

const c = loadConfig();
const ref = c.supabase.default_project_ref;
if (!ref || !c.supabase.access_token) { console.log('NOTE no project/token - skipping'); process.exit(0); }
const T = () => accessToken();
const pub = publicSupabaseFor(ref);
const siteId = 'sid200ok.github.io';
let bad = 0;
const ok = m => console.log('OK   ' + m);
const fail = m => { bad++; console.log('FAIL ' + m); };
const note = m => console.log('NOTE ' + m);
const rows = r => Array.isArray(r) ? r : [];
const run = (sql, ro) => M.runQuery(T(), ref, sql, ro ? { read_only: true } : undefined);
const PROBE_EMAIL = 'probe@example.invalid';

const PRIV_SQL = "select c.relname as table_name, c.relrowsecurity as rls,"
  + " has_table_privilege('anon',c.oid,'SELECT') as a_sel,"
  + " has_table_privilege('anon',c.oid,'INSERT') as a_ins,"
  + " has_table_privilege('anon',c.oid,'UPDATE') as a_upd,"
  + " has_table_privilege('anon',c.oid,'DELETE') as a_del,"
  + " has_table_privilege('authenticated',c.oid,'SELECT') as u_sel,"
  + " has_table_privilege('authenticated',c.oid,'INSERT') as u_ins,"
  + " has_table_privilege('authenticated',c.oid,'UPDATE') as u_upd,"
  + " has_table_privilege('authenticated',c.oid,'DELETE') as u_del"
  + " from pg_class c join pg_namespace n on n.oid=c.relnamespace"
  + " where n.nspname='public' and c.relkind='r' order by 1";

console.log('-- table privileges --');
try {
  const list = rows(await run(PRIV_SQL, true));
  if (list.length === 0) fail('privilege audit examined ZERO tables - refusing to pass');
  for (const r of list) {
    const anonWrite = r.a_ins || r.a_upd || r.a_del;
    const authWrite = r.u_ins || r.u_upd || r.u_del;
    if (anonWrite) fail('anon has WRITE on ' + r.table_name + ' - intake must use the definer RPC only');
    if ((authWrite || r.a_sel || r.u_sel) && !r.rls) fail(r.table_name + ' is accessible with RLS DISABLED');
    const flags = [r.a_sel && 'anon:SELECT', r.a_ins && 'anon:INSERT', r.a_upd && 'anon:UPDATE', r.a_del && 'anon:DELETE',
      r.u_sel && 'auth:SELECT', r.u_ins && 'auth:INSERT', r.u_upd && 'auth:UPDATE', r.u_del && 'auth:DELETE'].filter(Boolean).join(' ');
    console.log('     ' + r.table_name.padEnd(20) + 'rls=' + (r.rls ? 'on ' : 'OFF') + '  ' + (flags || '(no grants)'));
  }
  if (list.length) ok(list.length + ' tables examined');
} catch (e) { fail('cannot read privileges: ' + e.message); }

console.log('\n-- availability --');
const avPath = join(process.cwd(), 'sites', siteId, 'data', 'availability.json');
const av = existsSync(avPath) ? JSON.parse(readFileSync(avPath, 'utf8')) : null;
console.log('     file rules: ' + (av && Array.isArray(av.weekly) ? av.weekly.length : 0) + ' | ' + (av && av.timezone) + ' | ' + (av && av.duration_minutes) + ' min');

// Clean BEFORE probing: remove probe submissions (appointments cascade) and any
// appointment whose submission is gone. Real bookings are never touched.
async function cleanProbes() {
  await run("delete from public.appointments a where a.submission_id is null or not exists (select 1 from public.submissions s where s.id = a.submission_id);");
  await run("delete from public.submissions where email ilike '" + PROBE_EMAIL + "';");
}
console.log('\n-- pre-probe cleanup --');
try { await cleanProbes(); ok('probe rows and orphans cleared'); }
catch (e) { fail('pre-probe cleanup: ' + String(e.message).split('\n')[0].slice(0, 180)); }

console.log('\n-- FUTURE booking probe --');
let apptId = null, subId = null, booked = false;
for (let attempt = 1; attempt <= 3 && booked === false; attempt++) {
  const days = 30 + Math.floor(Math.random() * 240);
  const hour = 8 + Math.floor(Math.random() * 8);
  const start = new Date(PX_AV.snapSlot(Date.now() + days * 86400000, PX_RULES));
  try {
    const r = await fetch(pub.url + '/rest/v1/rpc/portrox_book', {
      method: 'POST',
      headers: { apikey: pub.publishable_key, Authorization: 'Bearer ' + pub.publishable_key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_site: siteId, p_full_name: 'Probe', p_email: PROBE_EMAIL,
        p_message: 'future slot probe', p_starts_at: start.toISOString(), p_minutes: (av && av.duration_minutes) || 30
      })
    });
    const txt = await r.text();
    let j = null; try { j = JSON.parse(txt); } catch {}
    console.log('     attempt ' + attempt + ' (' + start.toISOString() + ') HTTP ' + r.status + ' ' + txt.slice(0, 160));
    if (r.status === 200 && j && j.ok === true) {
      booked = true; apptId = j.appointment_id || null; subId = j.submission_id || null;
      ok('future slot ACCEPTED - booking is usable');
    } else if (j && j.error === 'slot_taken') {
      note('slot already booked - retrying with a different slot');
    } else {
      fail('future slot REFUSED' + (j && j.error ? ': ' + j.error : ' (HTTP ' + r.status + ')'));
      break;
    }
  } catch (e) { fail('booking probe threw: ' + e.message); break; }
}
if (booked === false && bad === 0) fail('no future slot could be booked in 3 attempts');

console.log('\n-- post-probe cleanup (by returned IDs) --');
try {
  if (apptId) await run("delete from public.appointments where id = '" + apptId + "';");
  if (subId) await run("delete from public.submissions where id = '" + subId + "';");
  await cleanProbes();
  const leftSub = rows(await run("select count(*)::text as n from public.submissions where email ilike '" + PROBE_EMAIL + "'", true));
  const orphan = rows(await run("select count(*)::text as n from public.appointments a where a.submission_id is null or not exists (select 1 from public.submissions s where s.id = a.submission_id)", true));
  const total = rows(await run('select count(*)::text as n from public.appointments', true));
  const ns = (leftSub[0] && leftSub[0].n) || '0';
  const no = (orphan[0] && orphan[0].n) || '0';
  console.log('     probe submissions: ' + ns + ' | orphan appointments: ' + no + ' | total appointments (real bookings kept): ' + ((total[0] && total[0].n) || '0'));
  if (ns !== '0') fail(ns + ' probe submission(s) remain');
  if (no !== '0') fail(no + ' orphan appointment(s) remain - a deleted lead is blocking a slot');
  if (ns === '0' && no === '0') ok('probe rows removed, real bookings untouched');
} catch (e) { fail('post-probe cleanup: ' + String(e.message).split('\n')[0].slice(0, 180)); }

console.log('\n' + (bad === 0 ? 'DB AUDIT OK' : 'DB AUDIT BAD=' + bad));
process.exit(bad === 0 ? 0 : 1);
