/**
 * Daemon gate. Secret detection inspects JSON KEYS and VALUES, never substrings
 * of field names — 'db_password_stored' is a boolean, not a leak.
 */
import { readFileSync, statSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const HOME = process.env.PORTROX_HOME || join(homedir(), '.portrox');
const st = JSON.parse(readFileSync(join(HOME, 'state.json'), 'utf8'));
const U = process.env.PORTROX_TEST_USER || 'admin';
const P = process.env.PORTROX_TEST_PASS || 'admin';
let bad = 0;
const ok = m => console.log('OK   ' + m);
const fail = m => { bad++; console.log('FAIL ' + m); };
const curl = a => spawnSync('curl', a, { encoding: 'utf8' });
const code = a => curl(['-s', '-o', '/dev/null', '-w', '%{http_code}', ...a]).stdout.trim();

const SECRET_KEYS = new Set(['access_token', 'refresh_token', 'db_password', 'db_password_tail', 'token', 'password', 'secret_key', 'service_role_key']);
const SECRET_VALUE = /sbp_[A-Za-z0-9]{8,}|sb_secret_[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,}/;

/** Walk parsed JSON. Flag forbidden keys with non-empty values, and secret-shaped values. */
function leakScan(obj, csrf) {
  const hits = [];
  const walk = (node, path) => {
    if (node === null || node === undefined) return;
    if (typeof node === 'string') {
      if (SECRET_VALUE.test(node)) hits.push(path + ' (secret-shaped value)');
      if (csrf && node.includes(csrf)) hits.push(path + ' (CSRF token)');
      return;
    }
    if (Array.isArray(node)) { node.forEach((v, i) => walk(v, path + '[' + i + ']')); return; }
    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (SECRET_KEYS.has(k) && v !== '' && v !== null && v !== false && v !== undefined) {
          hits.push(path + '.' + k + ' (forbidden key with value)');
        }
        walk(v, path + '.' + k);
      }
    }
  };
  walk(obj, '$');
  return hits;
}
function assertNoLeaks(raw, csrf, label) {
  let j = null;
  try { j = JSON.parse(raw); } catch { fail(label + ': not JSON'); return null; }
  const hits = leakScan(j, csrf);
  hits.length === 0 ? ok(label + ': no secrets in keys or values') : fail(label + ' leaked: ' + hits.join(', '));
  return j;
}

// LIVENESS FIRST. A stale state.json after a WSL restart produced ten
// misleading product FAILs (CSRF, Host, Origin, session) when the only real
// condition was "the daemon is not running". The sandbox suite passed all of
// those in the same run, which is how the false diagnosis was identified.
{
  const probe = curl(['-fsS', st.url + '/api/health']);
  if (probe.status !== 0) {
    console.log('FAIL daemon not reachable at ' + st.url + ' - state.json is STALE');
    console.log('     pid recorded in state: ' + st.pid);
    console.log('ACTION: node packages/cli/portrox.mjs restart   then re-run this gate');
    console.log('\nDAEMON BAD=1 (not running - no product verdict issued)');
    process.exit(1);
  }
}
st.host === '127.0.0.1' ? ok('bind 127.0.0.1') : fail('bind ' + st.host);
(st.port > 0 && st.port !== 8000 && st.port !== 3000) ? ok('dynamic port ' + st.port) : fail('suspicious port ' + st.port);
for (const [f, want] of [['state.json', '600'], ['auth.json', '600']]) {
  const p = join(HOME, f);
  if (existsSync(p) === false) { fail(f + ' missing'); continue; }
  const m = (statSync(p).mode & 0o777).toString(8);
  m === want ? ok(f + ' ' + want) : fail(f + ' mode ' + m);
}
const dm = (statSync(HOME).mode & 0o777).toString(8);
dm === '700' ? ok('~/.portrox 0700') : fail('dir mode ' + dm);

const health = curl(['-fsS', st.url + '/api/health']);
health.status === 0 ? ok('health ' + health.stdout.trim()) : fail('health unreachable');
health.stdout.includes('sites') ? fail('health leaks site inventory') : ok('health leaks no inventory');

code([st.url + '/api/config']) === '401' ? ok('GET /api/config without session -> 401') : fail('config not gated');

// The store modules are tested directly, and verify-ui only checks the UI
// mentions the endpoints. Nothing exercised the ROUTING layer, so a bad regex,
// a wrong param name or a missing decodeURIComponent would pass every gate.
// 404 = route missing. 401 = route exists and is protected.
for (const path of ['/api/content/' + 'sid200ok.github.io', '/api/inbox/' + 'sid200ok.github.io', '/api/media/' + 'sid200ok.github.io', '/api/intro/' + 'sid200ok.github.io', '/api/backup/key', '/api/ai', '/api/pay']) {
  const c = code([st.url + path]);
  c === '401' ? ok('GET ' + path + ' routed + gated (401)') : fail('GET ' + path + ' -> ' + c + ' (404 means the route is missing)');
}
for (const path of ['/api/content/write', '/api/inbox/triage', '/api/inbox/delete', '/api/media/upload', '/api/media/delete', '/api/media/avatar', '/api/intro/preview', '/api/intro/save', '/api/backup/key/generate', '/api/backup/key/confirm', '/api/backup/key/clear', '/api/backup/key/copy', '/api/backup/run', '/api/ai/save', '/api/ai/run', '/api/pay/save', '/api/pay/enable', '/api/pay/default', '/api/pay/order', '/api/pay/remove', '/api/ai/validate', '/api/ai/select', '/api/ai/test', '/api/ai/tasks', '/api/ai/clear']) {
  const c = code(['-X', 'POST', '-H', 'Content-Type: application/json', '-H', 'x-portrox-token: ' + st.token, st.url + path, '-d', '{}']);
  c === '401' ? ok('POST ' + path + ' routed + gated (401)') : fail('POST ' + path + ' -> ' + c + ' (404 means the route is missing)');
}
code([st.url + '/api/sites']) === '401' ? ok('GET /api/sites without session -> 401') : fail('sites not gated');
code(['-X', 'POST', st.url + '/api/sites', '-d', '{}']) === '403' ? ok('POST without CSRF -> 403') : fail('CSRF not enforced');
code(['-X', 'POST', '-H', 'x-portrox-token: wrong', st.url + '/api/sites', '-d', '{}']) === '403' ? ok('wrong CSRF -> 403') : fail('wrong CSRF accepted');
code(['-H', 'Host: evil.example', st.url + '/api/health']) === '403' ? ok('bad Host -> 403') : fail('Host not validated');
code(['-X', 'POST', '-H', 'x-portrox-token: ' + st.token, '-H', 'Origin: http://evil.example',
  '-H', 'Content-Type: application/json', st.url + '/api/auth/login', '-d', '{}']) === '403' ? ok('evil Origin -> 403') : fail('Origin not validated');

const loginPage = curl(['-fsS', st.url + '/']);
loginPage.status === 0 && /Sign in/.test(loginPage.stdout) ? ok('unauthenticated / serves login') : fail('/ did not serve login');
loginPage.stdout.includes(st.token) ? ok('CSRF token present in login page') : fail('CSRF missing from login page');

/* ---- Sandbox daemon: full authenticated suite with fresh admin/admin ---- */
console.log('\n-- sandbox authenticated suite --');
const box = mkdtempSync(join(tmpdir(), 'portrox-sbx-'));
let sandboxPid = null;
try {
  const daemon = join(process.cwd(), 'packages/cli/studio-daemon.mjs');
  spawnSync(process.execPath, ['-e',
    'const{spawn}=require("child_process");' +
    'const c=spawn(process.execPath,[process.argv[1]],{detached:true,stdio:"ignore",env:process.env});' +
    'c.unref();process.stdout.write(String(c.pid));', daemon],
    { encoding: 'utf8', env: { ...process.env, PORTROX_HOME: box, PORTROX_REPO: process.cwd(), PORTROX_PORT: '0', PORTROX_HOST: '127.0.0.1' } });
  let sb = null;
  for (let i = 0; i < 80; i++) {
    try { sb = JSON.parse(readFileSync(join(box, 'state.json'), 'utf8')); if (sb && sb.port) break; } catch {}
    spawnSync('sleep', ['0.2']);
  }
  if (sb === null || !sb.port) fail('sandbox daemon did not start');
  else {
    sandboxPid = Number(sb.pid);
    ok('sandbox daemon on 127.0.0.1:' + sb.port);
    const jar = join(box, 'jar');
    const lg = curl(['-s', '-c', jar, '-X', 'POST', '-H', 'Content-Type: application/json',
      '-H', 'x-portrox-token: ' + sb.token, sb.url + '/api/auth/login',
      '-d', JSON.stringify({ username: 'admin', password: 'admin' })]);
    let logged = false; try { logged = JSON.parse(lg.stdout).ok === true; } catch {}
    logged ? ok('sandbox login admin/admin') : fail('sandbox login failed');

    const cfg = curl(['-fsS', '-b', jar, sb.url + '/api/config']);
    if (cfg.status !== 0) fail('sandbox /api/config unreachable with session');
    else {
      const j = assertNoLeaks(cfg.stdout, sb.token, 'sandbox /api/config');
      if (j) {
        (j.supabase && j.supabase.account && Array.isArray(j.supabase.projects)) ? ok('multi-project config shape') : fail('config shape wrong');
        for (const k of ['configured', 'project_ready', 'db_ok', 'schema_complete', 'schema_files']) {
          (k in j.supabase) ? ok('derived field ' + k) : fail('derived field ' + k + ' missing');
        }
        const raw = cfg.stdout;
        raw.includes('db_password_tail') ? fail('db_password_tail must not be exposed') : ok('no DB password hint exposed');
      }
    }
    const sess = curl(['-fsS', '-b', jar, sb.url + '/api/session']);
    if (sess.status === 0) assertNoLeaks(sess.stdout, null, 'sandbox /api/session');

    const badTok = curl(['-s', '-o', '/dev/null', '-w', '%{http_code}', '-b', jar, '-X', 'POST',
      '-H', 'Content-Type: application/json', '-H', 'x-portrox-token: ' + sb.token,
      sb.url + '/api/supabase/token', '-d', JSON.stringify({ access_token: 'sbp_invalid_probe_token' })]);
    badTok.stdout.trim() === '400' ? ok('invalid Supabase token rejected -> 400') : fail('invalid token accepted -> ' + badTok.stdout.trim());

    const noCsrf = curl(['-s', '-o', '/dev/null', '-w', '%{http_code}', '-b', jar, '-X', 'POST', sb.url + '/api/supabase/refresh', '-d', '{}']);
    noCsrf.stdout.trim() === '403' ? ok('sandbox POST without CSRF -> 403') : fail('sandbox CSRF not enforced');

    const lo = curl(['-s', '-b', jar, '-X', 'POST', '-H', 'x-portrox-token: ' + sb.token, sb.url + '/api/auth/logout']);
    lo.status === 0 ? ok('sandbox logout') : fail('sandbox logout failed');
    code(['-b', jar, sb.url + '/api/config']) === '401' ? ok('sandbox session invalidated after logout') : fail('sandbox session survived logout');
  }
} finally {
  if (sandboxPid) { try { process.kill(sandboxPid, 'SIGTERM'); } catch {} }
  try { rmSync(box, { recursive: true, force: true }); } catch {}
}

const ss = spawnSync('bash', ['-lc', 'ss -ltnp 2>/dev/null | grep ":' + st.port + ' " || true'], { encoding: 'utf8' });
ss.stdout.includes('127.0.0.1:' + st.port) ? ok('listener is loopback only') : fail('listener: ' + ss.stdout.trim());

console.log('\nStudio URL: ' + st.url);
console.log(bad === 0 ? 'DAEMON OK' : 'DAEMON BAD=' + bad);
process.exit(bad === 0 ? 0 : 1);
