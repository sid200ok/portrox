/**
 * Crash-aware gate runner.
 * Exit 1 = a check failed: stop, never retry.
 * Killed by a signal (SIGBUS/SIGSEGV/SIGKILL) = environment fault, not a
 * product defect. Capture memory and disk, retry ONCE, and if it dies again
 * say ENVIRONMENT FAULT with the measurements. A real crash still fails.
 */
import { spawnSync } from 'node:child_process';
const [script, ...rest] = process.argv.slice(2);
if (!script) { console.error('usage: node scripts/run-gate.mjs <script.mjs> [args]'); process.exit(2); }
const run = () => spawnSync(process.execPath, [script, ...rest], { stdio: 'inherit' });
const env = () => {
  for (const [c, a] of [['free', ['-m']], ['df', ['-h', '.']]]) {
    const r = spawnSync(c, a, { encoding: 'utf8' });
    process.stdout.write(String(r.stdout || '').split('\n').slice(0, 2).join('\n') + '\n');
  }
};
let r = run();
if (r.status === 0) process.exit(0);
if (!r.signal) process.exit(r.status === null ? 1 : r.status);
console.log('CRASH: ' + script + ' died on ' + r.signal + ' - not an assertion failure');
env();
console.log('retrying once in 5s ...');
spawnSync('sleep', ['5']);
r = run();
if (r.status === 0) { console.log('RECOVERED on retry: transient environment fault'); process.exit(0); }
if (r.signal) { console.error('ENVIRONMENT FAULT: ' + script + ' died on ' + r.signal + ' twice. Check disk space and WSL memory.'); env(); process.exit(1); }
process.exit(r.status === null ? 1 : r.status);
