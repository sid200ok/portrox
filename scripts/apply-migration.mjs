/**
 * Apply one migration through the same transport the Studio uses, then PROVE
 * its effect from the catalog. raise notice output is discarded by the query
 * endpoint, and Supabase advisors are eventually consistent, so neither is
 * acceptable as proof.
 *   node scripts/apply-migration.mjs <file.sql> [project_ref]
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

const POLICY_SQL = "select policyname, tablename, (coalesce(qual,'') || ' ' || coalesce(with_check,'')) like '%select auth.uid()%' as wrapped, (coalesce(qual,'') || ' ' || coalesce(with_check,'')) like '%auth.uid()%' as uses from pg_policies where schemaname='public' order by tablename, policyname";
const FK_SQL = "select count(*)::text as n from pg_constraint c join pg_class r on r.oid=c.conrelid join pg_namespace ns on ns.oid=r.relnamespace where c.contype='f' and ns.nspname='public' and not exists (select 1 from pg_index i where i.indrelid=c.conrelid and (i.indkey::smallint[])[0:array_length(c.conkey,1)-1]=c.conkey)";

async function state(label) {
  let bare = [], unindexed = '?';
  try {
    const rows = await M.runQuery(T(), ref, POLICY_SQL, { read_only: true });
    bare = (Array.isArray(rows) ? rows : []).filter(r => r.uses && !r.wrapped);
  } catch (e) { console.log('NOTE policy audit: ' + e.message); }
  try {
    const r = await M.runQuery(T(), ref, FK_SQL, { read_only: true });
    unindexed = (Array.isArray(r) && r[0] && r[0].n) || '0';
  } catch (e) { console.log('NOTE fk audit: ' + e.message); }
  console.log(label + ' policies with bare auth.uid(): ' + bare.length + ' | unindexed FKs: ' + unindexed);
  for (const b of bare) console.log('     bare: ' + b.tablename + '.' + b.policyname);
  return { bare: bare.length, unindexed: String(unindexed) };
}

let remote = [];
try { remote = ((await M.listMigrations(T(), ref)) || []).map(x => String(x.version || '')); } catch {}
const already = remote.includes(version);
console.log('migration ' + name + ' | version ' + version + ' recorded: ' + already);
const before = await state('BEFORE');
if (already) {
  console.log('NOTE already recorded - verifying current state only');
} else {
  const sql = readFileSync(path, 'utf8');
  let r;
  try { r = await M.applySqlSmart(T(), ref, name.replace(/\.sql$/, ''), sql, version); }
  catch (e) { console.error('FAIL threw: ' + String(e.message).split('\n')[0].slice(0, 300)); process.exit(1); }
  if (!r || r.ok === false) { console.error('FAIL ' + ((r && r.error) || 'unknown')); process.exit(1); }
  reconcileSchema(ref, [name], 'management-api');
  console.log('OK   applied via ' + r.via);
}
const after = await state('AFTER ');
const perf = await M.performanceAdvisor(T(), ref);
const sec = await M.securityAdvisor(T(), ref);
console.log('advisor performance lints: ' + ((perf.lints || []).length) + ' (eventually consistent, may lag)');
console.log('advisor security lints   : ' + ((sec.lints || []).length));
const perfNames = {};
for (const l of (perf.lints || [])) perfNames[l.name] = (perfNames[l.name] || 0) + 1;
console.log('perf breakdown: ' + JSON.stringify(perfNames));
let bad = 0;
if (Number(after.bare) > 0) { console.log('FAIL ' + after.bare + ' policy(s) still call auth.uid() per row'); bad++; }
if (after.unindexed !== '0') { console.log('FAIL ' + after.unindexed + ' FK(s) still unindexed'); bad++; }
console.log(bad === 0 ? 'MIGRATION VERIFIED' : 'MIGRATION BAD=' + bad);
process.exit(bad === 0 ? 0 : 1);
