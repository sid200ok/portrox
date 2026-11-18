/**
 * Preflight. Reads config through the STORE API (loadConfig/maskedConfig), never
 * raw JSON — normalize() migrates the legacy shape in memory, so a raw read
 * reports projects=0 while status reports projects=1.
 */
import { existsSync, statSync, readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { loadConfig, maskedConfig, publicSupabaseFor } from '../packages/cli/config-store.mjs';

const need = [
  'package.json','package-lock.json','.gitignore','.env.example','README.md','LICENSE',
  '.gitleaks.toml','.pre-commit-config.yaml',
  '.github/workflows/security.yml','.github/workflows/publish-site.yml',
  'packages/cli/portrox.mjs','packages/cli/studio-daemon.mjs','packages/cli/config-store.mjs',
  'packages/cli/auth-store.mjs','packages/cli/studio-ui.mjs','packages/cli/db-bridge.mjs',
  'packages/cli/supabase-mgmt.mjs',
  'packages/core/render.mjs','packages/core/portrox.css','packages/core/forms.js',
  'packages/core/system-pages/about-website.md',
  'packages/database/migrations/0001_init.sql','packages/database/migrations/0002_studio_owner.sql',
  'supabase/migrations/20261117220000_portrox_init.sql','supabase/migrations/20261118230000_studio_owner.sql',
  'scripts/audit-secrets.sh','scripts/gitleaks-staged.sh','scripts/triage.mjs',
  'scripts/verify-render.mjs','scripts/verify-rpc.mjs','scripts/verify-daemon.mjs',
  'scripts/verify-ui.mjs','scripts/verify-auth.mjs','scripts/verify-live.mjs','scripts/verify-all.sh',
  'scripts/supabase-lab.sh','scripts/migrate-store.mjs','docs/UI-TO-TERMINAL.md',
  'sites/sid200ok.github.io/site.json','sites/sid200ok.github.io/content/intro.md',
  'sites/sid200ok.github.io/data/profile.json','supabase/config.toml',
];
let bad = 0;
const ok = m => console.log('OK   ' + m);
const fail = m => { bad++; console.log('FAIL ' + m); };
for (const p of need) existsSync(p) ? ok(p + '  ' + statSync(p).size + 'B') : fail('MISSING ' + p);

// No credential may be read from a .env file.
const readers = [];
const walk = d => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist'].includes(e.name)) continue;
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(mjs|js|sh)$/.test(e.name)) {
      const s = readFileSync(p, 'utf8');
      if (/readFileSync\([^)]*\.env/.test(s) || /source\s+\.?\/?\.env/.test(s)) readers.push(p);
    }
  }
};
walk('.');
readers.length ? fail('.env readers: ' + readers.join(', ')) : ok('no .env credential readers');

for (const [a, b] of [
  ['packages/database/migrations/0001_init.sql', 'supabase/migrations/20261117220000_portrox_init.sql'],
  ['packages/database/migrations/0002_studio_owner.sql', 'supabase/migrations/20261118230000_studio_owner.sql']
]) {
  if (existsSync(a) && existsSync(b)) {
    readFileSync(a, 'utf8') === readFileSync(b, 'utf8') ? ok('schema mirror ' + a.split('/').pop()) : fail('schema drift ' + a);
  }
}

const sh = (c, a) => spawnSync(c, a, { encoding: 'utf8' });
console.log('git commits: ' + (sh('git', ['rev-list', '--count', '--all']).stdout || '0').trim());
console.log('git remote: ' + (sh('git', ['remote', 'get-url', 'origin']).stdout || '(none)').trim());
console.log('portrox: ' + (sh('which', ['portrox']).stdout.trim() || 'NO'));
console.log('node: ' + process.version + ' · gitleaks: ' + (sh('which', ['gitleaks']).stdout.trim() || 'NO') + ' · psql: ' + (sh('which', ['psql']).stdout.trim() || 'NO'));
console.log('supabase CLI: ' + (existsSync('node_modules/.bin/supabase') ? sh('node_modules/.bin/supabase', ['--version']).stdout.trim() : 'NO'));

const HOME = process.env.PORTROX_HOME || join(process.env.HOME, '.portrox');
for (const f of ['auth.json', 'config.json', 'state.json']) {
  const p = join(HOME, f);
  if (existsSync(p) === false) { console.log('NOTE ' + f + ' not created yet'); continue; }
  const mode = (statSync(p).mode & 0o777).toString(8);
  mode === '600' ? ok(f + ' 0600') : fail(f + ' mode ' + mode);
}

// STORE API, not raw JSON.
const c = loadConfig();
const m = maskedConfig();
const s = m.supabase;
console.log('ACCOUNT token=' + (s.account.configured ? 'set' : 'EMPTY') + ' orgs=' + (s.account.orgs || []).length);
console.log('PROJECTS total=' + s.project_count + ' active=' + s.active_count + ' unknown=' + (s.project_count - s.active_count) + ' free_cap=' + s.free_limit);
console.log('DEFAULT ref=' + (s.project_ref || '-') + ' ready=' + s.project_ready + ' healthy=' + s.db_ok + ' schema_files=' + s.schema_files);
console.log('GITHUB ' + (m.github.configured ? (m.github.login || 'token set') : 'EMPTY'));
if (s.project_count === 0) console.log('NOTE no projects loaded — connect the account in the Studio');

// Every site must be EXPLICITLY bound, and its injected creds must match.
for (const id of readdirSync('sites')) {
  const p = join('sites', id, 'site.json');
  if (existsSync(p) === false) continue;
  const cfg = JSON.parse(readFileSync(p, 'utf8'));
  const ref = cfg.database && cfg.database.project_ref;
  if (!ref) { fail(id + ': no explicit database.project_ref (implicit binding is drift)'); continue; }
  ok(id + ': bound to ' + ref + ' mode=' + (cfg.database.mode || '?'));
  const want = publicSupabaseFor(ref);
  ((cfg.supabase || {}).url || '') === want.url ? ok(id + ': injected url matches bound project') : fail(id + ': injected url drift');
}
console.log(bad === 0 ? 'PREFLIGHT COMPLETE' : 'PREFLIGHT PROBLEMS=' + bad);
process.exit(bad === 0 ? 0 : 1);
