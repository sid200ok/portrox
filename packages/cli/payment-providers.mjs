/**
 * Payment provider REGISTRY, configured from the Studio. Portrox does not own
 * payment logic; it owns configuration, routing and signature verification.
 *
 * Five adapters:
 *   manual       - UPI ID / bank transfer + proof. No gateway, works everywhere.
 *   hosted_link  - ANY gateway's hosted checkout URL. This is the universal
 *                  answer for local gateways: Payoneer, Paystack, Flutterwave,
 *                  Mercado Pago, bKash, M-Pesa, a bank page - no code needed.
 *   stripe       - international cards. Webhook v1 = HMAC(t + '.' + rawBody).
 *   razorpay     - India: UPI, cards, netbanking. Webhook = HMAC(rawBody);
 *                  checkout = HMAC(order_id + '|' + payment_id).
 *   hyperswitch  - self-hosted open-source orchestrator, 120+ connectors.
 *
 * Signature verification is implemented ONLY for the two documented schemes.
 * The others refuse rather than invent a scheme.
 * Secrets are stored 0600 and NEVER returned - only set-flags and fingerprints.
 */
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const HOME = process.env.PORTROX_HOME || join(homedir(), '.portrox');
const P = join(HOME, 'payment-providers.json');
export class PayError extends Error { constructor(m, c) { super(m); this.code = c || 400; } }

export const PROVIDERS = [
  { id: 'manual', label: 'Manual (UPI ID / bank transfer)', region: 'any',
    methods: ['upi', 'bank_transfer'], webhook: false,
    fields: [{ k: 'payee_name', secret: false, req: true }, { k: 'upi_id', secret: false, req: false },
             { k: 'instructions', secret: false, req: true }] },
  { id: 'hosted_link', label: 'Hosted checkout link (any gateway)', region: 'any',
    methods: ['hosted'], webhook: false,
    fields: [{ k: 'label', secret: false, req: true }, { k: 'checkout_url', secret: false, req: true }] },
  { id: 'stripe', label: 'Stripe (international cards)', region: 'international',
    methods: ['card'], webhook: true,
    fields: [{ k: 'publishable_key', secret: false, req: true }, { k: 'secret_key', secret: true, req: true },
             { k: 'webhook_secret', secret: true, req: true }] },
  { id: 'razorpay', label: 'Razorpay (India: UPI, cards, netbanking)', region: 'IN',
    methods: ['upi', 'card', 'netbanking'], webhook: true,
    fields: [{ k: 'key_id', secret: false, req: true }, { k: 'key_secret', secret: true, req: true },
             { k: 'webhook_secret', secret: true, req: true }] },
  { id: 'hyperswitch', label: 'Hyperswitch (self-hosted orchestrator)', region: 'any',
    methods: ['card', 'upi', 'wallet'], webhook: false,
    fields: [{ k: 'base_url', secret: false, req: true }, { k: 'profile_id', secret: false, req: false },
             { k: 'api_key', secret: true, req: true }] }
];
const BY_ID = Object.fromEntries(PROVIDERS.map(p => [p.id, p]));
const fp = v => v ? createHash('sha256').update(String(v)).digest('hex').slice(0, 8) : '';

function read() { try { return JSON.parse(readFileSync(P, 'utf8')); } catch { return { providers: {}, order: [], default: '' }; } }
function write(j) {
  mkdirSync(HOME, { recursive: true, mode: 0o700 });
  writeFileSync(P, JSON.stringify(j, null, 2) + '\n', { mode: 0o600 });
  chmodSync(P, 0o600);
}
const CC = v => /^[A-Z]{2}$/.test(String(v || ''));
const CUR = v => /^[A-Z]{3}$/.test(String(v || ''));

export function catalogue() {
  return PROVIDERS.map(p => ({ id: p.id, label: p.label, region: p.region, methods: p.methods, webhook: p.webhook,
    fields: p.fields.map(f => ({ k: f.k, secret: f.secret, req: f.req })) }));
}

/** Public view only. Secret values never leave this module. */
export function list() {
  const j = read();
  return {
    default: j.default || '', order: j.order || [],
    providers: PROVIDERS.map(p => {
      const c = (j.providers || {})[p.id] || null;
      const pub = {}, set = {}, prints = {};
      for (const f of p.fields) {
        if (f.secret) { set[f.k] = Boolean(c && c[f.k]); prints[f.k] = fp(c && c[f.k]); }
        else pub[f.k] = (c && c[f.k]) || '';
      }
      return { id: p.id, label: p.label, configured: Boolean(c), enabled: Boolean(c && c.enabled),
        public: pub, secret_set: set, fingerprints: prints,
        countries: (c && c.countries) || [], currencies: (c && c.currencies) || [], webhook: p.webhook };
    })
  };
}

export function save(id, cfg = {}) {
  const p = BY_ID[String(id || '')];
  if (!p) throw new PayError('unknown provider: ' + id);
  const j = read(); j.providers = j.providers || {};
  const cur = j.providers[p.id] || {};
  const next = { ...cur };
  for (const f of p.fields) {
    const v = cfg[f.k];
    if (v === undefined) { if (f.req && !cur[f.k]) throw new PayError(p.id + ': ' + f.k + ' is required'); continue; }
    const s = String(v || '').trim();
    if (f.req && !s) throw new PayError(p.id + ': ' + f.k + ' is required');
    if (f.secret && s && s.length < 8) throw new PayError(p.id + ': ' + f.k + ' looks too short');
    if (s) next[f.k] = s; else delete next[f.k];
  }
  if (p.id === 'hosted_link' && next.checkout_url) {
    let u; try { u = new URL(next.checkout_url); } catch { throw new PayError('checkout_url is not a URL'); }
    if (u.protocol !== 'https:') throw new PayError('checkout_url must be https');
  }
  if (p.id === 'hyperswitch' && next.base_url) {
    let u; try { u = new URL(next.base_url); } catch { throw new PayError('base_url is not a URL'); }
    const local = ['localhost', '127.0.0.1'].includes(u.hostname);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) throw new PayError('base_url must be https (http only for loopback)');
  }
  if (p.id === 'manual' && next.upi_id && !/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(next.upi_id)) throw new PayError('upi_id must look like name@bank');
  if (cfg.countries !== undefined) {
    const l = (Array.isArray(cfg.countries) ? cfg.countries : []).map(x => String(x).toUpperCase());
    if (l.some(x => !CC(x))) throw new PayError('countries must be ISO-3166 alpha-2 codes');
    next.countries = [...new Set(l)];
  }
  if (cfg.currencies !== undefined) {
    const l = (Array.isArray(cfg.currencies) ? cfg.currencies : []).map(x => String(x).toUpperCase());
    if (l.some(x => !CUR(x))) throw new PayError('currencies must be ISO-4217 codes');
    next.currencies = [...new Set(l)];
  }
  if (cfg.enabled !== undefined) next.enabled = cfg.enabled === true;
  j.providers[p.id] = next;
  if (!Array.isArray(j.order)) j.order = [];
  if (!j.order.includes(p.id)) j.order.push(p.id);
  write(j);
  return list();
}

export function setEnabled(id, on) {
  const j = read(); const c = (j.providers || {})[id];
  if (!c) throw new PayError('provider not configured: ' + id, 404);
  c.enabled = on === true; write(j); return list();
}
export function setDefault(id) {
  const j = read(); const c = (j.providers || {})[id];
  if (!c || !c.enabled) throw new PayError('default must be a configured AND enabled provider');
  j.default = id; write(j); return list();
}
export function setOrder(ids) {
  const list0 = Array.isArray(ids) ? ids.map(String) : [];
  if (list0.some(x => !BY_ID[x])) throw new PayError('unknown provider in order');
  const j = read(); j.order = [...new Set(list0)]; write(j); return list();
}

/** First enabled provider matching country AND currency, in admin order. */
export function route({ country, currency } = {}) {
  const j = read();
  const cc = String(country || '').toUpperCase(), cu = String(currency || '').toUpperCase();
  if (cc && !CC(cc)) throw new PayError('country must be ISO-3166 alpha-2');
  if (cu && !CUR(cu)) throw new PayError('currency must be ISO-4217');
  const order = (j.order && j.order.length ? j.order : PROVIDERS.map(p => p.id));
  for (const id of order) {
    const c = (j.providers || {})[id];
    if (!c || !c.enabled) continue;
    const okC = !cc || !c.countries?.length || c.countries.includes(cc);
    const okU = !cu || !c.currencies?.length || c.currencies.includes(cu);
    if (okC && okU) return { provider: id, matched: true };
  }
  if (j.default && (j.providers || {})[j.default]?.enabled) return { provider: j.default, matched: false, fallback: true };
  throw new PayError('no enabled payment provider matches ' + (cc || '*') + '/' + (cu || '*'), 409);
}

const eq = (a, b) => {
  const x = Buffer.from(String(a), 'utf8'), y = Buffer.from(String(b), 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
};
const hmac = (key, msg) => createHmac('sha256', key).update(msg, 'utf8').digest('hex');

/** Documented schemes only. Stripe: v1 = HMAC(t + '.' + rawBody).
 *  Razorpay webhook: HMAC(rawBody). Anything else refuses. */
export function verifyWebhook(id, headers, rawBody, { now = Date.now(), toleranceSec = 300 } = {}) {
  const p = BY_ID[String(id || '')];
  if (!p) throw new PayError('unknown provider: ' + id);
  if (!p.webhook) throw new PayError(p.id + ' has no documented webhook scheme - do not invent one', 400);
  const c = (read().providers || {})[p.id];
  if (!c || !c.webhook_secret) throw new PayError(p.id + ': webhook_secret not configured', 409);
  const h = Object.fromEntries(Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
  const body = String(rawBody ?? '');
  if (!body) throw new PayError('empty raw body - verify against the RAW bytes, not a re-serialised object');

  if (p.id === 'razorpay') {
    const sig = h['x-razorpay-signature'] || '';
    if (!sig) throw new PayError('missing X-Razorpay-Signature', 401);
    if (!eq(hmac(c.webhook_secret, body), sig)) throw new PayError('razorpay signature mismatch', 401);
    return { ok: true, provider: p.id };
  }
  const hdr = h['stripe-signature'] || '';
  if (!hdr) throw new PayError('missing Stripe-Signature', 401);
  const parts = Object.fromEntries(hdr.split(',').map(s => s.trim().split('=').map(x => x.trim())).filter(a => a.length === 2));
  const t = Number(parts.t);
  if (!Number.isFinite(t)) throw new PayError('Stripe-Signature has no timestamp', 401);
  if (Math.abs(Math.floor(now / 1000) - t) > toleranceSec) throw new PayError('Stripe timestamp outside tolerance - replay refused', 401);
  const expect = hmac(c.webhook_secret, t + '.' + body);
  const offered = hdr.split(',').map(s => s.trim()).filter(s => s.startsWith('v1=')).map(s => s.slice(3));
  if (!offered.some(v => eq(expect, v))) throw new PayError('stripe signature mismatch', 401);
  return { ok: true, provider: p.id, timestamp: t };
}

/** Razorpay checkout handler: HMAC(order_id + '|' + payment_id) with key_secret. */
export function verifyCheckout(id, { order_id, payment_id, signature }) {
  if (id !== 'razorpay') throw new PayError('checkout signature verification is documented for razorpay only');
  const c = (read().providers || {}).razorpay;
  if (!c || !c.key_secret) throw new PayError('razorpay: key_secret not configured', 409);
  if (!order_id || !payment_id || !signature) throw new PayError('order_id, payment_id and signature are required');
  if (!eq(hmac(c.key_secret, order_id + '|' + payment_id), signature)) throw new PayError('checkout signature mismatch', 401);
  return { ok: true };
}

export function remove(id, confirm) {
  if (!BY_ID[id]) throw new PayError('unknown provider: ' + id);
  if (confirm !== id) throw new PayError('confirmation must equal the provider id', 403);
  const j = read();
  delete (j.providers || {})[id];
  j.order = (j.order || []).filter(x => x !== id);
  if (j.default === id) j.default = '';
  write(j);
  return list();
}
export const _hmacForTests = hmac;
