/**
 * Proves the Management API surface works. Read-only except the key fetch.
 *   node scripts/verify-supabase.mjs [project_ref]
 * Skips cleanly (exit 0) with no account token; FAILS loudly once one is set.
 */
import { loadConfig, maskedConfig, accessToken } from '../packages/cli/config-store.mjs';
import * as M from '../packages/cli/supabase-mgmt.mjs';
import * as DB from '../packages/cli/db-bridge.mjs';

const c = loadConfig();
const ref = process.argv[2] || c.supabase.default_project_ref || Object.keys(c.supabase.projects)[0] || '';
let bad = 0;
const ok = m => console.log('OK   ' + m);
const fail = m => { bad++; console.log('FAIL ' + m); };
const note = m => console.log('NOTE ' + m);

if (!c.supabase.access_token) {
  note('no Supabase account token — Studio → Settings → Supabase account. Skipping (no verdict).');
  process.exit(0);
}
if (!ref) { console.log('FAIL token set but no project loaded'); process.exit(1); }
console.log('project ref: ' + ref);
const T = () => accessToken();

try { const p = await M.profile(T()); ok('profile reachable (' + (p.email || p.id || 'ok') + ')'); }
catch (e) { fail('profile: ' + e.message); }

try { const o = await M.listOrganizations(T()); ok('organizations: ' + o.length + ' (' + o.map(x => x.slug).join(', ') + ')'); }
catch (e) { fail('organizations: ' + e.message); }

try { const p = await M.listProjects(T()); ok('projects: ' + p.length + ' (' + p.map(x => x.ref + ':' + x.status).join(', ') + ')'); }
catch (e) { fail('projects: ' + e.message); }

// This is the call that previously returned "At least one element is required".
try {
  const s = M.summariseHealth(await M.projectHealth(T(), ref));
  ok('health reachable → ' + s.status);
  console.log('     ' + s.summary);
  if (s.status !== 'ACTIVE_HEALTHY') note('not all services healthy yet');
} catch (e) { fail('health: ' + e.message); }

try { const k = await M.listKeyTypes(T(), ref); ok('api-key types: ' + k.map(x => x.type || x.name).join(', ')); }
catch (e) { fail('api-keys: ' + e.message); }

try { const r = await DB.ensureKey(ref); ok('publishable key stored (' + r.kind + ', ends ·' + r.tail + ')'); }
catch (e) { fail('ensureKey: ' + e.message); }

try {
  const m = await M.listMigrations(T(), ref);
  ok('migrations recorded server-side: ' + (Array.isArray(m) ? m.length : 0));
} catch (e) { note('listMigrations unavailable: ' + e.message); }

for (const [label, fn] of [['security', () => M.securityAdvisor(T(), ref)], ['performance', () => M.performanceAdvisor(T(), ref)]]) {
  try {
    const a = await fn();
    if (a.unavailable) note(label + ' advisor unavailable: ' + a.error);
    else ok(label + ' advisor lints: ' + ((a.lints || []).length));
  } catch (e) { note(label + ' advisor: ' + e.message); }
}

// full_history must refuse without a matching confirmation.
try {
  await M.applySchema(T(), ref, process.cwd(), { full_history: true, confirm: 'wrong' });
  fail('full_history did NOT refuse a wrong confirmation');
} catch (e) {
  /confirm/i.test(e.message) ? ok('full_history gate refused') : fail('full_history wrong error: ' + e.message);
}

const s = maskedConfig().supabase;
console.log('store: ready=' + s.project_ready + ' healthy=' + s.db_ok + ' schema_complete=' + s.schema_complete + ' files=' + s.schema_files);
console.log('\n' + (bad === 0 ? 'SUPABASE OK' : 'SUPABASE BAD=' + bad));
process.exit(bad === 0 ? 0 : 1);
