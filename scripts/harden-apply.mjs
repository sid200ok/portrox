/**
 * Applies the definer-hardening migration and PROVES the result.
 *   node scripts/harden-apply.mjs [project_ref]
 * - Routes through applySqlSmart (query endpoint) because /database/migrations
 *   strips the do $$ wrapper.
 * - Refuses to re-apply a version already recorded remotely.
 * - Distinguishes PRIVILEGE GRANTED from CURRENTLY REACHABLE.
 * - Never dumps SQL to the terminal on failure.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, accessToken, reconcileSchema, maskedConfig } from '../packages/cli/config-store.mjs';
import * as M from '../packages/cli/supabase-mgmt.mjs';

const REPO = process.cwd();
const c = loadConfig();
const ref = process.argv[2] || c.supabase.default_project_ref || '';
const FILE = '20261119070000_harden_definer.sql';
const VERSION = FILE.split('_')[0];
const ACCEPTED = new Set(['public.portrox_submit', 'public.portrox_book']);
const HELPERS = ['portrox_is_live', 'portrox_is_member', 'rls_auto_enable'];

const ok = m => console.log('OK   ' + m);
const note = m => console.log('NOTE ' + m);
const die = m => { console.error('FAIL ' + m); process.exit(1); };
if (!ref) die('no project ref');
if (!c.supabase.access_token) die('no account token — Studio → Settings → Supabase account');
const T = () => accessToken();
const p = c.supabase.projects[ref];
if (!p) die('unknown project ' + ref);

const summarise = a => ((a && a.lints) || []).map(l => {
  const md = l.metadata || {};
  return { level: l.level, name: l.name, obj: [md.schema, md.entity || md.name].filter(Boolean).join('.') };
});
async function rpc(name, body) {
  try {
    const r = await fetch(p.url + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: { apikey: p.publishable_key, Authorization: 'Bearer ' + p.publishable_key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    return r.status;
  } catch { return 0; }
}
const bodyFor = n => n === 'portrox_is_live' || n === 'portrox_is_member' ? { p_site: 'probe' } : {};

console.log('project: ' + ref);
let remote = [];
try { remote = ((await M.listMigrations(T(), ref)) || []).map(x => String(x.version || '')); }
catch (e) { note('cannot list remote migrations: ' + e.message); }
const already = remote.includes(VERSION);
console.log('remote versions: ' + remote.length + ' | ' + VERSION + ' recorded: ' + already);

const before = summarise(await M.securityAdvisor(T(), ref));
const beforeBad = before.filter(l => ACCEPTED.has(l.obj) === false);
console.log('\nBEFORE: ' + before.length + ' lint(s), ' + beforeBad.length + ' NOT accepted');
for (const l of before) console.log('  ' + l.level + '  ' + l.obj + (ACCEPTED.has(l.obj) ? '  [ACCEPTED]' : '  [TO FIX]'));

console.log('\nRPC BEFORE (404 = not exposed; 200/400 = exposed):');
for (const n of HELPERS) console.log('  ' + n + ' → HTTP ' + await rpc(n, bodyFor(n)));

if (already) {
  note('version already recorded — verifying current state only');
} else {
  const sql = readFileSync(join(REPO, 'supabase/migrations', FILE), 'utf8');
  console.log('\napplying ' + FILE + ' (' + sql.length + 'B) …');
  let r;
  try { r = await M.applySqlSmart(T(), ref, FILE.replace(/\.sql$/, ''), sql, VERSION); }
  catch (e) { die('apply threw: ' + String(e.message).split('\n')[0].slice(0, 300)); }
  if (!r || r.ok === false) die('apply: ' + ((r && r.error) || 'unknown error'));
  ok('applied via ' + r.via + ' (version ' + VERSION + ' recorded)');
}
reconcileSchema(ref, [FILE], 'management-api');

const after = summarise(await M.securityAdvisor(T(), ref));
const afterBad = after.filter(l => ACCEPTED.has(l.obj) === false);
console.log('\nAFTER: ' + after.length + ' lint(s), ' + afterBad.length + ' NOT accepted');
for (const l of after) console.log('  ' + l.level + '  ' + l.obj + (ACCEPTED.has(l.obj) ? '  [ACCEPTED]' : '  [UNEXPECTED]'));

console.log('\nRPC AFTER:');
let leaked = 0;
for (const n of HELPERS) {
  const s = await rpc(n, bodyFor(n));
  console.log('  ' + n + ' → HTTP ' + s);
  if (s === 200 || s === 400) leaked++;
}
const intake = await rpc('portrox_submit', { p_site: 'does-not-exist', p_kind: 'contact', p_full_name: 'Probe', p_email: 'probe@example.invalid', p_message: 'harden probe' });
console.log('  portrox_submit (intake door) → HTTP ' + intake);
let policyOk = false;
try {
  const r = await fetch(p.url + '/rest/v1/system_pages?select=slug&limit=1', { headers: { apikey: p.publishable_key, Authorization: 'Bearer ' + p.publishable_key } });
  policyOk = r.status === 200;
  console.log('  system_pages (RLS evaluation) → HTTP ' + r.status);
} catch {}

let bad = 0;
if (leaked) { console.log('FAIL ' + leaked + ' helper(s) still exposed'); bad++; }
if (afterBad.length) { console.log('FAIL ' + afterBad.length + ' non-accepted lint(s) remain'); bad++; }
if (intake !== 200) { console.log('FAIL intake door broke (HTTP ' + intake + ')'); bad++; }
if (policyOk === false) { console.log('FAIL RLS evaluation broke — helpers unreachable from policies'); bad++; }
const s = maskedConfig().supabase;
console.log('\nstore: schema_files=' + s.schema_files + ' schema_complete=' + s.schema_complete);
console.log(bad === 0 ? 'HARDEN OK (' + after.length + ' accepted lint(s) remain)' : 'HARDEN BAD=' + bad);
process.exit(bad === 0 ? 0 : 1);
