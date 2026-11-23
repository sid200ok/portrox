/**
 * Proves the Inbox round-trips with ZERO residue: create a probe lead through
 * the public RPC, read it, triage it, refuse a wrong confirmation, delete it,
 * assert it is gone. Plus refusals for bad uuid / triage / site id.
 */
import { loadConfig, publicSupabaseFor } from '../packages/cli/config-store.mjs';
import * as IB from '../packages/cli/inbox-store.mjs';

const site = process.argv[2] || 'sid200ok.github.io';
const c = loadConfig();
const ref = c.supabase.default_project_ref;
if (!ref || !c.supabase.access_token) { console.log('NOTE no project/token - skipping'); process.exit(0); }
const pub = publicSupabaseFor(ref);
let bad = 0;
const ok = m => console.log('OK   ' + m);
const fail = m => { bad++; console.log('FAIL ' + m); };
const mustThrow = async (fn, re, label) => {
  try { await fn(); fail(label + ' did NOT refuse'); }
  catch (e) { re.test(e.message) ? ok(label + ' refused') : fail(label + ' wrong error: ' + e.message); }
};

let id = null;
try {
  const r = await fetch(pub.url + '/rest/v1/rpc/portrox_submit', {
    method: 'POST',
    headers: { apikey: pub.publishable_key, Authorization: 'Bearer ' + pub.publishable_key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_site: site, p_kind: 'contact', p_full_name: 'Probe', p_email: 'probe@example.invalid', p_message: 'inbox round-trip probe' })
  });
  const j = await r.json();
  id = j.submission_id || j.id || null;
  id ? ok('probe lead created ' + id) : fail('probe lead not created: ' + JSON.stringify(j).slice(0, 160));
} catch (e) { fail('probe create threw: ' + e.message); }

try {
  const list = await IB.listInbox(site, { limit: 200 });
  Array.isArray(list) ? ok('listInbox returned ' + list.length + ' row(s)') : fail('listInbox not an array');
  if (id) list.some(x => x.id === id) ? ok('probe visible in inbox') : fail('probe NOT visible in inbox');
  const kinds = new Set(list.map(x => x.kind));
  [...kinds].every(k => k === 'contact' || k === 'booking') ? ok('kind derived correctly') : fail('unexpected kind values');
  const cnt = await IB.counts(site);
  Array.isArray(cnt) ? ok('counts returned ' + cnt.length + ' group(s)') : fail('counts not an array');
} catch (e) { fail('read threw: ' + e.message); }

if (id) {
  try {
    const t = await IB.setTriage(id, 'replied');
    t.triage === 'replied' ? ok('triage new -> replied') : fail('triage did not apply');
    const back = await IB.listInbox(site, { triage: 'replied', limit: 200 });
    back.some(x => x.id === id) ? ok('triage filter finds it') : fail('triage filter missed it');
  } catch (e) { fail('triage threw: ' + e.message); }
  await mustThrow(() => IB.deleteSubmission(id, 'wrong'), /confirmation/, 'delete with wrong confirm');
  try {
    const d = await IB.deleteSubmission(id, id);
    d.deleted === id ? ok('probe deleted') : fail('delete returned wrong id');
    const after = await IB.listInbox(site, { limit: 200 });
    after.some(x => x.id === id) === false ? ok('probe gone from inbox') : fail('probe STILL in inbox');
    id = null;
  } catch (e) { fail('delete threw: ' + e.message); }
}

console.log('\n-- refusals --');
await mustThrow(() => IB.setTriage('not-a-uuid', 'read'), /uuid/, 'bad uuid');
await mustThrow(() => IB.setTriage('00000000-0000-0000-0000-000000000000', 'bogus'), /triage/, 'bad triage value');
await mustThrow(() => IB.listInbox('../etc'), /site id/, 'bad site id');
await mustThrow(() => IB.listInbox(site, { kind: 'evil' }), /kind/, 'bad kind');

if (id) { try { await IB.deleteSubmission(id, id); ok('residue cleaned'); } catch (e) { fail('residue remains: ' + e.message); } }
console.log('\n' + (bad === 0 ? 'INBOX OK' : 'INBOX BAD=' + bad));
process.exit(bad === 0 ? 0 : 1);
