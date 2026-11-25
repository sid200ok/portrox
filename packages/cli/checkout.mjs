/**
 * Checkout support, honest about what a STATIC site can do.
 *
 * The published site holds only the publishable key and the Studio is loopback
 * only, so stripe/razorpay/hyperswitch CANNOT create orders publicly - they need
 * a server with the secret key. publicOptions() therefore marks them
 * requires_server and exposes no checkout affordance for them. manual and
 * hosted_link work publicly with no secret at all.
 *
 * A visitor reference is a CLAIM. Only the admin may set paid/confirmed, and
 * only to values the appointments_status_check constraint actually allows.
 */
import { loadConfig, accessToken } from './config-store.mjs';
import * as M from './supabase-mgmt.mjs';
import * as PAY from './payment-providers.mjs';

export class CheckoutError extends Error { constructor(m, c) { super(m); this.code = c || 400; } }
export const STATUSES = ['pending', 'paid', 'confirmed', 'cancelled'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SITE = /^[A-Za-z0-9._-]+$/;
const lit = v => "'" + String(v == null ? '' : v).replace(/'/g, "''") + "'";
const rows = r => Array.isArray(r) ? r : [];
function proj() {
  const r = loadConfig().supabase.default_project_ref;
  if (!r || !accessToken()) throw new CheckoutError('no bound project or account token');
  return r;
}
const run = (sql, ro) => M.runQuery(accessToken(), proj(), sql, ro ? { read_only: true } : undefined);

/** PUBLIC-SAFE options for the rendered bundle. No secret ever appears here. */
export function publicOptions() {
  const st = PAY.list();
  const order = st.order && st.order.length ? st.order : st.providers.map(p => p.id);
  const out = [];
  for (const key of order) {
    const p = st.providers.find(x => x.id === key);
    if (!p || !p.enabled) continue;
    const base = p.base || p.id;
    const common = { id: p.id, label: p.label, countries: p.countries || [], currencies: p.currencies || [] };
    if (base === 'manual') {
      out.push({ ...common, kind: 'manual', payee_name: p.public.payee_name || '', upi_id: p.public.upi_id || '', instructions: p.public.instructions || '', requires_server: false });
    } else if (base === 'hosted_link') {
      out.push({ ...common, kind: 'hosted_link', checkout_url: p.public.checkout_url || '', requires_server: false });
    } else {
      out.push({ ...common, kind: base, requires_server: true, note: 'Arranged directly - this gateway needs a server to create an order.' });
    }
  }
  return out;
}

export async function getAppointment(id) {
  if (!UUID.test(String(id || ''))) throw new CheckoutError('invalid appointment id');
  const r = rows(await run('select id, site_id, submission_id, starts_at, duration_minutes, status, payment_ref, created_at from public.appointments where id = ' + lit(String(id).toLowerCase()), true));
  if (!r.length) throw new CheckoutError('no such appointment', 404);
  return r[0];
}

/** Admin-only transition. Refuses any value the DB constraint would reject. */
export async function setStatus(id, status, { confirm } = {}) {
  if (!UUID.test(String(id || ''))) throw new CheckoutError('invalid appointment id');
  const s = String(status || '');
  if (!STATUSES.includes(s)) throw new CheckoutError('status must be one of ' + STATUSES.join(', '));
  const cur = await getAppointment(id);
  if (s === 'paid' && !cur.payment_ref) throw new CheckoutError('cannot mark paid without a payment reference', 409);
  if ((s === 'paid' || s === 'cancelled') && confirm !== s.toUpperCase()) {
    throw new CheckoutError('confirmation must equal ' + s.toUpperCase(), 403);
  }
  const out = rows(await run('update public.appointments set status = ' + lit(s) + ' where id = ' + lit(String(id).toLowerCase()) + ' returning id, status, payment_ref'));
  if (!out.length) throw new CheckoutError('no such appointment', 404);
  return out[0];
}

export async function clearReference(id, confirm) {
  if (!UUID.test(String(id || ''))) throw new CheckoutError('invalid appointment id');
  if (confirm !== 'CLEAR') throw new CheckoutError('confirmation must equal CLEAR', 403);
  // Clearing a reference must not silently un-confirm a free booking. Only a
  // 'paid' state is reverted, and only to 'confirmed'.
  const out = rows(await run("update public.appointments set payment_ref = null, status = case when status = 'paid' then 'confirmed' else status end where id = " + lit(String(id).toLowerCase()) + ' returning id, status, payment_ref'));
  if (!out.length) throw new CheckoutError('no such appointment', 404);
  return out[0];
}
