/**
 * One-time, idempotent maintenance:
 *  1. Persist the normalized multi-project config shape to disk (normalize() is
 *     read-only, so raw readers like preflight previously saw the legacy shape).
 *  2. Give every site.json an EXPLICIT database binding, so changing the default
 *     project can never silently repoint a site.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, saveConfig, maskedConfig, publicSupabaseFor } from '../packages/cli/config-store.mjs';

const before = existsSync(process.env.PORTROX_HOME ? join(process.env.PORTROX_HOME,'config.json') : join(process.env.HOME,'.portrox','config.json'))
  ? readFileSync(join(process.env.PORTROX_HOME || join(process.env.HOME,'.portrox'),'config.json'),'utf8') : '';
const c = loadConfig();
saveConfig(c);
const after = readFileSync(join(process.env.PORTROX_HOME || join(process.env.HOME,'.portrox'),'config.json'),'utf8');
console.log(before === after ? 'OK   config already normalized' : 'OK   config normalized and persisted');

const def = c.supabase.default_project_ref || '';
const sitesDir = 'sites';
let changed = 0;
for (const id of readdirSync(sitesDir)) {
  const p = join(sitesDir, id, 'site.json');
  if (existsSync(p) === false) continue;
  const cfg = JSON.parse(readFileSync(p, 'utf8'));
  const had = Boolean(cfg.database && cfg.database.project_ref);
  if (had === false) {
    if (!def) { console.log('MISS ' + id + ': no default project to bind — connect the account first'); continue; }
    cfg.database = { mode: 'shared', project_ref: def };
    changed++;
    console.log('OK   ' + id + ': bound explicitly to ' + def + ' (mode=shared)');
  } else {
    console.log('OK   ' + id + ': already bound to ' + cfg.database.project_ref);
  }
  const resolved = publicSupabaseFor(cfg.database.project_ref);
  cfg.supabase = resolved;
  writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n');
  console.log('     resolved url = ' + (resolved.url || '(none)') + ' · forms=' + (resolved.url ? 'on' : 'off'));
}
const m = maskedConfig().supabase;
console.log('\nprojects=' + m.project_count + ' default=' + (m.project_ref||'-') + ' ready=' + m.project_ready + ' schema_files=' + m.schema_files);
console.log(changed === 0 ? 'STORE MIGRATED (no binding changes)' : 'STORE MIGRATED (' + changed + ' site(s) bound)');
