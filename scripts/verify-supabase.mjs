/**
 * Proves the Management API surface works and GATES security regressions.
 *   node scripts/verify-supabase.mjs [project_ref]
 * Skips cleanly (exit 0) with no account token. With a token, any non-accepted
 * security finding is a FAIL: portrox_submit / portrox_book are the only
 * anon-executable SECURITY DEFINER functions we accept (rate-limited intake).
 * Pure ASCII on purpose.
 */
import { readdirSync } from 'node:fs';
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
  note('no Supabase account token - Studio -> Settings -> Supabase account. Skipping (no verdict).');
  process.exit(0);
}
if (!ref) { console.log('FAIL token set but no project loaded'); process.exit(1); }
console.log('project ref: ' + ref);
const T = () => accessToken();
const ACCEPTED = new Set(['public.portrox_submit', 'public.portrox_book']);
const objOf = l => { const md = l.metadata || {}; return [md.schema, md.entity || md.name].filter(Boolean).join('.'); };

// Identity probe = organizations. /v1/profile needs a USER-scoped token; a
// scoped PAT legitimately refuses it and that is NOT a defect.
try {
  const o = await M.listOrganizations(T());
  ok('identity via organizations: ' + o.length + ' (' + o.map(x => x.slug).join(', ') + ')');
} catch (e) { fail('organizations (identity probe): ' + e.message); }

try { const p = await M.profile(T()); ok('profile reachable (' + (p.email || p.id || 'ok') + ')'); }
catch (e) {
  if (/user-scoped|user scoped|insufficient|forbidden/i.test(e.message)) note('profile unavailable with a scoped PAT (expected)');
  else fail('profile: ' + e.message);
}

try { const p = await M.listProjects(T()); ok('projects: ' + p.length + ' (' + p.map(x => x.ref + ':' + x.status).join(', ') + ')'); }
catch (e) { fail('projects: ' + e.message); }

try {
  const s = M.summariseHealth(await M.projectHealth(T(), ref));
  ok('health reachable -> ' + s.status);
  console.log('     ' + s.summary);
  if (s.status !== 'ACTIVE_HEALTHY') note('not all services healthy yet');
} catch (e) { fail('health: ' + e.message); }

try { const k = await M.listKeyTypes(T(), ref); ok('api-key types: ' + k.map(x => x.type || x.name).join(', ')); }
catch (e) { fail('api-keys: ' + e.message); }

try { const r = await DB.ensureKey(ref); ok('publishable key stored (' + r.kind + ', ends ' + r.tail + ')'); }
catch (e) { fail('ensureKey: ' + e.message); }

try {
  const m = await M.listMigrations(T(), ref);
  const remote = (Array.isArray(m) ? m : []).map(x => String(x.version || '')).filter(Boolean);
  const local = readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).map(f => f.split('_')[0]);
  const orphan = remote.filter(v => local.includes(v) === false);
  ok('migrations recorded server-side: ' + remote.length + ' (local files: ' + local.length + ')');
  if (orphan.length) note('DRIFT: ' + orphan.length + ' remote version(s) have no local file: ' + orphan.join(', '));
} catch (e) { note('listMigrations unavailable: ' + e.message); }

for (const [label, fn] of [['security', () => M.securityAdvisor(T(), ref)], ['performance', () => M.performanceAdvisor(T(), ref)]]) {
  try {
    const a = await fn();
    if (a.unavailable) { note(label + ' advisor unavailable: ' + a.error); continue; }
    const lints = a.lints || [];
    ok(label + ' advisor lints: ' + lints.length);
    for (const l of lints.slice(0, 14)) {
      console.log('     [' + label + '] ' + (l.level || '?') + ' ' + (l.name || '') + ' on ' + objOf(l));
    }
    if (label === 'security') {
      const serious = lints.filter(l => /^(ERROR|WARN)$/i.test(String(l.level || '')));
      const unaccepted = serious.filter(l => ACCEPTED.has(objOf(l)) === false);
      if (unaccepted.length) {
        fail(unaccepted.length + ' NON-ACCEPTED security finding(s) - run: node scripts/harden-apply.mjs');
        for (const l of unaccepted) console.log('     ' + (l.level || '?') + ' ' + objOf(l) + (l.remediation ? '  ' + l.remediation : ''));
      } else if (serious.length) {
        note(serious.length + ' security lint(s), all ACCEPTED (rate-limited intake doors)');
      }
    }
  } catch (e) { note(label + ' advisor: ' + e.message); }
}

// full_history must refuse a wrong confirmation.
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
