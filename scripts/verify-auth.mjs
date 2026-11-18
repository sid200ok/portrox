/**
 * Auth lifecycle regression tests. Runs in a THROWAWAY PORTROX_HOME so your
 * real ~/.portrox/auth.json is never touched. Re-execs itself in the sandbox.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);

if (!process.env.PORTROX_SELFTEST) {
  const box = mkdtempSync(join(tmpdir(), 'portrox-auth-test-'));
  const r = spawnSync(process.execPath, [SELF], {
    stdio: 'inherit',
    env: { ...process.env, PORTROX_HOME: box, PORTROX_SELFTEST: '1' }
  });
  try { rmSync(box, { recursive: true, force: true }); } catch {}
  process.exit(r.status === null ? 1 : r.status);
}

const A = await import('../packages/cli/auth-store.mjs');
let bad = 0;
const ok = m => console.log('OK   ' + m);
const fail = m => { bad++; console.log('FAIL ' + m); };
const must = (cond, m) => cond ? ok(m) : fail(m);
const throws = (fn, m) => { try { fn(); fail(m + ' (did not throw)'); } catch { ok(m); } };

console.log('sandbox: ' + process.env.PORTROX_HOME + '\n');

// --- baseline ---
let st = A.publicState();
must(st.usingDefaults === true, 'fresh install reports usingDefaults');
must(st.weakPassword === true, 'fresh install reports weakPassword');
must(st.passwordRotated === false, 'fresh install not rotated');

// --- A1 REGRESSION: username-only change must NOT clear the warning ---
A.changeCredentials({ currentPassword: 'admin', username: 'siddhant' });
st = A.publicState();
must(st.username === 'siddhant', 'username changed');
must(st.weakPassword === true, 'A1: weakPassword STILL true after username-only change');
must(st.passwordRotated === false, 'A1: passwordRotated STILL false');
must(st.usingDefaults === false, 'usingDefaults false (username no longer admin) — banner uses weakPassword');
throws(() => A.login({ username: 'siddhant', password: 'admin' }), 'old default password still works (proves the warning is needed)');

// --- password change clears it ---
A.changeCredentials({ currentPassword: 'admin', password: 'Str0ng-Pass-9' });
st = A.publicState();
must(st.weakPassword === false, 'password change clears weakPassword');
must(st.passwordRotated === true, 'password change sets passwordRotated');
throws(() => A.changeCredentials({ currentPassword: 'Str0ng-Pass-9', password: 'admin' }), 'rejects reverting to default password');
throws(() => A.changeCredentials({ currentPassword: 'wrong', password: 'Another-Pass-9' }), 'rejects wrong current password');
throws(() => A.changeCredentials({ currentPassword: 'Str0ng-Pass-9', password: 'short' }), 'rejects short password');
throws(() => A.changeCredentials({ currentPassword: 'Str0ng-Pass-9', username: 'x' }), 'rejects short username');

// --- A2 REGRESSION: atomic credentials + recovery ---
A.changeCredentials({
  currentPassword: 'Str0ng-Pass-9',
  password: 'Atomic-Pass-99',
  recoveryAnswers: [{ id: 'nickname', value: 'Buddy' }, { id: 'birthplace', value: 'Patna' }],
  recoveryRequired: 2
});
st = A.publicState();
must(st.recoveryConfigured === true, 'A2: recovery persisted in the SAME call as the password change');
must(st.recoveryQuestions.length === 2, 'A2: both questions stored');
must(st.weakPassword === false, 'A2: password applied too');

// --- atomicity: bad answer must not half-apply ---
throws(() => A.changeCredentials({
  currentPassword: 'Atomic-Pass-99', password: 'Rollback-Pass-1',
  recoveryAnswers: [{ id: 'nickname', value: 'Zed' }, { id: 'nickname', value: 'Dup' }], recoveryRequired: 2
}), 'duplicate question rejected');
throws(() => A.login({ username: 'siddhant', password: 'Rollback-Pass-1' }), 'A2: password NOT changed when recovery validation failed');
A.login({ username: 'siddhant', password: 'Atomic-Pass-99' });
ok('A2: previous password still valid after failed atomic write');

// --- recovery happy path ---
const rec = A.recover({ answers: [{ id: 'nickname', value: 'buddy' }, { id: 'birthplace', value: 'PATNA' }] });
must(typeof rec.resetToken === 'string' && rec.resetToken.length > 0, 'recovery accepts normalised answers');
A.resetWithToken({ resetToken: rec.resetToken, username: 'recovered', password: 'Recovered-Pass-1' });
must(A.publicState().username === 'recovered', 'reset applied');
throws(() => A.resetWithToken({ resetToken: rec.resetToken, username: 'again', password: 'Again-Pass-123' }), 'reset token is single-use');

// --- recovery rate limit ---
for (let i = 0; i < 3; i++) { try { A.recover({ answers: [{ id: 'nickname', value: 'nope' }, { id: 'birthplace', value: 'nope' }] }); } catch {} }
throws(() => A.recover({ answers: [{ id: 'nickname', value: 'buddy' }, { id: 'birthplace', value: 'patna' }] }), 'recovery locked after 3 failures');

// --- login lockout ---
for (let i = 0; i < 5; i++) { try { A.login({ username: 'recovered', password: 'wrong' }); } catch {} }
throws(() => A.login({ username: 'recovered', password: 'Recovered-Pass-1' }), 'login locked after 5 failures');

// --- session lifecycle ---
A.logoutAll();
const box2 = A.publicState();
must(box2.username === 'recovered', 'state survives logoutAll');

console.log('\n' + (bad === 0 ? 'AUTH OK' : 'AUTH BAD=' + bad));
process.exit(bad === 0 ? 0 : 1);
