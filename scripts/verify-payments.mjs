/**
 * Proves the registry, routing and BOTH documented signature schemes using
 * vectors computed locally - no network, no real credentials. Sandbox home.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHmac } from 'node:crypto';

const box = mkdtempSync(join(tmpdir(), 'px-pay-'));
process.env.PORTROX_HOME = box;
const PAY = await import('../packages/cli/payment-providers.mjs');
const S = () => randomBytes(16).toString('hex');
const wh = S(), ks = S(), sk = S();

let bad = 0;
const ok = m => console.log('OK   ' + m);
const fail = m => { bad++; console.log('FAIL ' + m); };
const must = (fn, re, label) => {
  // Accept a string or a RegExp. A bare string silently threw 're.test is not a
  // function' and aborted the whole try block, hiding every later assertion.
  const rx = re instanceof RegExp ? re : new RegExp(String(re));
  try { fn(); fail(label + ' did NOT refuse'); }
  catch (e) { rx.test(e.message) ? ok(label + ' refused') : fail(label + ' wrong error: ' + e.message); }
};
const H = (k, m) => createHmac('sha256', k).update(m, 'utf8').digest('hex');

try {
  PAY.catalogue().length === 5 ? ok('5 adapters in the catalogue') : fail('catalogue size wrong');
  must(() => PAY.save('nope', {}), /unknown provider/, 'unknown provider');
  must(() => PAY.save('stripe', {}), /required/, 'missing required field');
  must(() => PAY.save('hosted_link', { label: 'x', checkout_url: 'http://x.test/pay' }), /https/, 'insecure checkout link');
  must(() => PAY.save('manual', { payee_name: 'A', instructions: 'B', upi_id: 'not-a-upi' }), /name@bank/, 'malformed UPI id');
  must(() => PAY.save('hyperswitch', { base_url: 'http://remote.test', api_key: S() }), /https/, 'insecure remote orchestrator');

  PAY.save('manual', { payee_name: 'Siddhant Kumar', instructions: 'Pay by UPI and email the reference.', upi_id: 'siddhant@upi', enabled: true, countries: ['IN'], currencies: ['INR'] });
  PAY.save('stripe', { publishable_key: 'pk_live_x', secret_key: sk, webhook_secret: wh, enabled: true, currencies: ['USD', 'EUR'] });
  PAY.save('razorpay', { key_id: 'rzp_live_x', key_secret: ks, webhook_secret: wh, enabled: true, countries: ['IN'] });
  ok('three providers configured');

  const l = JSON.stringify(PAY.list());
  [wh, ks, sk].every(v => !l.includes(v)) ? ok('list never leaks a secret value') : fail('list leaked a secret');
  PAY.list().providers.find(p => p.id === 'stripe').secret_set.webhook_secret ? ok('secret presence reported as a flag') : fail('no set-flag');

  must(() => PAY.route({ country: 'IND' }), /ISO-3166/, 'bad country code');
  must(() => PAY.route({ currency: 'RUPEE' }), /ISO-4217/, 'bad currency code');
  PAY.setOrder(['razorpay', 'stripe', 'manual']);
  PAY.route({ country: 'IN', currency: 'INR' }).provider === 'razorpay' ? ok('India routes to razorpay first') : fail('India routing wrong');
  PAY.route({ country: 'DE', currency: 'EUR' }).provider === 'stripe' ? ok('EUR routes to stripe') : fail('EUR routing wrong');
  PAY.setOrder(['manual', 'razorpay', 'stripe']);
  PAY.route({ country: 'IN', currency: 'INR' }).provider === 'manual' ? ok('admin order is honoured') : fail('order ignored');
  PAY.setEnabled('manual', false);
  PAY.route({ country: 'IN', currency: 'INR' }).provider === 'razorpay' ? ok('disabled provider skipped') : fail('disabled provider used');
  must(() => PAY.setDefault('manual'), /enabled/, 'default set to a disabled provider');
  PAY.setDefault('stripe');
  PAY.route({ country: 'JP', currency: 'JPY' }).fallback === true ? ok('unmatched falls back to the default') : fail('no fallback');

  console.log('\n-- multiple local gateways via instances --');
  must(() => PAY.save('stripe:extra', {}), /account-wide/, 'instance on a single-account provider');
  must(() => PAY.save('hosted_link:Bad Slug', { label: 'x', checkout_url: 'https://x.test' }), /instance id/, 'malformed instance id');
  PAY.save('hosted_link:paystack_ng', { label: 'Paystack Nigeria', checkout_url: 'https://paystack.test/pay', enabled: true, countries: ['NG'], currencies: ['NGN'] });
  PAY.save('hosted_link:pix_br', { label: 'Pix Brazil', checkout_url: 'https://pix.test/pay', enabled: true, countries: ['BR'], currencies: ['BRL'] });
  PAY.save('manual:upi_in', { label: 'UPI India', payee_name: 'Siddhant', instructions: 'UPI then email reference', upi_id: 'siddhant@upi', enabled: true, countries: ['IN'], currencies: ['INR'] });
  PAY.setOrder(['manual:upi_in', 'hosted_link:paystack_ng', 'hosted_link:pix_br', 'razorpay', 'stripe']);
  PAY.route({ country: 'NG', currency: 'NGN' }).provider === 'hosted_link:paystack_ng' ? ok('Nigeria routes to its own gateway') : fail('NG routing wrong');
  PAY.route({ country: 'BR', currency: 'BRL' }).provider === 'hosted_link:pix_br' ? ok('Brazil routes to its own gateway') : fail('BR routing wrong');
  PAY.route({ country: 'IN', currency: 'INR' }).provider === 'manual:upi_in' ? ok('India routes to UPI manual') : fail('IN routing wrong');
  const keys = PAY.list().providers.map(x => x.id);
  keys.filter(k => k.startsWith('hosted_link:')).length === 2 ? ok('both hosted instances listed') : fail('instances not listed');
  PAY.list().providers.find(x => x.id === 'hosted_link:pix_br').label === 'Pix Brazil' ? ok('instance label kept') : fail('label lost');
  must(() => PAY.remove('hosted_link:pix_br', 'hosted_link'), /confirmation/, 'remove with the base id instead of the instance key');
  PAY.remove('hosted_link:pix_br', 'hosted_link:pix_br');
  PAY.list().providers.some(x => x.id === 'hosted_link:pix_br') === false ? ok('instance removed') : fail('instance survived');

  console.log('\n-- razorpay webhook (HMAC of raw body) --');
  const body = JSON.stringify({ event: 'payment.captured', payload: { id: 'pay_1' } });
  const good = H(wh, body);
  PAY.verifyWebhook('razorpay', { 'X-Razorpay-Signature': good }, body).ok ? ok('valid signature accepted') : fail('valid signature rejected');
  must(() => PAY.verifyWebhook('razorpay', { 'X-Razorpay-Signature': good }, body + ' '), /mismatch/, 'tampered body');
  must(() => PAY.verifyWebhook('razorpay', {}, body), /missing X-Razorpay/, 'missing header');
  must(() => PAY.verifyWebhook('razorpay', { 'X-Razorpay-Signature': good }, ''), /RAW bytes/, 'empty body');

  console.log('\n-- stripe webhook (HMAC of t.body) --');
  const t = Math.floor(Date.now() / 1000);
  const sv = H(wh, t + '.' + body);
  PAY.verifyWebhook('stripe', { 'Stripe-Signature': 't=' + t + ',v1=' + sv }, body).ok ? ok('valid v1 accepted') : fail('valid v1 rejected');
  must(() => PAY.verifyWebhook('stripe', { 'Stripe-Signature': 't=' + t + ',v1=' + H(wh, t + '.' + body + 'x') }, body), /mismatch/, 'wrong v1');
  must(() => PAY.verifyWebhook('stripe', { 'Stripe-Signature': 't=' + (t - 9999) + ',v1=' + H(wh, (t - 9999) + '.' + body) }, body), /replay/, 'stale timestamp replay');
  must(() => PAY.verifyWebhook('stripe', { 'Stripe-Signature': 'v1=' + sv }, body), /timestamp/, 'missing timestamp');
  must(() => PAY.verifyWebhook('stripe', {}, body), /missing Stripe-Signature/, 'missing stripe header');

  console.log('\n-- razorpay checkout (HMAC of order|payment) --');
  PAY.verifyCheckout('razorpay', { order_id: 'order_1', payment_id: 'pay_1', signature: H(ks, 'order_1|pay_1') }).ok ? ok('valid checkout accepted') : fail('valid checkout rejected');
  must(() => PAY.verifyCheckout('razorpay', { order_id: 'order_1', payment_id: 'pay_2', signature: H(ks, 'order_1|pay_1') }), /mismatch/, 'swapped payment id');

  console.log('\n-- refusals --');
  must(() => PAY.verifyWebhook('manual', {}, body), /do not invent/, 'webhook on a scheme-less provider');
  must(() => PAY.verifyWebhook('hyperswitch', {}, body), /do not invent/, 'hyperswitch webhook not invented');
  must(() => PAY.verifyCheckout('stripe', { order_id: 'a', payment_id: 'b', signature: 'c' }), /razorpay only/, 'checkout on stripe');
  must(() => PAY.remove('stripe', 'wrong'), /confirmation/, 'remove without confirmation');
  PAY.remove('stripe', 'stripe');
  PAY.list().providers.find(p => p.id === 'stripe').configured === false ? ok('provider removed') : fail('provider survived removal');
} catch (e) { fail('flow threw: ' + e.message); }
finally { rmSync(box, { recursive: true, force: true }); ok('sandbox removed'); }

console.log('\n' + (bad === 0 ? 'PAYMENTS OK' : 'PAYMENTS BAD=' + bad));
process.exit(bad === 0 ? 0 : 1);
