/**
 * Delete verification probe rows from production tables.
 *   node scripts/clean-probes.mjs [--dry-run]
 *
 * SAFETY: the previous predicate was an OR across email domain and full_name,
 * so a genuine lead using @example.com or literally named "Probe" would have
 * been deleted. A probe must now match a RESERVED example domain AND a
 * probe-shaped name or message. Never delete on one weak signal.
 */
import { loadConfig, accessToken } from '../packages/cli/config-store.mjs';
import * as M from '../packages/cli/supabase-mgmt.mjs';

const DRY = process.argv.includes('--dry-run');
const c = loadConfig();
const ref = c.supabase.default_project_ref;
if (!ref || !c.supabase.access_token) { console.log('NOTE no project/token - skipping probe cleanup'); process.exit(0); }
const T = () => accessToken();

// Reserved-for-documentation domains only, AND a probe marker.
const DOMAIN = "(email ilike '%@example.invalid' or email ilike '%@example.com' or email ilike '%@example.org' or email ilike '%@example.net')";
const MARKER = "(full_name ilike 'probe' or message ilike '%probe%')";
const WHERE = DOMAIN + ' and ' + MARKER;
const countSql = 'select count(*)::text as n from public.submissions where ' + WHERE + ';';
const previewSql = 'select id, email, full_name, left(message, 40) as message from public.submissions where ' + WHERE + ' order by created_at desc limit 20;';
const delSql = 'delete from public.submissions where ' + WHERE + ';';

const n = r => (Array.isArray(r) && r[0] && r[0].n) || '0';
let before = '0';
try { before = n(await M.runQuery(T(), ref, countSql, { read_only: true })); }
catch (e) { console.log('NOTE cannot count probes: ' + e.message); process.exit(0); }
console.log('probe rows present: ' + before);
if (before === '0') { console.log('CLEAN OK (nothing to remove)'); process.exit(0); }
try {
  const rows = await M.runQuery(T(), ref, previewSql, { read_only: true });
  console.log('will delete:');
  for (const r of (Array.isArray(rows) ? rows : [])) console.log('  ' + r.email + ' | ' + r.full_name + ' | ' + r.message);
} catch {}
if (DRY) { console.log('DRY RUN - nothing deleted'); process.exit(0); }
try {
  await M.runQuery(T(), ref, delSql);
  const after = n(await M.runQuery(T(), ref, countSql, { read_only: true }));
  console.log('probe rows remaining: ' + after);
  console.log(after === '0' ? 'CLEAN OK' : 'CLEAN BAD');
  process.exit(after === '0' ? 0 : 1);
} catch (e) { console.log('FAIL cleanup: ' + e.message); process.exit(1); }
