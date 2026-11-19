/**
 * Supabase operations — the SAME modules the Studio daemon calls.
 * This is what guarantees terminal/UI parity. Never reimplement the logic here.
 *
 *   node scripts/supabase-ops.mjs apply   <ref>            # Portrox schema only + record
 *   node scripts/supabase-ops.mjs key     <ref>            # fetch + STORE publishable key
 *   node scripts/supabase-ops.mjs health  <ref>
 *   node scripts/supabase-ops.mjs create  --org <slug> [--name N] [--region apac] [--store-password] [--site <id>]
 *
 * Secrets never reach stdout. A created project's password is written ONCE to a
 * 0600 handoff file named after the NEW ref (Supabase cannot rotate it via API).
 */
import { writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  loadConfig, saveConfig, accessToken, upsertProject, projectRecord,
  generateDbPassword, maskedConfig, schemaComplete, BOOTSTRAP_FILES
} from '../packages/cli/config-store.mjs';
import * as M from '../packages/cli/supabase-mgmt.mjs';
import * as DB from '../packages/cli/db-bridge.mjs';

const REPO = process.cwd();
const argv = process.argv.slice(2);
const op = argv[0] || '';
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : d; };
const positional = argv.slice(1).filter(a => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--org' && argv[argv.indexOf(a) - 1] !== '--name' && argv[argv.indexOf(a) - 1] !== '--region' && argv[argv.indexOf(a) - 1] !== '--site');
const die = m => { console.error('FAIL ' + m); process.exit(1); };
const ok = m => console.log('OK   ' + m);

function defaultRef() {
  const c = loadConfig();
  return c.supabase.default_project_ref || Object.keys(c.supabase.projects)[0] || '';
}
function needToken() {
  try { return accessToken(); }
  catch { die('Supabase access token not set. Studio → Settings → Supabase account (sbp_…).'); }
}

async function opApply(ref) {
  needToken();
  if (!projectRecord(ref)) die('unknown project ref ' + ref + ' — run: create, or Refresh projects in the Studio');
  const r = await DB.applySchema(ref, REPO, {
    onStep: (file, state) => console.log('     ' + file + ' → ' + state)
  });
  ok('applied ' + r.count + ' file(s) via ' + r.via);
  const rec = projectRecord(ref);
  console.log('recorded        : ' + (rec.schema_applied || []).join(', '));
  console.log('schema_complete : ' + schemaComplete(rec));
  process.exit(schemaComplete(rec) ? 0 : 1);
}

async function opKey(ref) {
  needToken();
  if (!projectRecord(ref)) die('unknown project ref ' + ref);
  const r = await DB.ensureKey(ref);   // upserts the publishable key into the store
  ok('publishable key stored (' + r.kind + ', ends ·' + r.tail + ')');
  const p = projectRecord(ref);
  console.log('project url     : ' + p.url);
  note_secret();
  process.exit(0);
}
function note_secret() {
  console.log('NOTE the secret/service key was NOT printed and NOT stored. Only the publishable key is kept.');
}

async function opHealth(ref) {
  needToken();
  const r = await DB.health(ref);
  if (r.ok) { ok('all services ACTIVE_HEALTHY'); console.log(r.summary); process.exit(0); }
  console.error('FAIL ' + (r.error || r.summary || 'not healthy'));
  process.exit(1);
}

async function opCreate() {
  const t = needToken();
  const c = loadConfig();
  let org = flag('org', '');
  if (!org) {
    const orgs = (c.supabase.orgs && c.supabase.orgs.length) ? c.supabase.orgs : await M.listOrganizations(t);
    if (!orgs.length) die('no organisations visible to this token');
    org = orgs[0].slug;
    console.log('NOTE --org not given; using ' + org);
  }
  const active = Object.values(c.supabase.projects).filter(p => /ACTIVE/.test(p.status || '')).length;
  if (active >= 2) console.log('WARN ' + active + ' active projects already exist. Supabase Free allows 2. Creation may be rejected (402/403).');

  const name = String(flag('name', 'portrox-' + Date.now()));
  const region = String(flag('region', 'apac'));
  const storePw = flag('store-password', false) === true;
  const siteId = flag('site', '');
  const pass = generateDbPassword();

  console.log('creating project "' + name + '" in org ' + org + ' (region group ' + region + ') …');
  const created = await M.createProject(t, { name, organization_slug: org, db_pass: pass, region_code: region });
  const ref = created.ref || created.id;
  if (!ref) die('API returned no project ref');

  // Handoff file is named after the NEW ref, never the currently bound one.
  const handoff = join(homedir(), 'portrox-db-password-' + ref + '.txt');
  writeFileSync(handoff,
    'project_ref: ' + ref + '\nproject_name: ' + name + '\norganization_slug: ' + org +
    '\npassword: ' + pass +
    '\n\nSupabase CANNOT rotate this password via the API. Move it to your password manager,\nthen delete this file. It was never printed to the terminal.\n',
    { mode: 0o600 });
  ok('project created: ' + ref);
  ok('password written to ' + handoff + ' (0600) — not printed');

  upsertProject(ref, {
    ref, name: created.name || name, organization_slug: created.organization_slug || org,
    region: created.region || '', status: created.status || 'INACTIVE',
    created_at: created.created_at || '', url: 'https://' + ref + '.supabase.co',
    db_password: storePw ? pass : '', db_password_stored: storePw
  });

  console.log('waiting for ACTIVE_HEALTHY (new projects start INACTIVE) …');
  const wait = await M.waitHealthy(t, ref, {
    timeoutMs: 300000, intervalMs: 6000,
    onTick: (s, sec) => console.log('     ' + sec + 's ' + s)
  });
  upsertProject(ref, { status: wait.status, health: wait.status, health_at: Date.now() });
  if (!wait.ok) {
    console.error('FAIL not healthy after ' + Math.round(wait.waitedMs / 1000) + 's (status ' + wait.status + ')');
    console.error('ACTION re-run: node scripts/supabase-ops.mjs health ' + ref + '  then apply + key');
    process.exit(1);
  }
  ok('healthy');
  const k = await DB.ensureKey(ref);
  ok('publishable key stored (' + k.kind + ', ends ·' + k.tail + ')');
  const r = await DB.applySchema(ref, REPO, { onStep: (f, s) => console.log('     ' + f + ' → ' + s) });
  ok('bootstrap applied: ' + r.count + ' file(s) via ' + r.via);

  if (siteId) {
    const p = join(REPO, 'sites', siteId, 'site.json');
    if (existsSync(p) === false) die('unknown site ' + siteId);
    const cfg = JSON.parse(readFileSync(p, 'utf8'));
    cfg.database = { mode: 'dedicated', project_ref: ref };
    cfg.registered = false;
    writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n');
    ok('bound site ' + siteId + ' → ' + ref + ' (dedicated)');
  }
  const m = maskedConfig().supabase;
  console.log('projects now    : ' + m.project_count + ' (active ' + m.active_count + '/' + m.free_limit + ')');
  console.log('NEXT            : Studio → Studio → ' + (siteId || '<site>') + ' → Register → Publish');
  process.exit(0);
}

const ref = positional[0] || defaultRef();
try {
  if (op === 'apply') { if (!ref) die('no project ref'); await opApply(ref); }
  else if (op === 'key') { if (!ref) die('no project ref'); await opKey(ref); }
  else if (op === 'health') { if (!ref) die('no project ref'); await opHealth(ref); }
  else if (op === 'create') { await opCreate(); }
  else {
    console.log('usage: node scripts/supabase-ops.mjs <apply|key|health> [ref]');
    console.log('       node scripts/supabase-ops.mjs create --org <slug> [--name N] [--region apac] [--store-password] [--site <id>]');
    console.log('bootstrap files: ' + BOOTSTRAP_FILES.join(', '));
    process.exit(op ? 1 : 0);
  }
} catch (e) {
  const msg = String(e && e.message || e)
    .replace(/sbp_[A-Za-z0-9]+/g, '[REDACTED_PAT]')
    .replace(/sb_secret_[A-Za-z0-9_-]+/g, '[REDACTED_KEY]');
  die(msg);
}
