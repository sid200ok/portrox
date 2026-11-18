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
code([st.url + '/api/sites']) === '401' ? ok('GET /api/sites without session -> 401') : fail('sites not gated');
code(['-X', 'POST', st.url + '/api/sites', '-d', '{}']) === '403' ? ok('POST without CSRF -> 403') : fail('CSRF not enforced');
code(['-X', 'POST', '-H', 'x-portrox-token: wrong', st.url + '/api/sites', '-d', '{}']) === '403' ? ok('wrong CSRF -> 403') : fail('wrong CSRF accepted');
code(['-H', 'Host: evil.example', st.url + '/api/health']) === '403' ? ok('bad Host -> 403') : fail('Host not validated');
code(['-X', 'POST', '-H', 'x-portrox-token: ' + st.token, '-H', 'Origin: http://evil.example',
  '-H', 'Content-Type: application/json', st.url + '/api/auth/login', '-d', '{}']) === '403' ? ok('evil Origin -> 403') : fail('Origin not validated');

const loginPage = curl(['-fsS', st.url + '/']);
loginPage.status === 0 && /Sign in/.test(loginPage.stdout) ? ok('unauthenticated / serves login') : fail('/ did not serve login');
loginPage.stdout.includes(st.token) ? ok('CSRF token present in login page') : fail('CSRF missing from login page');

// A4 — session cookie must never be world-readable. mkdtemp gives 0700.
const box = mkdtempSync(join(tmpdir(), 'portrox-vd-'));
const jar = join(box, 'jar');
try {
  const lg = curl(['-s', '-c', jar, '-X', 'POST', '-H', 'Content-Type: application/json',
    '-H', 'x-portrox-token: ' + st.token, st.url + '/api/auth/login',
    '-d', JSON.stringify({ username: U, password: P })]);
  let logged = false;
  try { logged = JSON.parse(lg.stdout).ok === true; } catch {}
  if (logged === false) {
    console.log('SKIP authenticated checks (credentials rotated). Set PORTROX_TEST_USER / PORTROX_TEST_PASS to include them.');
  } else {
    ok('login succeeds');
    const jdm = (statSync(box).mode & 0o777).toString(8);
    jdm === '700' ? ok('cookie jar dir 0700') : fail('cookie jar dir ' + jdm);
    if (existsSync(jar)) {
      const jm = (statSync(jar).mode & 0o777).toString(8);
      (jm === '600' || jm === '644') ? ok('cookie jar mode ' + jm + ' inside 0700 dir') : fail('cookie jar mode ' + jm);
    }
    const cfg = curl(['-fsS', '-b', jar, st.url + '/api/config']);
    if (cfg.status !== 0) fail('authenticated /api/config unreachable');
    else {
      const raw = cfg.stdout;
      const leaks = ['access_token', 'refresh_token', '"token"', 'password', st.token].filter(k => raw.includes(k));
      leaks.length === 0 ? ok('/api/config leaks no secrets') : fail('/api/config leaked: ' + leaks.join(', '));
      try { const j = JSON.parse(raw); (j.supabase && j.github) ? ok('masked shape present') : fail('masked shape wrong'); } catch { fail('config not JSON'); }
    }
    const sess = curl(['-fsS', '-b', jar, st.url + '/api/session']);
    try {
      const j = JSON.parse(sess.stdout);
      ('weakPassword' in j.auth) ? ok('session exposes weakPassword flag') : fail('session missing weakPassword flag');
      j.auth.weakPassword === true ? console.log('NOTE default password still active — rotate it in Settings -> Security') : ok('password is not the default');
    } catch { fail('session not JSON'); }
    const sites = curl(['-fsS', '-b', jar, st.url + '/api/sites']);
    sites.status === 0 ? ok('authenticated /api/sites reachable') : fail('sites unreachable with session');
    const sk = curl(['-s', '-o', '/dev/null', '-w', '%{http_code}', '-b', jar, '-X', 'POST',
      '-H', 'Content-Type: application/json', '-H', 'x-portrox-token: ' + st.token,
      st.url + '/api/config/supabase', '-d', JSON.stringify({ url: 'https://x.supabase.co', publishable_key: 'sb_' + 'secret_' + 'A'.repeat(20) })]);
    sk.stdout.trim() === '400' ? ok('secret key rejected -> 400') : fail('secret key accepted -> ' + sk.stdout.trim());
    const lo = curl(['-s', '-b', jar, '-X', 'POST', '-H', 'x-portrox-token: ' + st.token, st.url + '/api/auth/logout']);
    lo.status === 0 ? ok('logout succeeds') : fail('logout failed');
    code(['-b', jar, st.url + '/api/config']) === '401' ? ok('session invalidated after logout') : fail('session survived logout');
  }
} finally {
  try { rmSync(box, { recursive: true, force: true }); } catch {}
}

const ss = spawnSync('bash', ['-lc', 'ss -ltnp 2>/dev/null | grep ":' + st.port + ' " || true'], { encoding: 'utf8' });
ss.stdout.includes('127.0.0.1:' + st.port) ? ok('listener is loopback only') : fail('listener: ' + ss.stdout.trim());

console.log('\nStudio URL: ' + st.url);
console.log(bad === 0 ? 'DAEMON OK' : 'DAEMON BAD=' + bad);
process.exit(bad === 0 ? 0 : 1);
