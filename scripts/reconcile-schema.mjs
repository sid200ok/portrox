/**
 * Record migrations that the Supabase CLI already applied, using the CLI's OWN
 * login (independent of the Portrox store). Records CANONICAL FILENAMES so the
 * entries match what applySchema() writes — never a suffixed variant.
 *   node scripts/reconcile-schema.mjs [project_ref]
 */
import { readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { loadConfig, reconcileSchema, maskedConfig } from '../packages/cli/config-store.mjs';

const REPO = process.cwd();
const c = loadConfig();
const ref = process.argv[2] || c.supabase.default_project_ref || Object.keys(c.supabase.projects)[0] || '';
if (!ref) { console.error('FAIL no project ref'); process.exit(1); }
if (!c.supabase.projects[ref]) { console.error('FAIL unknown ref ' + ref); process.exit(1); }

const SB = existsSync(join(REPO, 'node_modules/.bin/supabase'))
  ? join(REPO, 'node_modules/.bin/supabase') : 'npx';
const args = SB.endsWith('supabase') ? ['migration list', '--remote'] : ['--yes', 'supabase@3.1.0', 'migration', 'list', '--remote'];
const flat = SB.endsWith('supabase') ? ['migration', 'list', '--remote'] : args;
const r = spawnSync(SB, flat, { encoding: 'utf8', cwd: REPO });
const out = String(r.stdout || '') + String(r.stderr || '');
if (r.status !== 0) {
  console.error('FAIL supabase migration list exited ' + r.status);
  console.error(out.split('\n').slice(0, 12).join('\n'));
  console.error('ACTION: the CLI needs its own login. Run: ./node_modules/.bin/supabase login');
  process.exit(1);
}

// Table rows look like:  `20261117220000` | `20261117220000` | `2026-11-17 22:00:00`
const remote = new Set();
for (const line of out.split('\n')) {
  if (line.includes('|') === false) continue;
  const cols = line.split('|').map(s => s.replace(/`/g, '').trim());
  if (cols.length < 2) continue;
  if (/^\d{14}$/.test(cols[1])) remote.add(cols[1]);
}
if (remote.size === 0) {
  console.log('NOTE no remote migration versions parsed. Raw output head:');
  console.log(out.split('\n').slice(0, 14).join('\n'));
  process.exit(1);
}

const files = readdirSync(join(REPO, 'supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
const canonical = [];
const unmatched = [];
for (const v of remote) {
  const hit = files.find(f => f.startsWith(v + '_'));
  if (hit) canonical.push(hit); else unmatched.push(v);
}
console.log('remote versions : ' + [...remote].sort().join(', '));
console.log('matched files   : ' + (canonical.join(', ') || '(none)'));
if (unmatched.length) console.log('NOTE unmatched versions (no local file): ' + unmatched.join(', '));

const merged = reconcileSchema(ref, canonical, 'supabase-cli');
const s = maskedConfig().supabase;
console.log('recorded        : ' + merged.join(', '));
console.log('schema_complete : ' + s.schema_complete + '  files=' + s.schema_files);
console.log(canonical.length >= 2 ? 'RECONCILE OK' : 'RECONCILE PARTIAL');
process.exit(canonical.length >= 2 ? 0 : 1);
