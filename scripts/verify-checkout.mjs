/**
 * Proves the reference loop end to end: book a slot, submit a reference ONCE,
 * status stays pending, admin marks paid, cancellation needs confirmation,
 * then the probe is removed. Also proves publicOptions leaks no secret and
 * honestly flags gateways that need a server.
 */
import { loadConfig, publicSupabaseFor } from '../packages/cli/config-store.mjs';
import * as IB from '../packages/cli/inbox-store.mjs';
import * as CO from '../packages/cli/checkout.mjs';
import * as PAY from '../packages/cli/payment-providers.mjs';

const site = process.argv[2] || 'sid200ok.github.io';
const c = loadConfig();
if (!c.supabase.default_project_ref || !c.supabase.access_token) { console.log('NOTE no project/token - skipping'); process.exit(0); }
const pub = publicSupabaseFor(c.supabase.default_project_ref);
let bad = 0;
const ok = m => console.log('OK   ' + m);
const fail = m => { bad++; console.log('FAIL ' + m); };
const must = async (fn, re, label) => {
  const rx = re instanceof RegExp ? re : new RegExp(String(re));
  try { await fn(); fail(label + ' did NOT refuse'); }
  catch (e) { rx.test(e.message) ? ok(label + ' refused') : fail(label + ' wrong error: ' + e.message); }
};
const rpc = async (name, body) => {
  const r = await fetch(pub.url + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: { apikey: pub.publishable_key, Authorization: 'Bearer ' + pub.publishable_key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: r.status, json: await r.json().catch(() => null) };
};

console.log('-- public options are safe and honest --');
const opts = CO.publicOptions();
Array.isArray(opts) ? ok('publicOptions returns a list (' + opts.length + ')') : fail('not a list');
const blob = JSON.stringify(opts);
/secret_key|key_secret|webhook_secret|api_key/.test(blob) === false ? ok('no secret field in public options') : fail('a secret field leaked');
opts.filter(o => o.requires_server).every(o => !o.checkout_url) ? ok('server-required gateways expose no checkout URL') : fail('a server gateway exposed a URL');

let sub = null, appt = null;
try {
  const slot = new Date(Date.now() + 400 * 86400000); slot.setUTCHours(11, 0, 0, 0);
  // Derive the REAL argument names. Guessing them produced PGRST202.
  const M = await import('../packages/cli/supabase-mgmt.mjs');
  const sig = await M.runQuery(c.supabase.access_token, c.supabase.default_project_ref,
    "select pg_get_function_arguments(oid) as args from pg_proc where proname = 'portrox_book'", { read_only: true });
  const names = String((sig[0] && sig[0].args) || '').split(',').map(x => x.trim().split(/\s+/)[0]).filter(Boolean);
  names.length ? ok('book signature: ' + names.join(', ')) : fail('could not read portrox_book signature');
  const payload = {};
  for (const n of names) {
    if (/site/.test(n)) payload[n] = site;
    else if (/name/.test(n)) payload[n] = 'Probe Payer';
    else if (/email/.test(n)) payload[n] = 'probe@example.invalid';
    else if (/message|note/.test(n)) payload[n] = 'checkout probe';
    else if (/start|slot|when/.test(n)) payload[n] = slot.toISOString();
    else if (/duration|minutes/.test(n)) payload[n] = 30;
    else if (/honeypot|hp/.test(n)) payload[n] = '';
    else fail('unmapped book argument: ' + n);
  }
  const b = await rpc('portrox_book', payload);
  sub = b.json?.submission_id || null; appt = b.json?.appointment_id || null;
  appt ? ok('probe booking created') : fail('booking failed: ' + JSON.stringify(b.json).slice(0, 160));

  if (appt) {
    const before = await CO.getAppointment(appt);
    CO.STATUSES.includes(before.status) ? ok('new booking status is valid: ' + before.status) : fail('status ' + before.status);
    const startStatus = before.status;
    before.payment_ref === null ? ok('no reference yet') : fail('reference already set');

    await must(() => CO.setStatus(appt, 'paid'), /without a payment reference/, 'mark paid with no reference');
    const short = await rpc('portrox_payment_ref', { p_appointment: appt, p_ref: 'ab' });
    short.json?.error === 'bad_reference_length' ? ok('short reference refused') : fail('short reference: ' + JSON.stringify(short.json));
    const inj = await rpc('portrox_payment_ref', { p_appointment: appt, p_ref: "x'; drop table appointments;--" });
    inj.json?.error === 'bad_reference_chars' ? ok('injection-shaped reference refused') : fail('injection: ' + JSON.stringify(inj.json));

    const good = await rpc('portrox_payment_ref', { p_appointment: appt, p_ref: 'UPI-PROBE-0001' });
    good.json?.ok === true ? ok('reference accepted') : fail('reference refused: ' + JSON.stringify(good.json));
    const after = await CO.getAppointment(appt);
    after.payment_ref === 'UPI-PROBE-0001' ? ok('reference stored') : fail('reference not stored');
    after.status === startStatus ? ok('status UNCHANGED - a claim is not a payment') : fail('status became ' + after.status);

    const twice = await rpc('portrox_payment_ref', { p_appointment: appt, p_ref: 'UPI-PROBE-0002' });
    twice.json?.error === 'reference_already_submitted' ? ok('write-once enforced') : fail('second reference accepted');

    await must(() => CO.setStatus(appt, 'verified'), /one of/, 'status outside the DB constraint');
    await must(() => CO.setStatus(appt, 'paid'), /confirmation/, 'paid without confirmation');
    const paid = await CO.setStatus(appt, 'paid', { confirm: 'PAID' });
    paid.status === 'paid' ? ok('admin marked paid') : fail('paid not applied');
    const conf = await CO.setStatus(appt, 'confirmed');
    conf.status === 'confirmed' ? ok('admin confirmed') : fail('confirmed not applied');
    await must(() => CO.clearReference(appt, 'no'), /CLEAR/, 'clear without confirmation');
    const cleared = await CO.clearReference(appt, 'CLEAR');
    cleared.payment_ref === null ? ok('reference cleared') : fail('reference survived clear');
    cleared.status === 'confirmed' ? ok('a paid booking reverts to confirmed, not pending') : fail('clear left status ' + cleared.status);
  }
} catch (e) { fail('loop threw: ' + e.message); }
finally {
  if (sub) { try { await IB.deleteSubmission(sub, sub); ok('probe removed'); } catch (e) { fail('residue: ' + e.message); } }
}
await must(() => CO.getAppointment('not-a-uuid'), /invalid appointment/, 'bad uuid');
console.log('\n' + (bad === 0 ? 'CHECKOUT OK' : 'CHECKOUT BAD=' + bad));
process.exit(bad === 0 ? 0 : 1);
