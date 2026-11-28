/**
 * Pause must actually close the door, resume must reopen it, and the site must
 * end in EXACTLY the state it started in - even if this gate throws.
 *
 *   node scripts/verify-site-state.mjs
 *
 * CORRECTION, mine: the booking probe sent a PAST slot and expected
 * site_not_published. portrox_book checks past_slot FIRST - deliberately, that
 * ordering is the point of book_validate_first - so the published check was never
 * reached. The probe now derives a VALID FUTURE slot from availability.json via
 * nextValidSlot(), which is what that helper exists for (R7). The past-slot case
 * is kept as its own assertion so the check ORDER is proven, not accidental.
 *
 * A gate that pauses a live site and can leave it paused is worse than no gate.
 * Restoration is in a finally block and is asserted, not hoped for.
 */
import { readFileSync, existsSync } from 'node:fs';
import { loadConfig, accessToken } from '../packages/cli/config-store.mjs';
import * as M from '../packages/cli/supabase-mgmt.mjs';
import * as SS from '../packages/cli/site-state.mjs';
import * as AV from '../packages/core/availability.mjs';

const ID = 'sid200ok.github.io';
const c = loadConfig();
const ref = c.supabase.default_project_ref;
if (!ref || !c.supabase.access_token) { console.log('NOTE no project/token - skipping'); process.exit(0); }
const q = (sql, ro) => M.runQuery(accessToken(), ref, sql, ro ? { read_only: true } : undefined);
const lit = s => '$px$' + String(s) + '$px$';

let bad = 0;
const ok = m => console.log('OK   ' + m);
const fail = m => { bad++; console.log('FAIL ' + m); };
const note = m => console.log('NOTE ' + m);

const rules = AV.loadRules(ID);
const FUTURE = AV.nextValidSlot(rules, { daysAhead: 30 });
const PAST = '2000-01-01T00:00:00Z';
console.log('probe slots: future=' + AV.slotText(FUTURE, rules) + ' | past=' + PAST);

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
const H = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
const rpc = async (fn, body) => {
  const r = await fetch(url + '/rest/v1/rpc/' + fn, { method: 'POST', headers: H, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return j || {};
};
const contact = () => rpc('portrox_submit', { p_site: ID, p_kind: 'contact', p_full_name: 'Probe', p_email: 'probe@example.invalid', p_message: 'site-state probe', p_slot: null, p_honeypot: null });
const book = iso => rpc('portrox_book', { p_site: ID, p_full_name: 'Probe', p_email: 'probe@example.invalid', p_message: 'site-state probe', p_starts_at: iso, p_minutes: rules.duration_minutes });

const count = async () => Number((await q('select count(*)::int as n from public.submissions', true))[0].n);
const base = await count();
let initial = null;
const made = [];

try {
  initial = await SS.readState(ID);
  console.log('initial: is_published=' + initial.is_published + ' intake=' + initial.intake + ' submissions=' + base);

  console.log('\n-- confirmations are required --');
  try { await SS.pause(ID, 'wrong'); fail('pause accepted a wrong confirmation'); }
  catch (e) { /confirmation/.test(e.message) ? ok('pause refuses a wrong confirmation') : fail('unexpected: ' + e.message); }
  try { await SS.resume(ID, ''); fail('resume accepted an empty confirmation'); }
  catch (e) { /confirmation/.test(e.message) ? ok('resume refuses an empty confirmation') : fail('unexpected: ' + e.message); }
  try { await SS.readState('not a site id'); fail('readState accepted a malformed id'); }
  catch (e) { /invalid site id/.test(e.message) ? ok('readState refuses a malformed id') : fail('unexpected: ' + e.message); }

  console.log('\n-- pause closes the door --');
  const p = await SS.pause(ID, ID);
  ok('pause wrote is_published=false (changed=' + p.changed + ')');
  (await SS.readState(ID)).is_published === false ? ok('read-back confirms paused') : fail('read-back still published');

  let j = await contact();
  j.error === 'unknown_site' ? ok('contact intake REFUSED while paused (unknown_site)') : fail('contact not refused: ' + JSON.stringify(j).slice(0, 140));

  j = await book(FUTURE);
  j.error === 'site_not_published'
    ? ok('booking REFUSED while paused (site_not_published) - valid future slot reached the published check')
    : fail('booking not refused for the right reason: ' + JSON.stringify(j).slice(0, 140));

  console.log('\n-- check ORDER is intentional, not accidental --');
  j = await book(PAST);
  j.error === 'past_slot'
    ? ok('a past slot returns past_slot even while paused - cheapest check runs first, writes nothing')
    : fail('expected past_slot first, got ' + JSON.stringify(j).slice(0, 140));
  (await count()) === base ? ok('nothing written while paused') : fail('rows appeared while paused');

  console.log('\n-- resume reopens it --');
  const r = await SS.resume(ID, ID);
  ok('resume wrote is_published=true (changed=' + r.changed + ')');
  (await SS.readState(ID)).is_published === true ? ok('read-back confirms open') : fail('read-back still paused');
  j = await contact();
  if (j.ok === true && j.id) { made.push(j.id); ok('contact intake ACCEPTED after resume'); }
  else fail('contact still refused after resume: ' + JSON.stringify(j).slice(0, 140));

  console.log('\n-- idempotence --');
  const again = await SS.resume(ID, ID);
  again.changed === false ? ok('resuming an open site is a no-op') : fail('resume rewrote an already-open site');
} catch (e) {
  fail('gate error: ' + (e && e.message ? e.message : String(e)));
} finally {
  console.log('\n-- restoration is guaranteed, not hoped for --');
  for (const id of made) { try { await q('delete from public.submissions where id = ' + lit(id) + '::uuid'); } catch (e) { fail('probe cleanup: ' + e.message); } }
  if (initial) {
    try {
      const now = await SS.readState(ID);
      if (now.is_published !== initial.is_published) {
        await q('update public.sites set is_published = ' + (initial.is_published ? 'true' : 'false') + ' where id = ' + lit(ID));
        note('restored is_published to its initial value');
      }
      const end = await SS.readState(ID);
      end.is_published === initial.is_published
        ? ok('site state restored: is_published=' + end.is_published)
        : fail('SITE LEFT IN THE WRONG STATE - initial ' + initial.is_published + ' now ' + end.is_published);
    } catch (e) { fail('RESTORATION FAILED - check the site manually: ' + e.message); }
  }
  try {
    const after = await count();
    after === base ? ok('zero residue: submissions=' + after) : fail('residue: ' + base + ' -> ' + after);
  } catch (e) { fail('final count: ' + e.message); }
}

note('publishing sets is_published=true, so Publish REOPENS intake by design.');
note('pause does not unpublish the page; GitHub Pages keeps serving it.');
note('the Studio state pill reads site.json.published, NOT this DB flag - wiring a');
note('Pause button requires /api/sites to return the DB intake state as well.');
console.log(bad === 0 ? '\nSITE STATE OK' : '\nSITE STATE BAD=' + bad);
process.exit(bad === 0 ? 0 : 1);
