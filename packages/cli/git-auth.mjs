/**
 * Git authentication for publish pushes. Three methods, probed in order:
 *   1. token  - Portrox-stored PAT, supplied via ENV to a credential helper
 *   2. gh     - the gh CLI credential helper (uses your existing gh session)
 *   3. ssh    - git@github.com with BatchMode
 *
 * HARD RULES
 *  - Never prompt. GIT_TERMINAL_PROMPT=0, GIT_ASKPASS=/bin/true,
 *    ssh -o BatchMode=yes. A method either works or fails fast.
 *  - Never put a secret in argv or in the remote URL. The token travels in ENV
 *    and the helper reads it from there.
 *  - Reset the credential helper list first (-c credential.helper=) so a stale
 *    global helper cannot answer before ours.
 *  - Probe with `git ls-remote` WITHOUT --exit-code: an empty repo has no refs
 *    and would otherwise look like a failure.
 * Pure ASCII.
 */
import { spawnSync } from 'node:child_process';
import { loadConfig } from './config-store.mjs';
import { ghPath } from './gh-bridge.mjs';

const HARD_ENV = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: '/bin/true',
  GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10',
  GH_PROMPT_DISABLED: '1',
  GH_NO_UPDATE_NOTIFIER: '1',
  NO_COLOR: '1'
};

const httpsUrl = full => 'https://github.com/' + full + '.git';
const sshUrl = full => 'git@github.com:' + full + '.git';

/** Candidate methods, in preference order. */
function candidates() {
  const c = loadConfig();
  const gh = ghPath();
  const out = [];
  if (c.github && c.github.token) {
    out.push({
      method: 'token',
      url: httpsUrl,
      args: ['-c', 'credential.helper=', '-c',
        'credential.helper=!f() { echo username=x-access-token; echo "password=$GH_TOKEN"; }; f'],
      env: { GH_TOKEN: c.github.token }
    });
  }
  if (gh) {
    out.push({
      method: 'gh',
      url: httpsUrl,
      args: ['-c', 'credential.helper=', '-c',
        'credential.helper=!"' + gh + '" auth git-credential'],
      env: {}
    });
  }
  out.push({ method: 'ssh', url: sshUrl, args: [], env: {} });
  return out;
}

function probe(cand, full) {
  const url = cand.url(full);
  const r = spawnSync('git', cand.args.concat(['ls-remote', url]), {
    encoding: 'utf8', timeout: 30000,
    env: { ...process.env, ...HARD_ENV, ...cand.env }
  });
  const err = String(r.stderr || '').trim().split('\n')[0].slice(0, 200);
  return { ok: r.status === 0, error: r.status === 0 ? '' : (err || ('exit ' + r.status)) };
}

const cache = new Map();

/** Resolve a working method for owner/repo. Throws with every probe result. */
export function resolveGitAuth(full) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(full || ''))) {
    throw new Error('repo must be owner/name');
  }
  if (cache.has(full)) return cache.get(full);
  const tried = [];
  for (const cand of candidates()) {
    const p = probe(cand, full);
    tried.push({ method: cand.method, ok: p.ok, error: p.error });
    if (p.ok) {
      const chosen = {
        method: cand.method,
        args: cand.args,
        url: cand.url(full),
        env: { ...process.env, ...HARD_ENV, ...cand.env },
        tried
      };
      cache.set(full, chosen);
      return chosen;
    }
  }
  const e = new Error('no working git auth for ' + full + ' :: ' +
    tried.map(t => t.method + '=' + (t.ok ? 'ok' : t.error)).join(' | '));
  e.tried = tried;
  throw e;
}

/** For the UI / diagnostics: report every method without throwing. */
export function describeGitAuth(full) {
  return candidates().map(c => {
    const p = probe(c, full);
    return { method: c.method, available: true, ok: p.ok, error: p.error, url: c.url(full) };
  });
}

export function gitEnvFor(auth) { return auth.env; }
export function resetGitAuthCache() { cache.clear(); }
