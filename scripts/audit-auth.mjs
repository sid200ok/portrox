/**
 * The authenticated attack surface.
 *
 * Corrections vs the first version:
 *  - The API field is disable_signup (INVERTED: true means signup CLOSED), not
 *    enable_signup. Looking for the wrong name produced a neutral NOTE and left
 *    the most important question unanswered.
 *  - external_anonymous_users_enabled mints an authenticated session with NO
 *    signup at all. That is a second door and was never checked.
 *  - Policy analysis is now GRANT-AWARE. A policy on a table with no grants is
 *    DORMANT, not an open hole. The previous version reported two false FAILs on
 *    tables whose grants had already been revoked.
 *
 * Findings so far: every Portrox write policy is guarded by
 * portrox_private.portrox_is_member(site_id) or sites.owner_id = auth.uid().
 * site_members requires OWNERSHIP, not self-identity, and owner_id is NULL for
 * this site, so self-service membership escalation is not possible.
 *
 *   node scripts/audit-auth.mjs [--harden]
 */
import { loadConfig, accessToken } from '../packages/cli/config-store.mjs';
import * as M from '../packages/cli/supabase-mgmt.mjs';

const c = loadConfig();
const ref = c.supabase.default_project_ref;
if (!ref || !c.supabase.access_token) { console.log('NOTE no project/token - skipping'); process.exit(0); }
const T = () => accessToken();
const HARDEN = process.argv.includes('--harden');
let bad = 0;
const ok = m => console.log('OK   ' + m);
const fail = m => { bad++; console.log('FAIL ' + m); };
const note = m => console.log('NOTE ' + m);
const rows = r => Array.isArray(r) ? r : [];

async function authConfig(method, body) {
  const r = await fetch('https://api.supabase.com/v1/projects/' + encodeURIComponent(ref) + '/config/auth', {
    method: method || 'GET',
    headers: { Authorization: 'Bearer ' + T(), Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) throw new Error('auth config HTTP ' + r.status + ': ' + ((j && (j.message || j.error)) || t.slice(0, 160)));
  return j || {};
}

console.log('-- who can become authenticated --');
let cfg = null;
try {
  cfg = await authConfig('GET');
  const disableSignup = cfg.disable_signup;
  const anonUsers = cfg.external_anonymous_users_enabled;
  const providers = Object.keys(cfg).filter(k => /^external_.*_enabled$/.test(k) && cfg[k] === true && k !== 'external_anonymous_users_enabled');
  console.log('     disable_signup=' + disableSignup + '  anonymous_users=' + anonUsers);
  console.log('     enabled providers: ' + (providers.join(', ') || '(none)'));

  const signupOpen = disableSignup === false;
  if (signupOpen) fail('SIGNUP IS OPEN (disable_signup=false) - anyone can become authenticated');
  else if (disableSignup === true) ok('signup is closed');
  else fail('disable_signup is absent or not boolean - cannot determine exposure');

  if (anonUsers === true) fail('ANONYMOUS sign-in is enabled - authenticated sessions without any signup');
  else if (anonUsers === false) ok('anonymous sign-in is disabled');
  else note('external_anonymous_users_enabled absent');

  if (HARDEN && (signupOpen || anonUsers === true)) {
    await authConfig('PATCH', { disable_signup: true, external_anonymous_users_enabled: false });
    const after = await authConfig('GET');
    console.log('     after PATCH: disable_signup=' + after.disable_signup + ' anonymous_users=' + after.external_anonymous_users_enabled);
    if (after.disable_signup === true && after.external_anonymous_users_enabled === false) {
      ok('both doors CLOSED'); bad = 0;
    } else fail('hardening did not take effect');
  }
} catch (e) { fail('cannot read auth config: ' + e.message); }

console.log('\n-- write policies, correlated with actual grants --');
const PRIV_SQL = "select c.relname as t,"
  + " has_table_privilege('anon',c.oid,'INSERT') as a_i, has_table_privilege('anon',c.oid,'UPDATE') as a_u, has_table_privilege('anon',c.oid,'DELETE') as a_d,"
  + " has_table_privilege('authenticated',c.oid,'INSERT') as u_i, has_table_privilege('authenticated',c.oid,'UPDATE') as u_u, has_table_privilege('authenticated',c.oid,'DELETE') as u_d"
  + " from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'";
const POL_SQL = "select tablename, policyname, cmd, roles::text as roles, coalesce(qual,'') as qual, coalesce(with_check,'') as wc"
  + " from pg_policies where schemaname='public' and cmd in ('INSERT','UPDATE','DELETE','ALL') order by tablename, policyname";
try {
  const grants = {};
  for (const g of rows(await M.runQuery(T(), ref, PRIV_SQL, { read_only: true }))) grants[g.t] = g;
  const pols = rows(await M.runQuery(T(), ref, POL_SQL, { read_only: true }));
  if (pols.length === 0) ok('no write policies at all');
  let dormant = 0, live = 0;
  for (const p of pols) {
    const g = grants[p.tablename] || {};
    const roleList = String(p.roles || '').replace(/[{}]/g, '').split(',').map(s => s.trim());
    const needs = p.cmd === 'ALL' ? ['i', 'u', 'd'] : [{ INSERT: 'i', UPDATE: 'u', DELETE: 'd' }[p.cmd]];
    const reachable = roleList.some(r => {
      const pre = r === 'anon' ? 'a_' : r === 'authenticated' ? 'u_' : null;
      if (!pre) return r === 'public';
      return needs.some(n => g[pre + n] === true);
    });
    const expr = (p.qual + ' ' + p.wc).trim();
    const guarded = /auth\.uid\(\)|is_member|is_owner|studio_owner|owner_id/i.test(expr);
    if (!reachable) { dormant++; console.log('     DORMANT ' + p.tablename + '.' + p.policyname + ' (no grant)'); continue; }
    live++;
    if (!guarded) fail('REACHABLE UNGUARDED write policy ' + p.tablename + '.' + p.policyname + ' (' + p.cmd + ') expr=' + (expr || '(none)'));
    else console.log('     guarded ' + p.tablename.padEnd(18) + p.policyname.padEnd(30) + p.cmd.padEnd(7) + expr.slice(0, 80));
  }
  ok(pols.length + ' write policies examined: ' + live + ' reachable, ' + dormant + ' dormant');
  if (dormant) note(dormant + ' dormant policy/policies - drop them so a future re-grant cannot reopen a hole');
} catch (e) { fail('policy/grant correlation failed: ' + e.message); }

console.log('\n-- site_members self-service escalation --');
try {
  const list = rows(await M.runQuery(T(), ref,
    "select policyname, cmd, coalesce(with_check,'') as wc, coalesce(qual,'') as qual from pg_policies where schemaname='public' and tablename='site_members'",
    { read_only: true }));
  if (list.length === 0) note('site_members has no policies - grants are inert');
  for (const p of list) {
    const expr = p.qual + ' ' + p.wc;
    const ownerGuarded = /owner_id/i.test(expr);
    if (p.cmd === 'INSERT' && !ownerGuarded && /auth\.uid\(\)/i.test(expr)) fail('site_members INSERT allows SELF-membership: ' + expr.slice(0, 140));
    else console.log('     ' + p.policyname + ' ' + p.cmd + (ownerGuarded ? ' owner-guarded' : '') + ' ' + expr.slice(0, 100));
  }
  const n = rows(await M.runQuery(T(), ref, 'select count(*)::text as n from public.site_members', { read_only: true }));
  const o = rows(await M.runQuery(T(), ref, "select count(*)::text as n from public.sites where owner_id is not null", { read_only: true }));
  console.log('     members: ' + ((n[0] && n[0].n) || '0') + ' | sites with a non-null owner_id: ' + ((o[0] && o[0].n) || '0'));
} catch (e) { note('site_members check: ' + e.message); }

console.log('\n' + (bad === 0 ? 'AUTH AUDIT OK' : 'AUTH AUDIT BAD=' + bad));
process.exit(bad === 0 ? 0 : 1);
