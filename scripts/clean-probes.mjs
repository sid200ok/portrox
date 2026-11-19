/**
 * Delete verification probe rows from production tables.
 *   node scripts/clean-probes.mjs [--dry-run]
 * verify-rpc --positive inserts a REAL submission on every run, and
 * verify-all.sh runs it. Without cleanup the inbox fills with test leads and
 * the intake rate limiter counts them against real visitors.
 * Matches ONLY probe-shaped rows. Never touches genuine submissions.
 */
import { loadConfig, accessToken } from '../packages/cli/config-store.mjs';
import * as M from '../packages/cli/supabase-mgmt.mjs';

const DRY = process.argv.includes('--dry-run');
const c = loadConfig();
const ref = c.supabase.default_project_ref;
if (!ref || !c.supabase.access_token) { console.log('NOTE no project/token - skipping probe cleanup'); process.exit(0); }
const T = () => accessToken();

const WHERE = "(email ilike '%@example.invalid' or email ilike '%@example.com' or full_name in ('Probe','probe'))";
const countSql = "select count(*)::text as n from public.submissions where " + WHERE + ";";
const delSql = "delete from public.submissions where " + WHERE + ";";

let before = '?';
try {
  const r = await M.runQuery(T(), ref, countSql, { read_only: true });
  before = (Array.isArray(r) && r[0] && r[0].n) || '0';
} catch (e) { console.log('NOTE cannot count probes: ' + e.message); process.exit(0); }
console.log('probe rows present: ' + before);
if (before === '0') { console.log('CLEAN OK (nothing to remove)'); process.exit(0); }
if (DRY) { console.log('DRY RUN - nothing deleted'); process.exit(0); }
try {
  await M.runQuery(T(), ref, delSql);
  const r2 = await M.runQuery(T(), ref, countSql, { read_only: true });
  const after = (Array.isArray(r2) && r2[0] && r2[0].n) || '0';
  console.log('probe rows remaining: ' + after);
  console.log(after === '0' ? 'CLEAN OK' : 'CLEAN BAD');
  process.exit(after === '0' ? 0 : 1);
} catch (e) { console.log('FAIL cleanup: ' + e.message); process.exit(1); }
