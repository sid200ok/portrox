/**
 * Application-level logical backup of every public table.
 *   node scripts/backup-db.mjs [project_ref]
 * WHY: Supabase Free has no PITR. submissions holds real leads and appointments
 * holds bookings. clean-probes.mjs already DELETEs in production. Schema is
 * recoverable from supabase/migrations; DATA is not, until now.
 * Uses the account PAT via the Management API, so no DB password is needed.
 * Output contains PII: directory 0700, files 0600, and backups/ is gitignored.
 * Restore = re-apply migrations, then INSERT the JSON rows (restore script next).
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, accessToken } from '../packages/cli/config-store.mjs';
import * as M from '../packages/cli/supabase-mgmt.mjs';

const c = loadConfig();
const ref = process.argv[2] || c.supabase.default_project_ref;
if (!ref || !c.supabase.access_token) { console.error('FAIL no project or account token'); process.exit(1); }
const T = () => accessToken();
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dir = join(process.cwd(), 'backups', ref, stamp);
mkdirSync(dir, { recursive: true, mode: 0o700 });

const gi = join(process.cwd(), '.gitignore');
const cur = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
if (!/^backups\/$/m.test(cur)) appendFileSync(gi, (cur.endsWith('\n') || !cur ? '' : '\n') + 'backups/\n');

const TABLES_SQL = "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name";
let tables = [];
try {
  const r = await M.runQuery(T(), ref, TABLES_SQL, { read_only: true });
  tables = (Array.isArray(r) ? r : []).map(x => String(x.table_name || '')).filter(Boolean);
} catch (e) { console.error('FAIL cannot list tables: ' + e.message); process.exit(1); }
if (tables.length === 0) { console.error('FAIL no public tables found'); process.exit(1); }
console.log('project ' + ref + ' | ' + tables.length + ' tables -> ' + dir);

const manifest = { project: ref, taken_at: new Date().toISOString(), tables: {} };
let bad = 0;
for (const t of tables) {
  if (/^[a-z_][a-z0-9_]*$/.test(t) === false) { console.log('SKIP unsafe table name: ' + t); continue; }
  const sql = 'select coalesce(json_agg(x), \'[]\'::json)::text as data from public."' + t + '" x';
  try {
    const r = await M.runQuery(T(), ref, sql, { read_only: true });
    const raw = (Array.isArray(r) && r[0] && r[0].data) || '[]';
    const rows = JSON.parse(raw);
    writeFileSync(join(dir, t + '.json'), JSON.stringify(rows, null, 2) + '\n', { mode: 0o600 });
    manifest.tables[t] = rows.length;
    console.log('OK   ' + t + ': ' + rows.length + ' rows');
  } catch (e) { console.log('FAIL ' + t + ': ' + String(e.message).split('\n')[0].slice(0, 160)); bad++; }
}
try {
  const migs = await M.listMigrations(T(), ref);
  manifest.migrations = (Array.isArray(migs) ? migs : []).map(x => String(x.version || ''));
} catch {}
writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
const total = Object.values(manifest.tables).reduce((a, b) => a + b, 0);
console.log('\ntotal rows: ' + total + ' | manifest written | backups/ gitignored');
console.log(bad === 0 ? 'BACKUP OK' : 'BACKUP BAD=' + bad);
process.exit(bad === 0 ? 0 : 1);
