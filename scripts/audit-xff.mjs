/**
 * Proves the stored intake address is INVARIANT under header forgery, and that
 * no security decision depends on it.
 *
 *   node scripts/audit-xff.mjs
 *
 * THREE CORRECTIONS, all mine, recorded so the next reader does not repeat them:
 *  1. v1 printed a masked prefix. Two different readings fitted the same output.
 *  2. v2 compared inet::text (which carries /32) to a bare address, so equality
 *     failed for a FORMATTING reason and the verdict fell to INCONCLUSIVE while
 *     the data was decisive.
 *  3. v3 measured correctly and then printed "the edge overwrites it". That is a
 *     mechanism claim the probe cannot observe, and it is FALSE. The recorded
 *     evidence shows the edge APPENDS:
 *       first-hop parsing stored 203.0.113.7/32 and 198.51.100.9/32 - it tracked
 *       the forgery; last-hop parsing stores one stable value for all three
 *       cases. An overwriting edge would have normalised the first hop too.
 *
 * A gate asserts what it measured. This one asserts invariance and independence,
 * and states the append model as history rather than as a fresh observation.
 * The raw address is never printed - only a sha256 fingerprint.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadConfig, accessToken } from '../packages/cli/config-store.mjs';
import * as M from '../packages/cli/supabase-mgmt.mjs';

const ID = 'sid200ok.github.io';
const CASES = ['203.0.113.7', '198.51.100.9', '203.0.113.7, 198.51.100.9'];
const c = loadConfig();
const ref = c.supabase.default_project_ref;
if (!ref || !c.supabase.access_token) { console.log('NOTE no project/token - skipping'); process.exit(0); }
const T = () => accessToken();
const q = (sql, ro) => M.runQuery(T(), ref, sql, ro ? { read_only: true } : undefined);
const lit = s => { const v = String(s); if (v.includes('$px$')) throw new Error('quote tag in payload'); return '$px$' + v + '$px$'; };
const fp = s => createHash('sha256').update(String(s)).digest('hex').slice(0, 12);
const hostOf = s => String(s || '').split('/')[0].trim();

let bad = 0;
const ok = m => console.log('OK   ' + m);
const fail = m => { bad++; console.log('FAIL ' + m); };
const note = m => console.log('NOTE ' + m);

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

const before = Number((await q('select count(*)::int as n from public.submissions', true))[0].n);
console.log('baseline submissions: ' + before);
const made = [];
const results = [];
try {
  for (const forged of CASES) {
    const firstHop = forged.split(',')[0].trim();
    const r = await fetch(url + '/rest/v1/rpc/portrox_submit', {
      method: 'POST',
      headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'X-Forwarded-For': forged },
      body: JSON.stringify({ p_site: ID, p_kind: 'contact', p_full_name: 'Probe', p_email: 'probe@example.invalid', p_message: 'xff trust probe', p_slot: null, p_honeypot: null })
    });
    let j = null; try { j = await r.json(); } catch {}
    if (!j || !j.id) { note('forged "' + forged + '" gave ' + JSON.stringify(j)); continue; }
    made.push(j.id);
    const row = (await q('select ip::text as ip from public.submissions where id = ' + lit(j.id) + '::uuid', true))[0];
    const raw = row && row.ip ? String(row.ip) : null;
    results.push({ forged, firstHop, host: hostOf(raw), fingerprint: raw ? fp(raw) : 'null', equalsForged: hostOf(raw) === firstHop, masked: !!raw && raw.includes('/') });
  }

  console.log('\n-- stored address, normalised (fingerprint only, never the address) --');
  for (const x of results) {
    console.log('forged="' + x.forged + '" first_hop=' + x.firstHop
      + ' | stored_fp=' + x.fingerprint
      + ' | equals_forged=' + x.equalsForged
      + ' | mask_present=' + x.masked);
  }

  console.log('\n-- property 1: invariance under forgery --');
  if (results.length < CASES.length) {
    fail('inconclusive: only ' + results.length + ' of ' + CASES.length + ' probes stored. Clean probes and re-run.');
  } else if (results.some(x => x.equalsForged)) {
    fail('CALLER-CONTROLLED: a forged hop is stored verbatim. The function must parse the LAST hop, not the first.');
  } else if (new Set(results.map(x => x.host)).size === 1) {
    ok('INVARIANT: ' + results.length + ' different forged headers produced one identical stored address');
    note('history: with FIRST-hop parsing the same probes stored 203.0.113.7/32 and 198.51.100.9/32,');
    note('        i.e. the forgery landed. So the edge APPENDS the real address; it does not overwrite.');
    note('        Taking the last hop is correct in both the append and the rewrite model.');
  } else {
    fail('inconclusive: no forgery landed but the stored addresses differ between probes. Re-run, then decide.');
  }

  console.log('\n-- property 2: no security decision depends on it --');
  const body = (await q("select prosrc from pg_proc where proname = 'portrox_submit'", true))[0].prosrc;
  /ip\s*=\s*v_ip/.test(body)
    ? fail('a ceiling still compares ip = v_ip - apply 20261127020000_intake_limit_no_ip.sql')
    : ok('no ceiling references the stored IP; limits are email + site based');
  for (const marker of ['v_email_recent', 'v_site_hour', 'v_site_day']) {
    body.includes(marker) ? ok('live body contains ' + marker) : fail('live body MISSING ' + marker);
  }
} catch (e) {
  fail('audit error: ' + e.message);
} finally {
  for (const id of made) { try { await q('delete from public.submissions where id = ' + lit(id) + '::uuid'); } catch (e) { fail('cleanup: ' + e.message); } }
  const after = Number((await q('select count(*)::int as n from public.submissions', true))[0].n);
  after === before ? ok('zero residue: submissions=' + after) : fail('residue ' + before + ' -> ' + after);
}
console.log(bad === 0 ? '\nXFF AUDIT OK' : '\nXFF AUDIT BAD=' + bad);
process.exit(bad === 0 ? 0 : 1);
