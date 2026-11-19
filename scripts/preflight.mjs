/**
 * Preflight.
 *  - Config is read through the STORE API, never raw JSON.
 *  - Migration files and mirror pairs are DERIVED from MIRROR_MAP. Hand-written
 *    duplicates got misaligned twice by string edits; that class is now gone.
 *  - Failures are collected and printed before the verdict so tail shows them.
 *  - The dotenv detector matches QUOTED filenames, strips comment lines, and
 *    excludes itself (its own docs contain dotenv examples).
 */
import { existsSync, statSync, readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { loadConfig, maskedConfig, publicSupabaseFor } from '../packages/cli/config-store.mjs';
import { mirrorPairs, mirrorFiles } from './sync-mirrors.mjs';

const need = [
  'package.json', 'package-lock.json', '.gitignore', '.env.example', 'README.md', 'LICENSE',
  '.gitleaks.toml', '.pre-commit-config.yaml',
  '.github/FUNDING.yml', 'SECURITY.md', 'CREDITS.md', '.github/workflows/security.yml', '.github/workflows/publish-site.yml',
  'packages/cli/portrox.mjs', 'packages/cli/studio-daemon.mjs', 'packages/cli/config-store.mjs',
  'packages/cli/auth-store.mjs', 'packages/cli/studio-ui.mjs', 'packages/cli/db-bridge.mjs',
  'packages/cli/supabase-mgmt.mjs', 'packages/cli/github-ops.mjs', 'packages/cli/gh-bridge.mjs',
  'packages/cli/git-auth.mjs', 'packages/cli/sql-sanitize.mjs',
  'packages/core/render.mjs', 'packages/core/portrox.css', 'packages/core/forms.js',
  'packages/core/html-normalize.mjs',
  'packages/core/system-pages/about-website.md',
  ...mirrorFiles(),
  'scripts/audit-secrets.sh', 'scripts/gitleaks-staged.sh', 'scripts/triage.mjs',
  'scripts/verify-render.mjs', 'scripts/verify-rpc.mjs', 'scripts/verify-daemon.mjs',
  'scripts/verify-ui.mjs', 'scripts/verify-auth.mjs', 'scripts/verify-github.mjs',
  'scripts/verify-supabase.mjs', 'scripts/verify-live.mjs', 'scripts/verify-content.mjs',
  'scripts/verify-all.sh', 'scripts/verify-git-auth.mjs',
  'scripts/supabase-lab.sh', 'scripts/migrate-store.mjs', 'scripts/reconcile-schema.mjs',
  'scripts/supabase-ops.mjs', 'scripts/harden-apply.mjs', 'scripts/sync-mirrors.mjs',
  'scripts/apply-migration.mjs', 'scripts/clean-probes.mjs', 'scripts/check-profile.mjs', 'scripts/check-contact.mjs',
  'scripts/publish-site.mjs', 'scripts/audit-db.mjs', 'scripts/restore-db.mjs', 'scripts/backup-db.mjs', 'scripts/inventory.mjs', 'scripts/release.sh',
  'docs/UI-TO-TERMINAL.md',
  'sites/sid200ok.github.io/site.json',
  'sites/sid200ok.github.io/content/intro.md',
  'sites/sid200ok.github.io/data/profile.json',
  'supabase/config.toml'
];
let bad = 0;
const failures = [];
const ok = m => console.log('OK   ' + m);
const fail = m => { bad++; failures.push(m); console.log('FAIL ' + m); };
const note = m => console.log('NOTE ' + m);
for (const p of need) existsSync(p) ? ok(p + '  ' + statSync(p).size + 'B') : fail('MISSING ' + p);

const DOTENV_PATTERNS = [
  /readFileSync\s*\(\s*['"`][^'"`]*\/?\.env(\.[A-Za-z0-9_-]+)?['"`]/,
  /readFileSync\s*\(\s*join\s*\([^)]*['"`]\.env(\.[A-Za-z0-9_-]+)?['"`]/,
  /(?:require\s*\(\s*|from\s+)['"]dotenv['"]/,
  /(?:^|\n)\s*(?:source|\.)\s+["']?[^\s'"]*\.env(\.[A-Za-z0-9_-]+)?["']?\s*(?:$|\n|#|;|&|\|)/
];
const SELF = 'scripts/preflight.mjs';
const stripComments = src => src.split('\n')
  .filter(l => { const t = l.trim(); return !(t.startsWith('*') || t.startsWith('//') || t.startsWith('#') || t.startsWith('/*')); })
  .join('\n');
const readers = [];
const walk = d => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist'].includes(e.name)) continue;
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(mjs|js|cjs|sh)$/.test(e.name)) {
      const rel = p.replace(/^\.\//, '');
      if (rel === SELF) continue;
      if (DOTENV_PATTERNS.some(re => re.test(stripComments(readFileSync(p, 'utf8'))))) readers.push(rel);
    }
  }
};
walk('.');
readers.length ? fail('dotenv readers: ' + readers.join(', ')) : ok('no dotenv credential readers');

for (const [a, b] of mirrorPairs()) {
  if (existsSync(a) === false || existsSync(b) === false) { fail('schema mirror missing: ' + a); continue; }
  const A = readFileSync(a), B = readFileSync(b);
  if (A.equals(B)) { ok('schema mirror ' + a.split('/').pop() + ' (' + A.length + 'B)'); continue; }
  fail('schema drift ' + a.split('/').pop() + ' (mirror ' + A.length + 'B vs source ' + B.length + 'B) - fix: node scripts/sync-mirrors.mjs');
}

const sh = (c, a) => spawnSync(c, a, { encoding: 'utf8' });
console.log('git commits: ' + (sh('git', ['rev-list', '--count', '--all']).stdout || '0').trim());
console.log('git remote: ' + (sh('git', ['remote', 'get-url', 'origin']).stdout || '(none)').trim());
console.log('portrox: ' + (sh('which', ['portrox']).stdout.trim() || 'NO'));
console.log('gh: ' + (sh('which', ['gh']).stdout.trim() || 'NO'));
console.log('node: ' + process.version + ' | gitleaks: ' + (sh('which', ['gitleaks']).stdout.trim() || 'NO') + ' | psql: ' + (sh('which', ['psql']).stdout.trim() || 'NO'));
console.log('supabase CLI: ' + (existsSync('node_modules/.bin/supabase') ? sh('node_modules/.bin/supabase', ['--version']).stdout.trim() : 'NO'));

const HOME = process.env.PORTROX_HOME || join(process.env.HOME, '.portrox');
for (const f of ['auth.json', 'config.json', 'state.json']) {
  const p = join(HOME, f);
  if (existsSync(p) === false) { note(f + ' not created yet'); continue; }
  const mode = (statSync(p).mode & 0o777).toString(8);
  mode === '600' ? ok(f + ' 0600') : fail(f + ' mode ' + mode);
}

const m = maskedConfig();
const s = m.supabase;
console.log('ACCOUNT token=' + (s.account.configured ? 'set' : 'EMPTY') + ' orgs=' + (s.account.orgs || []).length);
console.log('PROJECTS total=' + s.project_count + ' active=' + s.active_count + ' unknown=' + (s.project_count - s.active_count) + ' free_cap=' + s.free_limit);
console.log('DEFAULT ref=' + (s.project_ref || '-') + ' ready=' + s.project_ready + ' healthy=' + s.db_ok + ' schema_files=' + s.schema_files);
console.log('GITHUB ' + (m.github.configured ? ((m.github.login || 'connected') + ' via ' + m.github.source) : 'EMPTY'));
if (s.project_count === 0) note('no projects loaded - connect the account in the Studio');

for (const id of readdirSync('sites')) {
  const p = join('sites', id, 'site.json');
  if (existsSync(p) === false) continue;
  const cfg = JSON.parse(readFileSync(p, 'utf8'));
  const ref = cfg.database && cfg.database.project_ref;
  if (!ref) { fail(id + ': no explicit database.project_ref'); continue; }
  ok(id + ': bound to ' + ref + ' mode=' + (cfg.database.mode || '?'));
  const want = publicSupabaseFor(ref);
  ((cfg.supabase || {}).url || '') === want.url ? ok(id + ': injected url matches bound project') : fail(id + ': injected url drift');
}
if (failures.length) { console.log('--- FAILURES ---'); for (const f of failures) console.log('  ' + f); }
console.log(bad === 0 ? 'PREFLIGHT COMPLETE' : 'PREFLIGHT PROBLEMS=' + bad);
process.exit(bad === 0 ? 0 : 1);
