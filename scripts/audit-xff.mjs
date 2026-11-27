/**
 * Is the intake limiter's IP source trustworthy?
 *
 *   node scripts/audit-xff.mjs
 *
 * portrox_submit parses btrim(split_part(x-forwarded-for, ',', 1))::inet.
 * The FIRST hop is the caller's claim in the general proxy model; the LAST hop
 * is what a trusted edge appended. Whether Supabase's edge REWRITES the header
 * or APPENDS to it decides if the 5/hour limiter is bypassable with rotating
 * emails. That must be measured, not assumed.
 *
 * CORRECTION vs the first attempt: it printed a masked prefix and a single
 * equality boolean, which admitted two readings (edge rewrote it, OR inet::text
 * carried a /32 mask). The decisive comparison - did three DIFFERENT forged
 * headers produce the SAME stored IP? - was never printed. It is now the verdict.
 *
 * The raw IP is never printed. Only a sha256 fingerprint, so runs are comparable
 * without disclosing the operator's address.
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

const before = Number((await q('select count(*)::int as n from public.submissions', true))[0].n);
console.log('baseline submissions: ' + before);
if (before >= 3) console.log('NOTE ' + before + ' rows already present; the 5/hour limiter may refuse. Run scripts/clean-probes.mjs first if they are probes.');

const made = [];
const results = [];
try {
  for (const forged of CASES) {
    const firstHop = forged.split(',')[0].trim();
    const r = await fetch(url + '/rest/v1/rpc/portrox_submit', {
      method: 'POST',
      headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'X-Forwarded-For': forged },
      body: JSON.stringify({
        p_site: ID, p_kind: 'contact', p_full_name: 'Probe', p_email: 'probe@example.invalid',
        p_message: 'xff trust probe', p_slot: null, p_honeypot: null
      })
    });
    let j = null; try { j = await r.json(); } catch {}
    if (!j || !j.id) { console.log('NOTE forged "' + forged + '" gave ' + JSON.stringify(j)); continue; }
    made.push(j.id);
    const row = (await q('select ip::text as ip from public.submissions where id = ' + lit(j.id) + '::uuid', true))[0];
    const ip = row && row.ip ? String(row.ip) : null;
    results.push({ forged, firstHop, ip, fingerprint: ip ? fp(ip) : 'null', equalsForged: ip === firstHop, hasMask: !!ip && ip.includes('/'), len: ip ? ip.length : 0 });
  }

  console.log('\n-- what was actually stored (fingerprint only, never the address) --');
  for (const x of results) {
    console.log('forged="' + x.forged + '" first_hop=' + x.firstHop
      + ' | stored_fp=' + x.fingerprint
      + ' | equals_first_hop=' + x.equalsForged
      + ' | has_mask=' + x.hasMask
      + ' | text_len=' + x.len);
  }

  console.log('\n-- verdict --');
  if (results.length < 2) {
    console.log('INCONCLUSIVE: fewer than two probes were stored. Re-run after cleaning probes.');
    process.exitCode = 1;
  } else if (results.some(x => x.equalsForged)) {
    console.log('SPOOFABLE: a forged first hop was stored verbatim.');
    console.log('ACTION: parse the LAST hop of x-forwarded-for (or a trusted-proxy count from the right),');
    console.log('        then re-run this audit and expect NORMALIZED.');
    process.exitCode = 1;
  } else if (new Set(results.map(x => x.fingerprint)).size === 1) {
    console.log('NORMALIZED: ' + results.length + ' different forged headers all produced the SAME stored address.');
    console.log('The edge overwrites x-forwarded-for, so the first hop is the real client. Current parsing is safe.');
    console.log('Record this in docs/DECISIONS.md and close open item O11.');
    process.exitCode = 0;
  } else {
    console.log('INCONCLUSIVE: no forgery landed, but the stored addresses differ between probes.');
    console.log('Possible client-side egress change or an intermediary pool. Re-run, then decide.');
    process.exitCode = 1;
  }
} catch (e) {
  console.log('FAIL audit error: ' + e.message);
  process.exitCode = 1;
} finally {
  for (const id of made) {
    try { await q('delete from public.submissions where id = ' + lit(id) + '::uuid'); } catch (e) { console.log('FAIL cleanup ' + id + ': ' + e.message); }
  }
  const after = Number((await q('select count(*)::int as n from public.submissions', true))[0].n);
  console.log('\ncleanup: submissions ' + before + ' -> ' + after + (after === before ? ' (zero residue)' : ' (RESIDUE)'));
  if (after !== before) process.exitCode = 1;
}
