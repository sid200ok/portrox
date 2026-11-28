/**
 * Site intake state: pause and resume, with the effect PROVEN, not assumed.
 *
 * WHAT PAUSE MEANS
 *   sites.is_published = false. That is already the enforcement point:
 *   portrox_submit returns unknown_site and portrox_book returns
 *   site_not_published. No migration, no new RPC, no GitHub Pages mutation.
 *
 * WHAT PAUSE DOES NOT MEAN
 *   It does NOT unpublish the page. GitHub Pages keeps serving the artifact, and
 *   verify-github deliberately refuses pagesDisable. Pausing closes the DOOR,
 *   not the shop window. Calling this "unpublish" would be a lie.
 *
 * KNOWN INTERACTION
 *   publish-site.mjs sets is_published = true. Publishing therefore REOPENS
 *   intake. That is proven by the gate rather than discovered in production.
 *
 * SAFETY
 *   Every mutation requires confirm === siteId, matching the project convention
 *   for destructive actions. Every write is read back. resume() refuses to
 *   reopen a site that is not registered.
 */
import { loadConfig, accessToken } from './config-store.mjs';
import * as M from './supabase-mgmt.mjs';

export class SiteStateError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const lit = s => {
  const v = String(s);
  if (v.includes('$px$')) throw new SiteStateError('payload contains the dollar-quote tag', 400);
  return '$px$' + v + '$px$';
};
const idOk = id => typeof id === 'string' && /^[a-z0-9][a-z0-9.-]{2,120}$/.test(id);

function conn() {
  const c = loadConfig();
  const ref = c.supabase.default_project_ref;
  if (!ref || !c.supabase.access_token) throw new SiteStateError('Supabase account not configured in the Studio', 412);
  return { ref, q: (sql, ro) => M.runQuery(accessToken(), ref, sql, ro ? { read_only: true } : undefined) };
}

/** Current row, or a clear error. Never invents a default. */
export async function readState(siteId) {
  if (!idOk(siteId)) throw new SiteStateError('invalid site id', 400);
  const { q } = conn();
  const rows = await q('select id, is_published from public.sites where id = ' + lit(siteId), true);
  if (!Array.isArray(rows) || rows.length === 0) throw new SiteStateError('site is not registered in the database: ' + siteId, 404);
  return { id: rows[0].id, is_published: rows[0].is_published === true, intake: rows[0].is_published === true ? 'open' : 'paused' };
}

async function write(siteId, value, confirm) {
  if (!idOk(siteId)) throw new SiteStateError('invalid site id', 400);
  if (confirm !== siteId) throw new SiteStateError('confirmation must equal the site id', 403);
  const before = await readState(siteId);
  if (before.is_published === value) return { changed: false, before, after: before };
  const { q } = conn();
  await q('update public.sites set is_published = ' + (value ? 'true' : 'false') + ' where id = ' + lit(siteId));
  const after = await readState(siteId);
  if (after.is_published !== value) throw new SiteStateError('write did not take effect - read-back disagrees', 500);
  return { changed: true, before, after };
}

/** Close the intake door. The page keeps being served. */
export async function pause(siteId, confirm) {
  const r = await write(siteId, false, confirm);
  return { ...r, intake: 'paused', note: 'the page is still served by GitHub Pages; only intake is closed' };
}

/** Reopen the intake door. Publishing also does this, deliberately. */
export async function resume(siteId, confirm) {
  const r = await write(siteId, true, confirm);
  return { ...r, intake: 'open' };
}
