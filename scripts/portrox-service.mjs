/**
 * Portrox service manager: autostart, logs, url.
 *
 *   node scripts/portrox-service.mjs enable    install + start a systemd USER unit
 *   node scripts/portrox-service.mjs disable   stop + remove it
 *   node scripts/portrox-service.mjs status    unit state + daemon state
 *   node scripts/portrox-service.mjs logs [N]  tail the newest daemon log
 *   node scripts/portrox-service.mjs url       print the current Studio URL
 *   node scripts/portrox-service.mjs open      hand that URL to the browser
 *
 * WHY A SEPARATE FILE: packages/cli/portrox.mjs is the entry point for every
 * gate and every release. This module adds operations WITHOUT editing it, and
 * delegates start/stop to it, so daemon logic stays in exactly one place.
 *
 * HARD RULES, inherited from the CLI:
 *  - USER scope only. Never system-scope systemd, never pkill, never anything
 *    that could terminate your session. `disable` therefore does NOT run
 *    `loginctl disable-linger`, which would kill other user processes.
 *  - The port stays kernel-assigned. Nothing here pins a port. Read it with `url`.
 *  - Type=oneshot + RemainAfterExit=yes, because `portrox start` spawns a detached
 *    daemon and exits. That matches the project's own Type=forking -> oneshot fix.
 *
 * WSL NOTE: a lingered user unit starts when WSL starts. Windows does not boot
 * WSL at logon by itself - that is a separate, optional Windows scheduled task.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

const REPO = process.cwd();
const CLI = join(REPO, 'packages', 'cli', 'portrox.mjs');
const HOME = process.env.PORTROX_HOME || join(homedir(), '.portrox');
const UNIT_DIR = join(homedir(), '.config', 'systemd', 'user');
const UNIT = join(UNIT_DIR, 'portrox.service');
const NAME = 'portrox.service';

let bad = 0;
const ok = m => console.log('OK   ' + m);
const fail = m => { bad++; console.log('FAIL ' + m); };
const note = m => console.log('NOTE ' + m);
const run = (cmd, args, allowFail) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 120000 });
  const out = String(r.stdout || '') + String(r.stderr || '');
  if (r.status !== 0 && !allowFail) fail(cmd + ' ' + args.join(' ') + ' -> ' + out.trim().slice(0, 300));
  return { code: r.status, out: out.trim() };
};

if (!existsSync(CLI)) { console.log('FAIL run this from the repo root: ' + CLI + ' not found'); process.exit(1); }

const readState = () => { try { return JSON.parse(readFileSync(join(HOME, 'state.json'), 'utf8')); } catch { return null; } };
const cli = (...args) => run(process.execPath, [CLI, ...args], true);

function unitText() {
  const node = process.execPath;
  const pathEnv = process.env.PATH || '/usr/bin:/bin';
  return [
    '[Unit]',
    'Description=Portrox Studio (local authoring daemon, loopback only)',
    'Documentation=file://' + join(REPO, 'README.md'),
    '',
    '[Service]',
    'Type=oneshot',
    'RemainAfterExit=yes',
    'WorkingDirectory=' + REPO,
    'Environment=PORTROX_REPO=' + REPO,
    'Environment=PORTROX_HOME=' + HOME,
    'Environment=PATH=' + pathEnv,
    'ExecStart=' + node + ' ' + CLI + ' start',
    'ExecStop=' + node + ' ' + CLI + ' stop',
    'TimeoutStartSec=90',
    '',
    '[Install]',
    'WantedBy=default.target',
    ''
  ].join('\n');
}

function cmdEnable() {
  const probe = run('systemctl', ['--user', 'is-system-running'], true);
  if (/Failed to connect|not been booted|No such file/i.test(probe.out)) {
    fail('systemd user manager is not available in this WSL distro');
    note('enable it: /etc/wsl.conf -> [boot] systemd=true, then `wsl --shutdown` from Windows');
    return;
  }
  mkdirSync(UNIT_DIR, { recursive: true });
  const text = unitText();
  if (existsSync(UNIT) && readFileSync(UNIT, 'utf8') === text) ok('unit already current');
  else { writeFileSync(UNIT, text, { mode: 0o644 }); ok('wrote ' + UNIT); }
  console.log('--- unit ---\n' + text + '------------');

  if (run('systemctl', ['--user', 'daemon-reload']).code !== 0) return;
  ok('daemon-reload');
  if (run('systemctl', ['--user', 'enable', NAME]).code !== 0) return;
  ok('enabled for user default.target');

  const linger = run('loginctl', ['show-user', process.env.USER || '', '-p', 'Linger'], true);
  if (/Linger=yes/.test(linger.out)) ok('linger already on - starts without an interactive login');
  else {
    const set = run('loginctl', ['enable-linger', process.env.USER || ''], true);
    if (set.code === 0) ok('linger enabled');
    else { note('linger needs privilege. Run once:  sudo loginctl enable-linger ' + (process.env.USER || '$USER')); }
  }

  const st = readState();
  if (st && st.pid) note('daemon already running (pid ' + st.pid + ') - start is health-aware and will keep it');
  if (run('systemctl', ['--user', 'start', NAME]).code !== 0) return;
  ok('service started');
  cmdStatus();
  note('Windows does not boot WSL at logon. For that layer, see the PowerShell task in the docs.');
}

function cmdDisable() {
  run('systemctl', ['--user', 'stop', NAME], true);
  run('systemctl', ['--user', 'disable', NAME], true);
  if (existsSync(UNIT)) { unlinkSync(UNIT); ok('removed ' + UNIT); } else note('no unit file to remove');
  run('systemctl', ['--user', 'daemon-reload'], true);
  ok('autostart disabled');
  note('linger deliberately LEFT ON: `loginctl disable-linger` terminates other user processes.');
  note('the daemon may still be running. Stop it explicitly with: portrox stop');
}

function cmdStatus() {
  const u = run('systemctl', ['--user', 'is-enabled', NAME], true);
  const a = run('systemctl', ['--user', 'is-active', NAME], true);
  console.log('unit enabled : ' + (u.out || 'unknown'));
  console.log('unit active  : ' + (a.out || 'unknown'));
  const l = run('loginctl', ['show-user', process.env.USER || '', '-p', 'Linger'], true);
  console.log('linger       : ' + (l.out || 'unknown'));
  console.log('--- daemon ---');
  const s = cli('status');
  console.log(s.out);
}

function cmdLogs(n) {
  const dir = join(HOME, 'logs');
  if (!existsSync(dir)) { note('no logs directory at ' + dir); return; }
  const files = readdirSync(dir).filter(f => statSync(join(dir, f)).isFile())
    .map(f => ({ f, m: statSync(join(dir, f)).mtimeMs })).sort((x, y) => y.m - x.m);
  if (files.length === 0) { note('logs directory is empty - the daemon may log to stdout only'); return; }
  console.log('log files (newest first):');
  for (const x of files.slice(0, 10)) console.log('  ' + x.f);
  const newest = join(dir, files[0].f);
  const lines = readFileSync(newest, 'utf8').split('\n');
  console.log('\n--- last ' + n + ' lines of ' + files[0].f + ' ---');
  console.log(lines.slice(-n).join('\n'));
}

function cmdUrl(open) {
  const st = readState();
  if (!st || !st.port) { fail('no daemon state - run: portrox start'); return; }
  const url = 'http://' + (st.host || '127.0.0.1') + ':' + st.port;
  console.log(url);
  if (!open) return;
  const wsl = existsSync('/proc/version') && /microsoft/i.test(readFileSync('/proc/version', 'utf8'));
  const r = wsl ? run('cmd.exe', ['/c', 'start', '', url], true) : run('xdg-open', [url], true);
  r.code === 0 ? ok('handed to the browser') : note('could not launch a browser - open the URL above yourself');
}

const [cmd, arg] = process.argv.slice(2);
switch (cmd) {
  case 'enable': cmdEnable(); break;
  case 'disable': cmdDisable(); break;
  case 'status': cmdStatus(); break;
  case 'logs': cmdLogs(Math.max(1, parseInt(arg || '40', 10) || 40)); break;
  case 'url': cmdUrl(false); break;
  case 'open': cmdUrl(true); break;
  default:
    console.log('usage: node scripts/portrox-service.mjs <enable|disable|status|logs [N]|url|open>');
    bad = cmd ? 1 : 0;
}
console.log(bad === 0 ? '\nSERVICE OK' : '\nSERVICE BAD=' + bad);
process.exit(bad === 0 ? 0 : 1);
