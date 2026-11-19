/**
 * Applies the definer-hardening migration through the SAME path the Studio uses,
 * then re-runs the security advisor and reports the before/after object list.
 *   node scripts/harden-apply.mjs [project_ref]
 * The migration is catalog-driven and idempotent; re-running is safe.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, accessToken, reconcileSchema, maskedConfig } from '../packages/cli/config-store.mjs';
import * as M from '../packages/cli/supabase-mgmt.mjs';
import * as DB from '../packages/cli/db-bridge.mjs';

const REPO = process.cwd();
const c = loadConfig();
const ref = process.argv[2] || c.supabase.default_project_ref || '';
if (!ref) { console.error('FAIL no project ref'); process.exit(1); }
if (!c.supabase.access_token) { console.error('FAIL no account token — Studio → Settings → Supabase account'); process.exit(1); }
const T = () => accessToken();
const FILE = '20261119070000_harden_definer.sql';

function summarise(a) {
  const lints = (a && a.lints) || [];
  return lints.map(l => {
    const md = l.metadata || {};
    return { level: l.level, name: l.name, obj: [md.schema, md.entity || md.name].filter(Boolean).join('.') };
  });
}
const ACCEPTED = new Set(['public.portrox_submit', 'public.portrox_book']);

console.log('project: ' + ref);
const before = summarise(await M.securityAdvisor(T(), ref));
console.log('\nBEFORE: ' + before.length + ' security lint(s)');
for (const l of before) console.log('  ' + l.level + '  ' + l.name + '  ' + l.obj);

// Direct probe: can a visitor still reach the helpers via RPC?
const p = c.supabase.projects[ref];
async function rpc(name, body) {
  const r = await fetch(p.url + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: { apikey: p.publishable_key, Authorization: 'Bearer ' + p.publishable_key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  return r.status;
}
console.log('\nRPC reachability BEFORE (404/403 = not exposed):');
for (const n of ['portrox_is_live', 'portrox_is_member', 'rls_auto_enable']) {
  console.log('  ' + n + ' → HTTP ' + await rpc(n, n === 'portrox_is_live' ? { site_id: 'probe' } : {}));
}

const sql = readFileSync(join(REPO, 'supabase/migrations', FILE), 'utf8');
const version = FILE.split('_')[0];
console.log('\napplying ' + FILE + ' (version ' + version + ') …');
const r = await M.applyMigration(T(), ref, FILE.replace(/\.sql$/, ''), sql, version);
if (!r.ok) { console.error('FAIL apply: ' + (r.error || JSON.stringify(r))); process.exit(1); }
console.log('OK   applied via ' + r.via + (r.version_generated ? ' (version recorded)' : ' (version ' + version + ')'));
if (r.version_generated) {
  await M.runQuery(T(), ref,
    "insert into supabase_migrations.schema_migrations (version, statements, name) values ('" + version + "', array['harden_definer'], 'harden_definer') on conflict (version) do nothing;");
}
reconcileSchema(ref, [FILE], 'management-api');

const after = summarise(await M.securityAdvisor(T(), ref));
console.log('\nAFTER: ' + after.length + ' security lint(s)');
for (const l of after) console.log('  ' + l.level + '  ' + l.name + '  ' + l.obj + (ACCEPTED.has(l.obj) ? '   [ACCEPTED]' : '   [UNEXPECTED]'));

console.log('\nRPC reachability AFTER (404/403 = not exposed):');
let leaked = 0;
for (const n of ['portrox_is_live', 'portrox_is_member', 'rls_auto_enable']) {
  const s = await rpc(n, n === 'portrox_is_live' ? { site_id: 'probe' } : {});
  console.log('  ' + n + ' → HTTP ' + s);
  if (s === 200) leaked++;
}

// The intake door must STILL work (unknown site → structured refusal, not 404).
const intake = await rpc('portrox_submit', { p_site: 'does-not-exist', p_kind: 'contact', p_full_name: 'Probe', p_email: 'probe@example.invalid', p_message: 'harden probe' });
console.log('  portrox_submit (intake door) → HTTP ' + intake);

const unexpected = after.filter(l => ACCEPTED.has(l.obj) === false);
let bad = 0;
if (leaked) { console.log('FAIL ' + leaked + ' helper(s) still reachable via RPC'); bad++; }
if (unexpected.length) { console.log('FAIL ' + unexpected.length + ' unexpected lint(s) remain'); bad++; }
if (intake !== 200) { console.log('FAIL intake door broke (HTTP ' + intake + ')'); bad++; }
if (after.length >= before.length) { console.log('NOTE lint count did not drop (' + before.length + ' → ' + after.length + ')'); }
const s = maskedConfig().supabase;
console.log('\nstore: schema_files=' + s.schema_files + ' schema_complete=' + s.schema_complete);
console.log(bad === 0 ? 'HARDEN OK (' + after.length + ' accepted lint(s) remain)' : 'HARDEN BAD=' + bad);
process.exit(bad === 0 ? 0 : 1);
