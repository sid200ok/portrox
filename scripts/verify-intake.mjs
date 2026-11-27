/**
 * The intake ceilings are proven, and none of them trusts a client header.
 *
 *   node scripts/verify-intake.mjs
 *
 * All fixtures are placed by the Management API, so this gate consumes ZERO
 * anonymous intake. Every ceiling counts LIVE rows, so removing the fixture
 * restores the limiter exactly.
 *
 *   per email  5/hour   -> rate_limited
 *   per site  40/hour   -> site_busy
 *   per site 200/24h    -> site_busy
 *
 * CORRECTION: sweep() issued three separate DELETEs on four occasions - twelve
 * admin queries in seconds - with no retry. One transient failure turned a green
 * suite red while the final sweep succeeded and residue was zero. Now: ONE
 * idempotent DELETE with an IN list, retried with backoff on transient errors,
 * and the failure text carries whatever status the transport exposed.
 * INSERTs are never blindly retried (that could double-place a fixture); on
 * failure they sweep first, then retry once, which is idempotent.
 */
import { readFileSync, existsSync } from 'node:fs';
import { loadConfig, accessToken } from '../packages/cli/config-store.mjs';
import * as M from '../packages/cli/supabase-mgmt.mjs';

const ID = 'sid200ok.github.io';
const c = loadConfig();
const ref = c.supabase.default_project_ref;
if (!ref || !c.supabase.access_token) { console.log('NOTE no project/token - skipping'); process.exit(0); }
const T = () => accessToken();
const raw = (sql, ro) => M.runQuery(T(), ref, sql, ro ? { read_only: true } : undefined);
const lit = s => { const v = String(s); if (v.includes('$px$')) throw new Error('quote tag in payload'); return '$px$' + v + '$px$'; };

let bad = 0;
const ok = m => console.log('OK   ' + m);
const fail = m => { bad++; console.log('FAIL ' + m); };
const note = m => console.log('NOTE ' + m);
const detail = e => [e && e.message, e && e.status && 'HTTP ' + e.status, e && e.code].filter(Boolean).join(' | ');
const TRANSIENT = /failed to run sql query|fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|network|timeout|429|50[234]/i;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Retry ONLY idempotent statements: SELECT and the marker DELETE. */
async function q(sql, ro, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await raw(sql, ro); }
    catch (e) {
      last = e;
      if (!TRANSIENT.test(detail(e)) || i === tries - 1) throw e;
      note('transient admin-API failure (' + detail(e) + ') - retry ' + (i + 1) + '/' + (tries - 1));
      await sleep(400 * Math.pow(2, i));
    }
  }
  throw last;
}

let url = '', key = '';
const dep = 'dist/' + ID + '/assets/site-config.js';
if (existsSync(dep)) {
  const m = readFileSync(dep, 'utf8').match(/window\.PORTROX\s*=\s*(\{.*\});?/s);
  if (m) { try { const j = JSON.parse(m[1]); url = j.url || ''; key = j.key || ''; } catch {} }
}
if (!url || !key) {
  const cfg = JSON.parse(readFileSync('sites/' + ID + '/site.json', 'utf8'));
  url = (cfg.supabase && cfg.supabase.url) || ''; key = (cfg.supabase && cfg.supabase.publishable_key) || '';
}
if (!url || !key) { console.log('FAIL precondition: site not wired'); process.exit(1); }

const submit = async (email, xff) => {
  const r = await fetch(url + '/rest/v1/rpc/portrox_submit', {
    method: 'POST',
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'X-Forwarded-For': xff },
    body: JSON.stringify({ p_site: ID, p_kind: 'contact', p_full_name: 'Probe', p_email: email, p_message: 'intake ceiling probe', p_slot: null, p_honeypot: null })
  });
  let j = null; try { j = await r.json(); } catch {}
  return j || {};
};
const count = async () => Number((await q('select count(*)::int as n from public.submissions', true))[0].n);
const base = await count();
console.log('baseline submissions: ' + base);

const MARKERS = ['intake email cap probe', 'intake site cap probe', 'intake day cap probe'];
const IN = MARKERS.map(lit).join(', ');
const sweep = async () => {
  try { await q('delete from public.submissions where site_id = ' + lit(ID) + ' and message in (' + IN + ')'); }
  catch (e) { fail('sweep: ' + detail(e)); }
};
/** Fixtures are not blindly retried; sweep first so a retry starts clean. */
const place = async sql => {
  try { return await raw(sql); }
  catch (e) {
    note('fixture insert failed (' + detail(e) + ') - sweeping, then retrying once');
    await sweep();
    return await raw(sql);
  }
};

try {
  console.log('\n-- the limiter no longer trusts a client header --');
  const body = (await q("select prosrc from pg_proc where proname = 'portrox_submit'", true))[0].prosrc;
  /ip\s*=\s*v_ip/.test(body)
    ? fail('the limiter still compares ip = v_ip, which the caller controls')
    : ok('no ceiling depends on the stored IP');
  for (const marker of ['v_email_recent', 'v_site_hour', 'v_site_day', 'site_busy']) {
    body.includes(marker) ? ok('live body contains ' + marker) : fail('live body MISSING ' + marker + ' - migration not applied');
  }
  if (bad) throw new Error('enforcement not live');

  await sweep();

  console.log('\n-- ceiling 1: five per email per hour --');
  await place("insert into public.submissions (site_id, kind, full_name, email, message) select "
    + lit(ID) + ", 'contact', 'Probe', 'probe@example.invalid', 'intake email cap probe' from generate_series(1,5)");
  ok('5 live rows placed for one email (admin, no intake)');
  let j = await submit('probe@example.invalid', '203.0.113.7');
  j.error === 'rate_limited' ? ok('sixth from that email refused (rate_limited)') : fail('expected rate_limited, got ' + JSON.stringify(j).slice(0, 140));
  j = await submit('probe@example.invalid', '198.51.100.9');
  j.error === 'rate_limited' ? ok('a different forged IP does NOT reset the email ceiling') : fail('forged IP escaped the email ceiling: ' + JSON.stringify(j).slice(0, 140));
  await sweep();

  console.log('\n-- ceiling 2: forty per site per hour --');
  await place("insert into public.submissions (site_id, kind, full_name, email, message) select "
    + lit(ID) + ", 'contact', 'Probe', 'probe-h-' || g || '@example.invalid', 'intake site cap probe' from generate_series(1,40) g");
  ok('40 live rows placed with DISTINCT emails (admin, no intake)');
  for (const xff of ['203.0.113.7', '198.51.100.9', '203.0.113.7, 198.51.100.9']) {
    j = await submit('probe-fresh-h@example.invalid', xff);
    j.error === 'site_busy'
      ? ok('rotated email + forged "' + xff + '" refused (site_busy)')
      : fail('hour ceiling escaped with "' + xff + '": ' + JSON.stringify(j).slice(0, 140));
  }
  await sweep();

  console.log('\n-- ceiling 3: two hundred per site per day --');
  await place("insert into public.submissions (site_id, kind, full_name, email, message, created_at) select "
    + lit(ID) + ", 'contact', 'Probe', 'probe-d-' || g || '@example.invalid', 'intake day cap probe', now() - interval '2 hours' from generate_series(1,200) g");
  ok('200 rows placed 2 hours ago: outside the hour window, inside the day window');
  j = await submit('probe-fresh-d@example.invalid', '203.0.113.7');
  j.error === 'site_busy' ? ok('day ceiling refused (site_busy)') : fail('expected site_busy from the day ceiling, got ' + JSON.stringify(j).slice(0, 140));
  await sweep();
} catch (e) {
  fail('gate error: ' + detail(e));
} finally {
  await sweep();
  try {
    const after = await count();
    after === base ? ok('zero residue: submissions=' + after) : fail('residue: ' + base + ' -> ' + after);
  } catch (e) { fail('final count: ' + detail(e)); }
}

console.log(bad === 0 ? '\nINTAKE OK' : '\nINTAKE BAD=' + bad);
process.exit(bad === 0 ? 0 : 1);
