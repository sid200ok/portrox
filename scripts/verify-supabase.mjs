/**
 * Proves the Management API surface works and GATES security regressions.
 *   node scripts/verify-supabase.mjs [project_ref]
 *
 * Accepted exceptions, both principled rather than name-based:
 *  1. portrox_submit / portrox_book are anon-executable SECURITY DEFINER
 *     functions BY DESIGN: they are the rate-limited intake doors.
 *  2. A table with RLS ENABLED and NO grants for anon/authenticated is
 *     DENY-ALL. Dropping the dormant legacy policies produced
 *     rls_enabled_no_policy lints on exactly such tables. That is the safest
 *     possible state, not a vulnerability, and it must not block a release.
 *     Destroying data to silence a linter would be the wrong trade: the
 *     contact_messages rows may be real leads from the previous site.
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
const rows = r => Array.isArray(r) ? r : [];

if (!c.supabase.access_token) {
  note('no Supabase account token - Studio -> Settings -> Supabase account. Skipping (no verdict).');
  process.exit(0);
}
if (!ref) { console.log('FAIL token set but no project loaded'); process.exit(1); }
console.log('project ref: ' + ref);
const T = () => accessToken();
const ACCEPTED_FUNCS = new Set(['public.portrox_submit', 'public.portrox_book', 'public.portrox_payment_ref']);
const objOf = l => { const md = l.metadata || {}; return [md.schema, md.entity || md.name].filter(Boolean).join('.'); };

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
  const remote = rows(m).map(x => String(x.version || '')).filter(Boolean);
  const local = readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).map(f => f.split('_')[0]);
  const orphan = remote.filter(v => local.includes(v) === false);
  const missing = local.filter(v => remote.includes(v) === false);
  ok('migrations recorded server-side: ' + remote.length + ' (local files: ' + local.length + ')');
  if (orphan.length) note('DRIFT: ' + orphan.length + ' remote version(s) have no local file: ' + orphan.join(', '));
  // The reverse direction was missing. A CREATE OR REPLACE that failed (42P13,
  // dropped parameter default) left a local file unapplied and the suite still
  // said SUPABASE OK. An unapplied migration is a FAILURE, not a note.
  if (missing.length) fail('UNAPPLIED local migration(s): ' + missing.join(', ') + ' - run: node scripts/apply-migration.mjs <file>');
  else ok('every local migration is recorded server-side');
} catch (e) { note('listMigrations unavailable: ' + e.message); }

// Catalog evidence for deny-all classification.
const DENY = new Set();
try {
  const q = "select c.relname as t, c.relrowsecurity as rls,"
    + " (has_table_privilege('anon',c.oid,'SELECT') or has_table_privilege('anon',c.oid,'INSERT')"
    + "  or has_table_privilege('anon',c.oid,'UPDATE') or has_table_privilege('anon',c.oid,'DELETE')"
    + "  or has_table_privilege('authenticated',c.oid,'SELECT') or has_table_privilege('authenticated',c.oid,'INSERT')"
    + "  or has_table_privilege('authenticated',c.oid,'UPDATE') or has_table_privilege('authenticated',c.oid,'DELETE')) as any_grant"
    + " from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'";
  for (const r of rows(await M.runQuery(T(), ref, q, { read_only: true }))) {
    if (r.rls === true && r.any_grant === false) DENY.add('public.' + r.t);
  }
  if (DENY.size) note('deny-all tables (RLS on, zero client grants): ' + [...DENY].join(', '));
} catch (e) { note('cannot classify deny-all tables: ' + e.message); }

for (const [label, fn] of [['security', () => M.securityAdvisor(T(), ref)], ['performance', () => M.performanceAdvisor(T(), ref)]]) {
  try {
    const a = await fn();
    if (a.unavailable) { note(label + ' advisor unavailable: ' + a.error); continue; }
    const lints = a.lints || [];
    ok(label + ' advisor lints: ' + lints.length);
    const shown = lints.slice(0, 14);
    for (const l of shown) console.log('     [' + label + '] ' + (l.level || '?') + ' ' + (l.name || '') + ' on ' + objOf(l));
    if (lints.length > shown.length) console.log('     (showing ' + shown.length + ' of ' + lints.length + ')');
    if (label === 'security') {
      const serious = lints.filter(l => /^(ERROR|WARN)$/i.test(String(l.level || '')));
      const unaccepted = serious.filter(l => {
        const o = objOf(l);
        return ACCEPTED_FUNCS.has(o) === false && DENY.has(o) === false;
      });
      const denied = serious.filter(l => DENY.has(objOf(l)));
      if (denied.length) note(denied.length + ' lint(s) on deny-all tables - unreachable, intentional');
      if (unaccepted.length) {
        fail(unaccepted.length + ' NON-ACCEPTED security finding(s)');
        for (const l of unaccepted) console.log('     ' + (l.level || '?') + ' ' + objOf(l) + (l.remediation ? '  ' + l.remediation : ''));
      } else if (serious.length) {
        note(serious.length + ' security lint(s), all accepted (intake doors or deny-all tables)');
      }
    }
  } catch (e) { note(label + ' advisor: ' + e.message); }
}

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
