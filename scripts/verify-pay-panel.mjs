/**
 * Proves the rendered public payment panel: options appear, NO secret reaches
 * the bundle, server-required gateways expose no checkout URL, and the page
 * still has exactly one h1. Sandbox home; the real site dir is read-only.
 */
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const box = mkdtempSync(join(tmpdir(), 'px-panel-'));
process.env.PORTROX_HOME = box;
const PAY = await import('../packages/cli/payment-providers.mjs');
const { renderSite } = await import('../packages/core/render.mjs');
const SECRET = randomBytes(16).toString('hex');
const site = process.argv[2] || 'sid200ok.github.io';

let bad = 0;
const ok = m => console.log('OK   ' + m);
const fail = m => { bad++; console.log('FAIL ' + m); };

const out = mkdtempSync(join(tmpdir(), 'px-panel-out-'));
try {
  PAY.save('manual:upi_in', { label: 'UPI India', payee_name: 'Siddhant Kumar', upi_id: 'siddhant@upi',
    instructions: 'Pay by UPI then send the reference.', enabled: true, countries: ['IN'], currencies: ['INR'] });
  PAY.save('hosted_link:paystack_ng', { label: 'Paystack Nigeria', checkout_url: 'https://paystack.test/checkout',
    enabled: true, countries: ['NG'], currencies: ['NGN'] });
  PAY.save('stripe', { publishable_key: 'pk_test_x', secret_key: SECRET, webhook_secret: SECRET, enabled: true });

  await renderSite(join(process.cwd(), 'sites', site), out);
  // portrox build runs normalizeDir AFTER renderSite; book.html gets its h1
  // promoted from the first h2 there. Asserting on raw output was wrong.
  const { normalizeDir } = await import('../packages/core/html-normalize.mjs');
  normalizeDir(out);
  const book = readFileSync(join(out, 'book.html'), 'utf8');
  const cfgjs = readFileSync(join(out, 'assets/site-config.js'), 'utf8');

  book.includes('siddhant@upi') ? ok('UPI id rendered for the visitor') : fail('UPI id missing');
  book.includes('Pay by UPI then send the reference.') ? ok('manual instructions rendered') : fail('instructions missing');
  book.includes('https://paystack.test/checkout') ? ok('hosted checkout link rendered') : fail('hosted link missing');
  book.includes('arranged directly') ? ok('server-required gateway labelled honestly') : fail('no honest label');
  book.includes(SECRET) === false ? ok('no secret in book.html') : fail('SECRET LEAKED into book.html');
  cfgjs.includes(SECRET) === false ? ok('no secret in site-config.js') : fail('SECRET LEAKED into site-config.js');
  /secret_key|key_secret|webhook_secret/.test(cfgjs) === false ? ok('no secret field names in site-config.js') : fail('secret field name present');
  cfgjs.includes('"pay"') ? ok('pay options present in site-config.js') : fail('pay missing from site-config');
  (book.match(/<h1[\s>]/gi) || []).length === 1 ? ok('book page still has exactly ONE h1') : fail('h1 count changed');
  /Phase 3 adds/.test(book) === false ? ok('stale Phase-3 note removed') : fail('stale note still shipped');
  book.includes('never marked automatically') ? ok('visitors told payment is owner-confirmed') : fail('no confirmation caveat');
  const forms = readFileSync(join(out, 'assets/forms.js'), 'utf8');
  forms.includes('portrox_book') ? ok('shipped forms.js calls portrox_book') : fail('booking form still only writes a message');
  forms.includes('portrox_payment_ref') ? ok('shipped forms.js can send a reference') : fail('no reference submission in forms.js');
  book.includes('type="datetime-local"') ? ok('slot is a real timestamp input') : fail('slot is still free text');
  book.includes('id="pay-ref"') ? ok('reference box rendered') : fail('no reference box');
  cfgjs.includes('"minutes"') ? ok('duration shipped in site-config') : fail('duration missing');
} catch (e) { fail('render threw: ' + e.message); }
finally { rmSync(out, { recursive: true, force: true }); rmSync(box, { recursive: true, force: true }); ok('sandboxes removed'); }
console.log('\n' + (bad === 0 ? 'PAY PANEL OK' : 'PAY PANEL BAD=' + bad));
process.exit(bad === 0 ? 0 : 1);
