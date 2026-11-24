/**
 * Run the whole backup from the Studio. The directive is UI-only operation, so
 * running a backup must not require a terminal. Refuses without a key. Optionally
 * replaces remote history with the single newest bundle, which is how an
 * undecryptable bundle from a lost key is discarded.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync, existsSync, mkdtempSync, rmSync, copyFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { hasKey } from './backup-key.mjs';
import { resolveGitAuth } from './git-auth.mjs';
import * as GH from './github-ops.mjs';

export class RunError extends Error { constructor(m, c) { super(m); this.code = c || 400; } }
const tail = (s, n = 12) => String(s || '').trim().split('\n').slice(-n).join('\n');

function newest(dir) {
  if (!existsSync(dir)) return null;
  const f = readdirSync(dir).filter(x => x.endsWith('.pxb'))
    .map(x => ({ x, t: statSync(join(dir, x)).mtimeMs })).sort((a, b) => b.t - a.t);
  return f.length ? join(dir, f[0].x) : null;
}

export async function runBackup(repo, { replace = false } = {}) {
  if (!hasKey()) throw new RunError('no backup key - generate one first', 409);
  const steps = [];
  const run = (script) => {
    const r = spawnSync(process.execPath, [join(repo, 'scripts', script)], { cwd: repo, encoding: 'utf8', timeout: 300000 });
    steps.push({ script, ok: r.status === 0, log: tail(String(r.stdout || '') + String(r.stderr || '')) });
    return r.status === 0;
  };
  if (!run('backup-db.mjs')) return { ok: false, steps };
  if (!run('backup-offsite.mjs')) return { ok: false, steps };

  if (replace) {
    const bundle = newest(join(repo, 'backups-offsite'));
    if (!bundle) throw new RunError('no local bundle to keep', 500);
    const st = await GH.authStatus();
    if (!st.connected) throw new RunError('GitHub not connected', 409);
    const full = st.login + '/portrox-backups';
    const auth = resolveGitAuth(full);
    const tmp = mkdtempSync(join(tmpdir(), 'px-bkrun-'));
    const git = (a) => {
      const r = spawnSync('git', auth.args.concat(a), { cwd: tmp, env: auth.env, encoding: 'utf8', timeout: 180000 });
      if (r.status !== 0) throw new RunError('git ' + a[0] + ': ' + tail(r.stderr || r.stdout, 3), 500);
    };
    try {
      copyFileSync(bundle, join(tmp, bundle.split('/').pop()));
      writeFileSync(join(tmp, 'README.md'), 'Encrypted Portrox backups.\nKey is held by the Studio and by the operator password manager.\n');
      git(['init', '-q', '-b', 'main']);
      git(['add', '-A']);
      git(['-c', 'user.email=portrox@localhost', '-c', 'user.name=Portrox', 'commit', '-q', '-m', 'Single bundle under the current key']);
      git(['remote', 'add', 'origin', auth.url]);
      git(['push', '-q', '--force', 'origin', 'main']);
      steps.push({ script: 'replace remote history', ok: true, log: 'kept only ' + bundle.split('/').pop() });
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  }
  return { ok: true, steps };
}
