import { readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOME = process.env.PORTROX_HOME || join(homedir(), '.portrox');
const st = JSON.parse(readFileSync(join(HOME, 'state.json'), 'utf8'));
let bad = 0;
const ok = m => console.log('OK   ' + m);
const fail = m => { bad++; console.log('FAIL ' + m); };
const curl = args => spawnSync('curl', args, { encoding: 'utf8' });

// Negative-test fixture assembled at RUNTIME so no detectable literal
// ever exists in this source file. Same discipline as audit-secrets.sh.
const FAKE_SECRET = 'sb_' + 'secret_' + 'A'.repeat(20);

st.host === '127.0.0.1' ? ok('bind 127.0.0.1') : fail('bind ' + st.host);
(st.port > 0 && st.port !== 8000 && st.port !== 3000) ? ok('dynamic port ' + st.port) : fail('suspicious port ' + st.port);
const sm = (statSync(join(HOME, 'state.json')).mode & 0o777).toString(8);
sm === '600' ? ok('state.json 0600') : fail('state.json mode ' + sm);
const dm = (statSync(HOME).mode & 0o777).toString(8);
dm === '700' ? ok('~/.portrox 0700') : fail('dir mode ' + dm);

const h = curl(['-fsS', st.url + '/api/health']);
h.status === 0 ? ok('health ' + h.stdout.trim()) : fail('health unreachable');

const cfg = curl(['-fsS', st.url + '/api/config']);
if (cfg.status !== 0) fail('/api/config unreachable');
else {
  let j = null; try { j = JSON.parse(cfg.stdout); } catch {}
  if (!j) fail('/api/config not JSON');
  else {
    const raw = cfg.stdout;
    const leaks = ['access_token', 'refresh_token', '"token"', 'password', st.token].filter(k => raw.includes(k));
    leaks.length === 0 ? ok('/api/config leaks no tokens or CSRF secret') : fail('/api/config leaked: ' + leaks.join(', '));
    (j.supabase && j.github) ? ok('/api/config masked shape present') : fail('/api/config shape wrong');
    if (j.github && j.github.token) fail('github.token returned to browser');
    if (j.supabase && j.supabase.access_token) fail('supabase.access_token returned to browser');
  }
}

const noTok = curl(['-s', '-o', '/dev/null', '-w', '%{http_code}', '-X', 'POST', st.url + '/api/sites', '-d', '{}']);
noTok.stdout.trim() === '403' ? ok('POST without token -> 403') : fail('POST without token -> ' + noTok.stdout.trim());

const badTok = curl(['-s', '-o', '/dev/null', '-w', '%{http_code}', '-X', 'POST', '-H', 'x-portrox-token: wrong', st.url + '/api/sites', '-d', '{}']);
badTok.stdout.trim() === '403' ? ok('POST with wrong token -> 403') : fail('wrong token -> ' + badTok.stdout.trim());

const badHost = curl(['-s', '-o', '/dev/null', '-w', '%{http_code}', '-H', 'Host: evil.example', st.url + '/api/health']);
badHost.stdout.trim() === '403' ? ok('bad Host -> 403') : fail('bad Host -> ' + badHost.stdout.trim());

const badOrigin = curl(['-s', '-o', '/dev/null', '-w', '%{http_code}', '-X', 'POST', '-H', 'x-portrox-token: ' + st.token, '-H', 'Origin: http://evil.example', '-H', 'Content-Type: application/json', st.url + '/api/config/supabase', '-d', '{}']);
badOrigin.stdout.trim() === '403' ? ok('evil Origin -> 403') : fail('evil Origin -> ' + badOrigin.stdout.trim());

const secretPayload = JSON.stringify({ url: 'https://x.supabase.co', publishable_key: FAKE_SECRET });
const secretKey = curl(['-s', '-o', '/dev/null', '-w', '%{http_code}', '-X', 'POST', '-H', 'x-portrox-token: ' + st.token, '-H', 'Content-Type: application/json', st.url + '/api/config/supabase', '-d', secretPayload]);
secretKey.stdout.trim() === '400' ? ok('secret key rejected -> 400') : fail('secret key accepted -> ' + secretKey.stdout.trim());

const ss = spawnSync('bash', ['-lc', 'ss -ltnp 2>/dev/null | grep ":' + st.port + ' " || true'], { encoding: 'utf8' });
ss.stdout.includes('127.0.0.1:' + st.port) ? ok('listener is loopback only') : fail('listener: ' + ss.stdout.trim());

console.log('\nStudio URL: ' + st.url);
console.log(bad === 0 ? 'DAEMON OK' : 'DAEMON BAD=' + bad);
process.exit(bad === 0 ? 0 : 1);
