/**
 * Remove remote migration versions that have NO local file.
 * These are auto-generated timestamps the migrations endpoint assigns even when
 * a version is supplied. Every one of them duplicates a migration that IS
 * recorded canonically, so they are bookkeeping noise, not lost work.
 * SAFETY: refuses to delete anything unless EVERY local version is present
 * remotely - that would mean unapplied work, not noise.
 *   node scripts/reconcile-versions.mjs [--apply]
 */
import { readdirSync } from 'node:fs';
import { loadConfig, accessToken } from '../packages/cli/config-store.mjs';
import * as M from '../packages/cli/supabase-mgmt.mjs';

const c = loadConfig();
const ref = c.supabase.default_project_ref;
if (!ref || !c.supabase.access_token) { console.error('FAIL no project/token'); process.exit(1); }
const T = () => accessToken();
const APPLY = process.argv.includes('--apply');
const local = readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).map(f => f.split('_')[0]).sort();
const remote = ((await M.listMigrations(T(), ref)) || []).map(x => String(x.version || '')).filter(Boolean).sort();
const missing = local.filter(v => remote.includes(v) === false);
const orphan = remote.filter(v => local.includes(v) === false);
console.log('local ' + local.length + ' | remote ' + remote.length + ' | orphan ' + orphan.length);
if (missing.length) { console.error('REFUSING: local versions not applied remotely: ' + missing.join(', ')); process.exit(1); }
if (orphan.length === 0) { console.log('VERSIONS CLEAN'); process.exit(0); }
console.log('orphans: ' + orphan.join(', '));
if (!APPLY) { console.log('DRY RUN - re-run with --apply'); process.exit(0); }
const list = orphan.map(v => "'" + v.replace(/'/g, "''") + "'").join(',');
await M.runQuery(T(), ref, 'delete from supabase_migrations.schema_migrations where version in (' + list + ');');
const after = ((await M.listMigrations(T(), ref)) || []).map(x => String(x.version || '')).filter(Boolean);
const left = after.filter(v => local.includes(v) === false);
console.log('remote now ' + after.length + ' | orphan ' + left.length);
console.log(left.length === 0 ? 'VERSIONS CLEAN' : 'VERSIONS BAD');
process.exit(left.length === 0 ? 0 : 1);
