/**
 * Prove a backup is RESTORABLE without touching production.
 *   node scripts/restore-db.mjs [--from <backup-dir>] [--keep]
 * Method: create a scratch schema, clone each table's structure WITH NO DATA,
 * load the backup JSON via json_populate_recordset (so Postgres does all type
 * coercion), compare row counts to the manifest, then DROP the schema.
 * A backup you cannot restore is not a backup. Production is never written.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, accessToken } from '../packages/cli/config-store.mjs';
import * as M from '../packages/cli/supabase-mgmt.mjs';

const c = loadConfig();
const ref = c.supabase.default_project_ref;
if (!ref || !c.supabase.access_token) { console.error('FAIL no project or token'); process.exit(1); }
const T = () => accessToken();
const KEEP = process.argv.includes('--keep');
const SCRATCH = 'portrox_restore_test';
const argFrom = (() => { const i = process.argv.indexOf('--from'); return i > 0 ? process.argv[i + 1] : ''; })();

function latestBackup() {
  const base = join(process.cwd(), 'backups', ref);
  if (existsSync(base) === false) return '';
  const dirs = readdirSync(base).filter(d => existsSync(join(base, d, 'manifest.json'))).sort();
  return dirs.length ? join(base, dirs[dirs.length - 1]) : '';
}
const dir = argFrom || latestBackup();
if (!dir || existsSync(join(dir, 'manifest.json')) === false) { console.error('FAIL no backup found - run scripts/backup-db.mjs'); process.exit(1); }
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
console.log('backup: ' + dir);
console.log('taken : ' + manifest.taken_at);

let bad = 0;
const ok = m => console.log('OK   ' + m);
const fail = m => { bad++; console.log('FAIL ' + m); };
const rows = r => Array.isArray(r) ? r : [];
const run = async sql => M.runQuery(T(), ref, sql);

try {
  await run('drop schema if exists ' + SCRATCH + ' cascade; create schema ' + SCRATCH + ';');
  ok('scratch schema created (production untouched)');
  for (const [t, expected] of Object.entries(manifest.tables || {})) {
    if (/^[a-z_][a-z0-9_]*$/.test(t) === false) { fail('unsafe table name in manifest: ' + t); continue; }
    const file = join(dir, t + '.json');
    if (existsSync(file) === false) { fail(t + ': backup file missing'); continue; }
    let data;
    try { data = JSON.parse(readFileSync(file, 'utf8')); }
    catch (e) { fail(t + ': backup JSON unparseable'); continue; }
    if (!Array.isArray(data)) { fail(t + ': backup is not an array'); continue; }
    try {
      await run('create table ' + SCRATCH + '."' + t + '" as table public."' + t + '" with no data;');
      if (data.length) {
        const json = JSON.stringify(data);
        if (json.includes('$json$')) { fail(t + ': payload contains the dollar tag - refusing'); continue; }
        await run('insert into ' + SCRATCH + '."' + t + '" select * from json_populate_recordset(null::' + SCRATCH + '."' + t + '", $json$' + json + '$json$::json);');
      }
      const r = rows(await run('select count(*)::text as n from ' + SCRATCH + '."' + t + '"'));
      const got = Number((r[0] && r[0].n) || 0);
      if (got === Number(expected)) ok(t + ': restored ' + got + '/' + expected + ' rows');
      else fail(t + ': restored ' + got + ' rows, manifest says ' + expected);
    } catch (e) { fail(t + ': ' + String(e.message).split('\n')[0].slice(0, 180)); }
  }
} finally {
  if (KEEP) console.log('NOTE scratch schema kept for inspection: ' + SCRATCH);
  else { try { await run('drop schema if exists ' + SCRATCH + ' cascade;'); ok('scratch schema dropped'); } catch (e) { fail('could not drop scratch schema: ' + e.message); } }
}
console.log('\n' + (bad === 0 ? 'RESTORE PROVEN' : 'RESTORE BAD=' + bad));
process.exit(bad === 0 ? 0 : 1);
