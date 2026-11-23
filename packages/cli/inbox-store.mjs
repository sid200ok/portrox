/**
 * Inbox: read and triage leads and bookings. Studio is the owner, so this uses
 * the Management API admin path - anon has no access to submissions at all.
 *
 * No column assumptions: `kind` is DERIVED from whether an appointment row
 * exists, not read from a column that may not exist. Every interpolated value
 * is validated first (uuid, site id charset, triage/kind allowlist, clamped
 * integer limit), so there is no injection surface.
 */
import { loadConfig, accessToken } from './config-store.mjs';
import * as M from './supabase-mgmt.mjs';

export const TRIAGE = ['new', 'read', 'replied', 'archived'];
export class InboxError extends Error {
  constructor(m, code) { super(m); this.code = code || 400; }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SITE = /^[A-Za-z0-9._-]+$/;

function ref(x) {
  const r = x || loadConfig().supabase.default_project_ref;
  if (!r) throw new InboxError('no project bound');
  if (!accessToken()) throw new InboxError('no Supabase account token');
  return r;
}
const site = s => { if (!SITE.test(String(s || ''))) throw new InboxError('invalid site id'); return String(s); };
const uuid = v => { if (!UUID.test(String(v || ''))) throw new InboxError('invalid id (expected uuid)'); return String(v).toLowerCase(); };
const tri = v => { if (TRIAGE.includes(v) === false) throw new InboxError('invalid triage: ' + v); return v; };
const rows = r => Array.isArray(r) ? r : [];
const run = (r, sql, ro) => M.runQuery(accessToken(), r, sql, ro ? { read_only: true } : undefined);

const SELECT = "select s.id, s.site_id, s.full_name, s.email, left(s.message, 400) as message,"
  + " s.created_at, s.triage, s.triaged_at,"
  + " a.id as appointment_id, a.starts_at, a.duration_minutes, a.status as appointment_status,"
  + " case when a.id is null then 'contact' else 'booking' end as kind"
  + " from public.submissions s left join public.appointments a on a.submission_id = s.id";

export async function listInbox(siteId, { project, kind, triage, limit = 100 } = {}) {
  const r = ref(project), s = site(siteId);
  const n = Math.max(1, Math.min(500, Number(limit) || 100));
  const where = ["s.site_id = '" + s + "'"];
  if (kind === 'contact') where.push('a.id is null');
  else if (kind === 'booking') where.push('a.id is not null');
  else if (kind) throw new InboxError('invalid kind: ' + kind);
  if (triage) where.push("s.triage = '" + tri(triage) + "'");
  const sql = SELECT + ' where ' + where.join(' and ') + ' order by s.created_at desc limit ' + n;
  return rows(await run(r, sql, true));
}

export async function counts(siteId, project) {
  const r = ref(project), s = site(siteId);
  const sql = "select s.triage, case when a.id is null then 'contact' else 'booking' end as kind,"
    + " count(*)::int as n from public.submissions s"
    + " left join public.appointments a on a.submission_id = s.id"
    + " where s.site_id = '" + s + "' group by 1,2 order by 1,2";
  return rows(await run(r, sql, true));
}

export async function setTriage(id, value, project) {
  const r = ref(project), i = uuid(id), v = tri(value);
  const sql = "update public.submissions set triage = '" + v + "', triaged_at = now()"
    + " where id = '" + i + "' returning id, triage, triaged_at";
  const out = rows(await run(r, sql));
  if (out.length === 0) throw new InboxError('no such submission: ' + i, 404);
  return out[0];
}

export async function deleteSubmission(id, confirm, project) {
  const r = ref(project), i = uuid(id);
  if (confirm !== i) throw new InboxError('confirmation must equal the submission id', 403);
  // appointments cascade on submission_id, so the slot is freed too.
  const out = rows(await run(r, "delete from public.submissions where id = '" + i + "' returning id"));
  if (out.length === 0) throw new InboxError('no such submission: ' + i, 404);
  return { deleted: i };
}
