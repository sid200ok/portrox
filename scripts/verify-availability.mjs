/**
 * Proves booking is CORRECT, not merely usable.
 *
 *   node scripts/verify-availability.mjs               # full proof (1 intake)
 *   node scripts/verify-availability.mjs --no-intake   # refusals + trigger only
 *
 * CORRECTIONS, each read from source rather than assumed:
 *  1. expectRefusal had no `site` parameter, so the "unknown site" case silently
 *     sent the REAL site id with a VALID slot and was accepted. The label lied.
 *     `site` is now threaded through, and every refusal prints the identity it
 *     actually used.
 *  2. The limiter is NOT a counter table. portrox_submit counts live rows in
 *     public.submissions for (site, email OR ip) in the last hour, limit 5.
 *     portrox_private contains zero tables. Because every gate deletes its
 *     probes, cleanup RESETS the limiter - so the full end-to-end proof is safe
 *     by default. The earlier claim that the suite inherently spends five was
 *     wrong; the five rows were this gate's own un-cleaned residue.
 *  3. Ids are recorded from EVERY response, success or failure, and the gate
 *     aborts on the first unexpected success instead of writing more rows.
 *  4. The live function body is asserted first, so "migration not applied" is
 *     one line instead of fourteen cascading failures.
 */
import { readFileSync, existsSync } from 'node:fs';
import { loadConfig, accessToken } from '../packages/cli/config-store.mjs';
import * as M from '../packages/cli/supabase-mgmt.mjs';
import * as AV from '../packages/core/availability.mjs';

const ID = 'sid200ok.github.io';
const UNKNOWN = 'no-such-site.invalid';
const INTAKE = !process.argv.includes('--no-intake');
const c = loadConfig();
const ref = c.supabase.default_project_ref;
if (!ref || !c.supabase.access_token) { console.log('NOTE no project/token - skipping'); process.exit(0); }
const T = () => accessToken();
const q = (sql, ro) => M.runQuery(T(), ref, sql, ro ? { read_only: true } : undefined);
const lit = s => { const v = String(s); if (v.includes('$px$')) throw new Error('quote tag in payload'); return '$px$' + v + '$px$'; };

let bad = 0;
const ok = m => console.log('OK   ' + m);
const fail = m => { bad++; console.log('FAIL ' + m); };
const note = m => console.log('NOTE ' + m);

const rules = AV.loadRules(ID);
const DUR = rules.duration_minutes;
console.log('rules: ' + AV.describe(rules) + ' | mode=' + (INTAKE ? 'full proof (1 intake)' : 'no-intake'));

let url = '', key = '';
const deployed = 'dist/' + ID + '/assets/site-config.js';
if (existsSync(deployed)) {
  const m = readFileSync(deployed, 'utf8').match(/window\.PORTROX\s*=\s*(\{.*\});?/s);
  if (m) { try { const j = JSON.parse(m[1]); url = j.url || ''; key = j.key || ''; } catch {} }
}
if (!url || !key) {
  const cfg = JSON.parse(readFileSync('sites/' + ID + '/site.json', 'utf8'));
  url = (cfg.supabase && cfg.supabase.url) || '';
  key = (cfg.supabase && cfg.supabase.publishable_key) || '';
}
if (!url || !key) { console.log('FAIL precondition: site not wired to a project'); process.exit(1); }
if (/^sb_(secret|service)_/.test(key)) { console.log('FAIL refusing to use a secret key'); process.exit(1); }

const H = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
const created = [];
const remember = j => {
  if (j && (j.appointment_id || j.submission_id)) created.push({ a: j.appointment_id, s: j.submission_id });
};
const book = async (startsAt, minutes, site) => {
  const r = await fetch(url + '/rest/v1/rpc/portrox_book', {
    method: 'POST', headers: H,
    body: JSON.stringify({
      p_site: site || ID, p_full_name: 'Probe', p_email: 'probe@example.invalid',
      p_message: 'availability gate probe', p_starts_at: startsAt, p_minutes: minutes
    })
  });
  let j = null; try { j = await r.json(); } catch {}
  j = j || {};
  remember(j);
  return j;
};
const countSubs = async () => Number((await q('select count(*)::int as n from public.submissions', true))[0].n);
const countAppts = async () => Number((await q('select count(*)::int as n from public.appointments', true))[0].n);

const baseSubs = await countSubs();
const baseAppts = await countAppts();
console.log('baseline: submissions=' + baseSubs + ' appointments=' + baseAppts);
if (baseSubs >= 5) note('submissions already at ' + baseSubs + ' - the intake limiter (5/hour) may refuse. Run scripts/clean-probes.mjs if these are probes.');

class Abort extends Error {}
const expectRefusal = async (label, iso, minutes, codes, site) => {
  const used = site || ID;
  const before = await countSubs();
  const j = await book(iso, minutes, site);
  if (j.error === 'rate_limited') {
    fail(label + ': intake limiter reached (5 live rows/hour for this email or IP). Clean probes, then re-run.');
    throw new Abort('rate_limited');
  }
  if (j.ok === true) {
    fail(label + ' was ACCEPTED (site=' + used + '). Ids recorded for cleanup; aborting.');
    throw new Abort('unexpected acceptance');
  }
  const wanted = Array.isArray(codes) ? codes : [codes];
  wanted.includes(String(j.error || ''))
    ? ok(label + ' refused (' + j.error + ') [site=' + used + ']')
    : fail(label + ' expected ' + wanted.join('|') + ' got ' + JSON.stringify(j).slice(0, 160) + ' [site=' + used + ']');
  const after = await countSubs();
  after === before ? ok(label + ' wrote nothing') : fail(label + ' left residue ' + before + ' -> ' + after);
};

try {
  console.log('\n-- the enforcement is actually LIVE --');
  const body = (await q("select prosrc from pg_proc where proname = 'portrox_book'", true))[0].prosrc;
  for (const marker of ['outside_availability', 'bad_duration', 'at time zone', 'off_grid', 'too_many_pending']) {
    body.includes(marker) ? ok('live body contains ' + marker) : fail('live body MISSING ' + marker + ' - migration not applied');
  }
  const trg = await q("select count(*)::int as n from pg_trigger where tgname = 'portrox_appt_guard' and tgrelid = 'public.appointments'::regclass and not tgisinternal", true);
  Number(trg[0].n) === 1 ? ok('overlap trigger portrox_appt_guard present') : fail('overlap trigger missing');
  if (bad) throw new Abort('enforcement not live');

  console.log('\n-- rules are in the table, not only on the page --');
  const row = (await q('select timezone, duration_minutes, jsonb_array_length(weekly) as rules from public.availability where site_id = ' + lit(ID), true))[0];
  if (!row) { fail('availability row missing - run scripts/sync-availability.mjs'); throw new Abort('no rules'); }
  row.timezone === rules.timezone ? ok('timezone matches (' + row.timezone + ')') : fail('timezone drift: ' + row.timezone);
  Number(row.duration_minutes) === DUR ? ok('duration matches (' + DUR + ')') : fail('duration drift: ' + row.duration_minutes);
  Number(row.rules) === rules.weekly.length ? ok('rule count matches (' + row.rules + ')') : fail('rule count drift: ' + row.rules);

  console.log('\n-- refusals, each proven to write nothing --');
  await expectRefusal('past slot', new Date(Date.now() - 86400000).toISOString(), DUR, 'past_slot');
  await expectRefusal('Sunday 03:00 local', AV.sundayThreeAm(rules), DUR, 'outside_availability');
  const anchor = AV.nextValidSlot(rules, { daysAhead: 21 });
  await expectRefusal('valid day, before the window', new Date(Date.parse(anchor) - 3600000).toISOString(), DUR, ['outside_availability', 'off_grid']);
  await expectRefusal('off-grid minute', new Date(Date.parse(anchor) + 7 * 60000).toISOString(), DUR, ['off_grid', 'outside_availability']);
  await expectRefusal('non-zero seconds', new Date(Date.parse(anchor) + 30000).toISOString(), DUR, 'off_grid');
  await expectRefusal('visitor-chosen duration', anchor, DUR + 5, 'bad_duration');
  await expectRefusal('four-hour block attempt', anchor, DUR === 240 ? 235 : 240, 'bad_duration');
  await expectRefusal('unknown site', anchor, DUR, 'site_not_published', UNKNOWN);
  note('too_many_pending is NOT exercised: paid_booking is false, so no pending row can exist. Unproven in this configuration.');

  console.log('\n-- the slot is held, and overlap is refused by the DATABASE --');
  const hold = AV.nextValidSlot(rules, { daysAhead: 60 });
  const ins = await q('insert into public.appointments (site_id, starts_at, duration_minutes, status) values ('
    + lit(ID) + ', ' + lit(hold) + '::timestamptz, ' + DUR + ", 'confirmed') returning id::text as id");
  const holdId = ins && ins[0] && ins[0].id;
  created.push({ a: holdId, s: null });
  ok('admin holding row at ' + AV.slotText(hold, rules) + ' (no anonymous intake)');

  await expectRefusal('same slot via RPC', hold, DUR, 'slot_taken');

  const overlap = new Date(Date.parse(hold) + (DUR / 2) * 60000).toISOString();
  let stray = null, refused = false;
  try {
    const r2 = await q('insert into public.appointments (site_id, starts_at, duration_minutes, status) values ('
      + lit(ID) + ', ' + lit(overlap) + '::timestamptz, ' + DUR + ", 'confirmed') returning id::text as id");
    stray = r2 && r2[0] && r2[0].id;
  } catch (e) {
    refused = /23P01|overlapping|exclusion/i.test(e.message);
    if (!refused) fail('overlap insert failed for an unexpected reason: ' + e.message);
  }
  if (stray) { created.push({ a: stray, s: null }); fail('overlapping row was ACCEPTED - trigger did not fire'); }
  else if (refused) ok('overlapping range refused by the trigger (23P01)');

  if (INTAKE) {
    console.log('\n-- end to end through the anonymous door (one intake, cleaned up) --');
    const good = AV.nextValidSlot(rules, { daysAhead: 75 });
    const j = await book(good, DUR);
    if (j.ok === true && j.appointment_id) {
      ok('valid slot accepted: ' + AV.slotText(good, rules));
      ['pending', 'confirmed'].includes(j.status) ? ok('status is real: ' + j.status) : fail('status ' + j.status);
      Number(j.duration_minutes) === DUR ? ok('reply reports server duration (' + DUR + ')') : fail('reply duration ' + j.duration_minutes);
      const want = AV.slotText(good, rules).slice(0, 16);
      String(j.local || '').startsWith(want) ? ok('reply carries visitor wall clock: ' + j.local) : fail('reply local ' + j.local + ' expected ' + want);
      const sub = (await q('select to_jsonb(s) as j from public.submissions s where id = ' + lit(j.submission_id) + '::uuid', true))[0];
      JSON.stringify(sub && sub.j || {}).includes(want)
        ? ok('stored row shows ' + want + ' (not the DB session UTC)')
        : fail('stored row lacks the local wall clock ' + want);
      const before = await countSubs();
      const again = await book(good, DUR);
      again.error === 'slot_taken' ? ok('same slot refused') : fail('retry got ' + JSON.stringify(again).slice(0, 120));
      (await countSubs()) === before ? ok('refused retry left NO orphan submission') : fail('orphan submission left');
    } else {
      fail('valid slot refused: ' + JSON.stringify(j).slice(0, 200));
    }
  } else {
    note('end-to-end intake proof skipped by --no-intake.');
  }
} catch (e) {
  if (!(e instanceof Abort)) fail('gate error: ' + e.message);
  else console.log('NOTE aborted early: ' + e.message);
} finally {
  console.log('\n-- cleanup: every recorded id, success or failure --');
  for (const x of created) {
    try { if (x.a) await q('delete from public.appointments where id = ' + lit(x.a) + '::uuid'); } catch (e) { fail('appt cleanup: ' + e.message); }
    try { if (x.s) await q('delete from public.submissions where id = ' + lit(x.s) + '::uuid'); } catch (e) { fail('sub cleanup: ' + e.message); }
  }
  try {
    const s = await countSubs(), a = await countAppts();
    (s === baseSubs && a === baseAppts)
      ? ok('zero residue: submissions=' + s + ' appointments=' + a)
      : fail('residue: submissions ' + baseSubs + '->' + s + ' appointments ' + baseAppts + '->' + a);
  } catch (e) { fail('final count: ' + e.message); }
}

console.log(bad === 0 ? '\nAVAILABILITY OK' : '\nAVAILABILITY BAD=' + bad);
process.exit(bad === 0 ? 0 : 1);
