import { existsSync, statSync, readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const need = [
  'package.json','.gitignore','.env.example','README.md','LICENSE','.gitleaks.toml','.pre-commit-config.yaml',
  '.github/workflows/security.yml','.github/workflows/publish-site.yml',
  'packages/cli/portrox.mjs','packages/cli/studio-daemon.mjs','packages/cli/config-store.mjs',
  'packages/cli/auth-store.mjs','packages/cli/studio-ui.mjs','packages/cli/db-bridge.mjs',
  'packages/core/render.mjs','packages/core/portrox.css','packages/core/forms.js',
  'packages/core/system-pages/about-website.md',
  'packages/database/migrations/0001_init.sql',
  'supabase/migrations/20261117220000_portrox_init.sql',
  'supabase/migrations/20261118230000_studio_owner.sql',
  'packages/database/migrations/0002_studio_owner.sql',
  'scripts/audit-secrets.sh','scripts/gitleaks-staged.sh','scripts/triage.mjs',
  'scripts/verify-render.mjs','scripts/verify-rpc.mjs','scripts/verify-daemon.mjs',
  'scripts/verify-ui.mjs','scripts/verify-auth.mjs',
  'scripts/verify-live.mjs','scripts/verify-all.sh',
  'sites/sid200ok.github.io/site.json',
  'sites/sid200ok.github.io/content/intro.md',
  'sites/sid200ok.github.io/data/profile.json',
  'supabase/config.toml',
];
let bad = 0;
for (const p of need) {
  const ok = existsSync(p);
  if (ok === false) bad++;
  console.log((ok ? 'OK   ' : 'MISS ') + p + (ok ? '  ' + statSync(p).size + 'B' : ''));
}

const forbidden = [];
const walk = d => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist') continue;
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(mjs|js|sh)$/.test(e.name)) {
      const s = readFileSync(p, 'utf8');
      if (/readFileSync\([^)]*\.env/.test(s) || /source\s+\.?\/?\.env/.test(s)) forbidden.push(p);
    }
  }
};
walk('.');
if (forbidden.length) { bad++; console.log('FAIL .env readers present: ' + forbidden.join(', ')); }
else console.log('OK   no .env credential readers');

for (const [a, b] of [
  ['packages/database/migrations/0001_init.sql', 'supabase/migrations/20261117220000_portrox_init.sql'],
  ['packages/database/migrations/0002_studio_owner.sql', 'supabase/migrations/20261118230000_studio_owner.sql']
]) {
  if (existsSync(a) && existsSync(b)) {
    const same = readFileSync(a, 'utf8') === readFileSync(b, 'utf8');
    if (same === false) bad++;
    console.log((same ? 'OK   ' : 'FAIL ') + 'schema mirror ' + a.split('/').pop());
  }
}

const sh = (c, a2) => spawnSync(c, a2, { encoding: 'utf8' });
console.log('git commits: ' + (sh('git', ['rev-list', '--count', '--all']).stdout || '0').trim());
console.log('git remote: ' + (sh('git', ['remote', 'get-url', 'origin']).stdout || '(none)').trim());
console.log('portrox on PATH: ' + (sh('which', ['portrox']).stdout.trim() || 'NO'));
console.log('node: ' + process.version + '  gitleaks: ' + (sh('which', ['gitleaks']).stdout.trim() || 'NO') + '  psql: ' + (sh('which', ['psql']).stdout.trim() || 'NO'));

const authPath = join(process.env.PORTROX_HOME || join(process.env.HOME, '.portrox'), 'auth.json');
if (existsSync(authPath)) {
  const am = (statSync(authPath).mode & 0o777).toString(8);
  if (am !== '600') bad++;
  console.log('auth.json mode: ' + am + (am === '600' ? '  OK' : '  FAIL'));
  try {
    const a = JSON.parse(readFileSync(authPath, 'utf8'));
    const weak = Boolean(a.user.passwordRotated) === false;
    console.log('Studio auth: user=' + a.user.username + ' passwordRotated=' + Boolean(a.user.passwordRotated)
      + ' recovery=' + (a.recovery.questions.length >= a.recovery.required || Boolean(a.recovery.key)));
    if (weak) console.log('NOTE Studio password may still be the default — rotate it in Settings -> Security');
  } catch { bad++; console.log('FAIL auth.json unparsable'); }
} else {
  console.log('Studio auth: not initialised (starts on first daemon run)');
}

const cfgPath = join(process.env.PORTROX_HOME || join(process.env.HOME, '.portrox'), 'config.json');
if (existsSync(cfgPath)) {
  const m = (statSync(cfgPath).mode & 0o777).toString(8);
  if (m !== '600') bad++;
  console.log('config.json mode: ' + m + (m === '600' ? '  OK' : '  FAIL'));
  let c = {};
  try { c = JSON.parse(readFileSync(cfgPath, 'utf8')); } catch { bad++; console.log('FAIL config.json unparsable'); }
  const s = c.supabase || {}, g = c.github || {};
  console.log('UI config: supabase=' + (s.url ? 'set' : 'EMPTY') + ' ref=' + (s.project_ref || '-') + ' db_password=' + (s.db_password ? 'set' : 'EMPTY') + ' db_ok=' + Boolean(s.db_ok) + ' mode=' + (s.db_mode || '-') + ' github=' + (g.login || 'EMPTY'));
  if (s.db_password && !s.db_host) { bad++; console.log('FAIL db password set but host not derived'); }
  if (s.publishable_key && /^sb_(secret|service)_/.test(s.publishable_key)) { bad++; console.log('FAIL secret key in UI store'); }
} else {
  console.log('UI config: NOT CREATED — open the Studio and complete Setup');
}
try { console.log('sites: ' + readdirSync('sites').join(', ')); } catch { console.log('sites: NONE'); }
console.log(bad === 0 ? 'PREFLIGHT COMPLETE' : 'PREFLIGHT PROBLEMS=' + bad);
process.exit(bad === 0 ? 0 : 1);
