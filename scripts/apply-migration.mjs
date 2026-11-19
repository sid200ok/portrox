/**
 * Apply one migration through the same transport the Studio uses.
 *   node scripts/apply-migration.mjs <file.sql> [project_ref]
 * Refuses a version already recorded remotely. Records the version explicitly.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { loadConfig, accessToken, reconcileSchema } from '../packages/cli/config-store.mjs';
import * as M from '../packages/cli/supabase-mgmt.mjs';

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/apply-migration.mjs <file.sql> [ref]'); process.exit(1); }
const path = existsSync(file) ? file : join(process.cwd(), 'supabase/migrations', file);
if (existsSync(path) === false) { console.error('FAIL no such file: ' + path); process.exit(1); }
const name = basename(path);
const version = name.split('_')[0];
const c = loadConfig();
const ref = process.argv[3] || c.supabase.default_project_ref;
if (!ref || !c.supabase.access_token) { console.error('FAIL no project or token'); process.exit(1); }
const T = () => accessToken();
let remote = [];
try { remote = ((await M.listMigrations(T(), ref)) || []).map(x => String(x.version || '')); } catch {}
if (remote.includes(version)) { console.log('NOTE version ' + version + ' already recorded - skipping'); process.exit(0); }
const sql = readFileSync(path, 'utf8');
console.log('applying ' + name + ' to ' + ref);
let r;
try { r = await M.applySqlSmart(T(), ref, name.replace(/\.sql$/, ''), sql, version); }
catch (e) { console.error('FAIL threw: ' + String(e.message).split('\n')[0].slice(0, 300)); process.exit(1); }
if (!r || r.ok === false) { console.error('FAIL ' + ((r && r.error) || 'unknown')); process.exit(1); }
reconcileSchema(ref, [name], 'management-api');
console.log('OK   applied via ' + r.via + ' version ' + version);
const perf = await M.performanceAdvisor(T(), ref);
const sec = await M.securityAdvisor(T(), ref);
console.log('performance lints: ' + ((perf.lints || []).length));
console.log('security lints   : ' + ((sec.lints || []).length));
process.exit(0);
