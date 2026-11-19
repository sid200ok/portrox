#!/usr/bin/env node
/**
 * Portrox CLI.
 *  - Never picks a port. Daemon binds 127.0.0.1:0; kernel assigns.
 *  - stop/restart signal a PID only after proving it is our daemon.
 *  - Never pkill, never system-scope systemd.
 *  - Credentials come ONLY from the UI-written store.
 *  - Site CREATION lives in the Studio UI only.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, openSync, readdirSync, statSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicSupabaseFor, maskedConfig } from './config-store.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const HOME = process.env.PORTROX_HOME || join(homedir(), '.portrox');
const STATE = join(HOME, 'state.json');
const LOGDIR = join(HOME, 'logs');
const LOG = join(LOGDIR, 'studio.log');
const DAEMON = join(HERE, 'studio-daemon.mjs');
const PLAT = platform();
const C = { d: '\x1b[2m', b: '\x1b[1m', c: '\x1b[36m', g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', x: '\x1b[0m' };
const say = (...a) => console.log(...a);
const ok = m => say(C.g + 'OK  ' + C.x + m);
const warn = m => say(C.y + '!   ' + C.x + m);
const die = m => { say(C.r + 'FAIL ' + C.x + m); process.exit(1); };
mkdirSync(LOGDIR, { recursive: true });

const readState = () => { try { return JSON.parse(readFileSync(STATE, 'utf8')); } catch { return null; } };
const clearState = () => { try { unlinkSync(STATE); } catch {} };
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

function ours(pid) {
  if (alive(pid) === false) return false;
  try {
    if (PLAT === 'linux') return readFileSync('/proc/' + pid + '/cmdline', 'utf8').includes('studio-daemon.mjs');
    if (PLAT === 'win32') {
      const r = spawnSync('powershell', ['-NoProfile', '-Command', '(Get-CimInstance Win32_Process -Filter "ProcessId=' + pid + '").CommandLine'], { encoding: 'utf8' });
      return String(r.stdout || '').includes('studio-daemon.mjs');
    }
    const r = spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
    return String(r.stdout || '').includes('studio-daemon.mjs');
  } catch { return false; }
}
function rssMB(pid) {
  try {
    if (PLAT === 'linux') {
      const m = readFileSync('/proc/' + pid + '/status', 'utf8').match(/VmRSS:\s+(\d+)/);
      if (m) return (Number(m[1]) / 1024).toFixed(1);
    } else {
      const r = spawnSync('ps', ['-p', String(pid), '-o', 'rss='], { encoding: 'utf8' });
      const n = parseInt(String(r.stdout || '').trim(), 10);
      if (n) return (n / 1024).toFixed(1);
    }
  } catch {}
  return '?';
}
const uptime = ms => {
  const s = Math.floor((Date.now() - ms) / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? h + 'h ' + m + 'm' : m ? m + 'm ' + (s % 60) + 's' : s + 's';
};
const sitesDir = join(REPO, 'sites');
const listSites = () => existsSync(sitesDir)
  ? readdirSync(sitesDir).filter(n => { try { return statSync(join(sitesDir, n)).isDirectory(); } catch { return false; } })
  : [];

async function waitState(prevPid, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = readState();
    if (s && s.pid && s.port && s.pid !== prevPid && alive(s.pid)) return s;
    await new Promise(r => setTimeout(r, 150));
  }
  return null;
}

async function cmdStart() {
  const s = readState();
  if (s && ours(s.pid)) { ok('already ACTIVE'); say('  ' + C.c + s.url + C.x); return; }
  if (s) clearState();
  if (existsSync(DAEMON) === false) die('daemon missing: ' + DAEMON);
  const fd = openSync(LOG, 'a');
  const child = spawn(process.execPath, [DAEMON], {
    detached: true, stdio: ['ignore', fd, fd],
    env: { ...process.env, PORTROX_HOME: HOME, PORTROX_REPO: REPO, PORTROX_PORT: '0', PORTROX_HOST: '127.0.0.1' }
  });
  child.unref();
  const st = await waitState(s ? s.pid : undefined);
  if (st === null) { warn('no state after 20s - run: portrox logs'); die('start failed'); }
  ok('Portrox Studio ACTIVE');
  say('  ' + C.b + 'URL' + C.x + '   ' + C.c + st.url + C.x);
  say('  ' + C.d + 'PID' + C.x + '   ' + st.pid);
  say('  ' + C.d + 'PORT' + C.x + '  ' + st.port + ' ' + C.d + '(kernel-assigned, dynamic)' + C.x);
  say('  ' + C.d + 'BIND' + C.x + '  127.0.0.1 ' + C.d + '(localhost only)' + C.x);
  say('  ' + C.d + 'SITES' + C.x + ' ' + listSites().length);
}

async function cmdStop() {
  const s = readState();
  if (s === null || !s.pid) { warn('STOPPED (no state)'); clearState(); return; }
  if (ours(s.pid) === false) { warn('PID ' + s.pid + ' is not Portrox - refusing to signal. Clearing stale state.'); clearState(); return; }
  try { process.kill(s.pid, 'SIGTERM'); } catch {}
  for (let i = 0; i < 50; i++) { if (alive(s.pid) === false) break; await new Promise(r => setTimeout(r, 100)); }
  if (alive(s.pid) && ours(s.pid)) { try { process.kill(s.pid, 'SIGKILL'); } catch {} }
  clearState(); ok('STOPPED');
}

function cmdStatus() {
  const s = readState();
  if (s === null || ours(s.pid) === false) { say(C.y + 'STOPPED' + C.x); if (s) clearState(); return; }
  say(C.g + 'ACTIVE' + C.x);
  say('  URL     ' + C.c + s.url + C.x);
  say('  PID     ' + s.pid);
  say('  PORT    ' + s.port);
  say('  BIND    127.0.0.1');
  say('  UPTIME  ' + uptime(s.startedAt));
  say('  MEMORY  ' + rssMB(s.pid) + ' MB');
  say('  REPO    ' + s.repo);
  say('  SITES   ' + (listSites().join(', ') || '(none)'));
  const m = maskedConfig().supabase;
  say('  ACCOUNT ' + (m.account.configured ? 'token set' : 'MISSING') + ' · orgs=' + (m.account.orgs || []).length);
  say('  PROJECTS ' + m.project_count + ' total · ' + m.active_count + '/' + m.free_limit + ' active (free cap)');
  say('  DEFAULT ' + (m.project_ref || '(none)') + ' · ready=' + (m.project_ready ? 'yes' : 'no') + ' · healthy=' + (m.db_ok ? 'yes' : 'no') + ' · schema=' + m.schema_files + ' files');
  const g = maskedConfig().github;
  say('  GITHUB  ' + (g.configured ? (g.login || 'token set') : 'MISSING'));
}

function cmdLogs() {
  if (existsSync(LOG) === false) return warn('no log yet: ' + LOG);
  const r = spawnSync('tail', ['-n', '80', LOG], { encoding: 'utf8' });
  if (r.status === 0) process.stdout.write(r.stdout);
  say(C.d + '-- following (Ctrl-C exits tail; daemon keeps running) --' + C.x);
  const t = spawn('tail', ['-f', LOG], { stdio: 'inherit' });
  process.on('SIGINT', () => { try { t.kill('SIGTERM'); } catch {} process.exit(0); });
}

const isWSL = () => PLAT === 'linux' && /microsoft|wsl/i.test((() => { try { return readFileSync('/proc/version', 'utf8'); } catch { return ''; } })());
const systemdUser = () => PLAT === 'linux' && spawnSync('systemctl', ['--user', 'is-system-running'], { encoding: 'utf8' }).status === 0;

function cmdEnableAutostart() {
  const node = process.execPath;
  const cli = join(REPO, 'packages/cli/portrox.mjs');
  if (PLAT === 'linux' && systemdUser()) {
    const dir = join(homedir(), '.config', 'systemd', 'user');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'portrox.service'),
      '[Unit]\nDescription=Portrox Studio (localhost, dynamic port)\nAfter=default.target\n\n[Service]\nType=oneshot\nRemainAfterExit=yes\nEnvironment=PORTROX_HOME=' + HOME + '\nEnvironment=PORTROX_REPO=' + REPO + '\nExecStart=' + node + ' ' + cli + ' start\nExecStop=' + node + ' ' + cli + ' stop\n\n[Install]\nWantedBy=default.target\n');
    spawnSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'inherit' });
    if (spawnSync('systemctl', ['--user', 'enable', 'portrox.service'], { stdio: 'inherit' }).status !== 0) die('systemctl enable failed');
    return ok('autostart ENABLED (systemd --user, next login)');
  }
  if (PLAT === 'darwin') {
    const dir = join(homedir(), 'Library', 'LaunchAgents');
    mkdirSync(dir, { recursive: true });
    const p = join(dir, 'io.portrox.studio.plist');
    writeFileSync(p, '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>io.portrox.studio</string>\n<key>ProgramArguments</key><array><string>' + node + '</string><string>' + cli + '</string><string>start</string></array>\n<key>RunAtLoad</key><true/>\n<key>StandardOutPath</key><string>' + LOG + '</string>\n<key>StandardErrorPath</key><string>' + LOG + '</string>\n</dict></plist>\n');
    spawnSync('launchctl', ['unload', p], { stdio: 'ignore' });
    if (spawnSync('launchctl', ['load', p], { stdio: 'inherit' }).status !== 0) die('launchctl load failed');
    return ok('autostart ENABLED (launchd)');
  }
  if (PLAT === 'win32') {
    const startup = join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'portrox.vbs');
    writeFileSync(startup, 'Set s=CreateObject("WScript.Shell")\ns.Run """' + node + '"" ""' + cli + '"" start",0,False\n');
    return ok('autostart ENABLED (Startup folder)');
  }
  const rc = join(homedir(), '.bashrc');
  const marker = '# >>> portrox autostart >>>';
  const cur = existsSync(rc) ? readFileSync(rc, 'utf8') : '';
  if (cur.includes(marker)) return ok('autostart already ENABLED (shell hook)');
  writeFileSync(rc, cur + '\n' + marker + '\nif [ -z "$PORTROX_AUTOSTART_DONE" ]; then\n  export PORTROX_AUTOSTART_DONE=1\n  "' + node + '" "' + cli + '" start >/dev/null 2>&1 || true\nfi\n# <<< portrox autostart <<<\n');
  if (isWSL()) warn('WSL without systemd - installed guarded shell hook in ' + rc);
  ok('autostart ENABLED (once per login shell)');
}

function cmdDisableAutostart() {
  let did = false;
  if (PLAT === 'linux') {
    const u = join(homedir(), '.config', 'systemd', 'user', 'portrox.service');
    if (existsSync(u)) {
      spawnSync('systemctl', ['--user', 'disable', 'portrox.service'], { stdio: 'ignore' });
      spawnSync('systemctl', ['--user', 'stop', 'portrox.service'], { stdio: 'ignore' });
      unlinkSync(u); spawnSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' }); did = true;
    }
  }
  if (PLAT === 'darwin') {
    const p = join(homedir(), 'Library', 'LaunchAgents', 'io.portrox.studio.plist');
    if (existsSync(p)) { spawnSync('launchctl', ['unload', p], { stdio: 'ignore' }); unlinkSync(p); did = true; }
  }
  if (PLAT === 'win32') {
    const p = join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'portrox.vbs');
    if (existsSync(p)) { unlinkSync(p); did = true; }
  }
  for (const f of ['.bashrc', '.zshrc']) {
    const rc = join(homedir(), f);
    if (existsSync(rc) === false) continue;
    const s = readFileSync(rc, 'utf8');
    const re = /# >>> portrox autostart >>>[\s\S]*?# <<< portrox autostart <<<\n?/;
    if (re.test(s)) { writeFileSync(rc, s.replace(re, '')); did = true; }
  }
  did ? ok('autostart DISABLED') : warn('autostart was not enabled');
}

/**
 * UNIFIED BUILD PATH. Both `portrox build` and the Studio Build button inject
 * credentials from the UI store, so the artifact never depends on entry point.
 */
function applyUiConfig(id) {
  const p = join(sitesDir, id, 'site.json');
  const cfg = JSON.parse(readFileSync(p, 'utf8'));
  // PORTROX_RESOLVED_REF: report what was ACTUALLY used, not the raw field.
  const declared = (cfg.database && cfg.database.project_ref) || '';
  cfg.supabase = publicSupabaseFor(declared);
  const ref = declared || maskedConfig().supabase.project_ref || '';
  writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n');
  return { cfg, ref };
}

async function cmdBuild(which) {
  const { renderSite } = await import(join(REPO, 'packages/core/render.mjs'));
  const targets = which === '--all' ? listSites() : [which];
  if (targets.length === 0) die('no sites. Create one from the Studio UI: portrox start');
  for (const t of targets) {
    const { cfg, ref } = applyUiConfig(t);
    // Forms predicate is PROJECT readiness, not account-token presence.
    if (cfg.supabase.url === '') warn(t + ': no publishable key for project ' + (ref || '(unbound)') + ' — forms rendered DISABLED');
    const r = await renderSite(join(sitesDir, t), join(REPO, 'dist', t));
    const { normalizeDir } = await import(join(REPO, 'packages/core/html-normalize.mjs'));
    const nz = normalizeDir(join(REPO, 'dist', t));
    for (const d of nz.details) say('  ' + C.d + 'normalized ' + d + C.x);
    ok('built ' + t + ' -> dist/' + t + ' (' + r.pages + ' pages, ' + r.bytes + ' bytes, project=' + (ref || 'none') + ', forms=' + (cfg.supabase.url ? 'on' : 'off') + ')');
  }
}

function cmdDoctor() {
  const chk = (n, c, hint) => say((c ? C.g + 'OK  ' : C.r + 'FAIL ' + C.x) + n + (c === false && hint ? '  ' + C.d + hint + C.x : ''));
  say(C.b + 'Portrox doctor' + C.x);
  chk('Node ' + process.version, Number(process.versions.node.split('.')[0]) >= 20, 'need >=20');
  chk('git', spawnSync('git', ['--version']).status === 0);
  chk('psql (fallback only)', spawnSync('which', ['psql']).status === 0, 'sudo apt-get install -y postgresql-client');
  chk('renderer present', existsSync(join(REPO, 'packages/core/render.mjs')));
  chk('config store present', existsSync(join(REPO, 'packages/cli/config-store.mjs')));
  chk('mgmt client present', existsSync(join(REPO, 'packages/cli/supabase-mgmt.mjs')));
  chk('sites present', listSites().length > 0, 'create from Studio UI');
  const s = readState();
  chk('daemon', Boolean(s && ours(s.pid)), 'portrox start');
  const m = maskedConfig();
  chk('Supabase account token', m.supabase.account.configured, 'Studio -> Settings -> Supabase account');
  chk('Supabase projects loaded', m.supabase.project_count > 0, 'Refresh projects in the account tab');
  chk('Default project ready (url+key)', m.supabase.project_ready, 'Fetch key for the default project');
  chk('Default project healthy', m.supabase.db_ok, 'Health check in the project tab');
  chk('Portrox schema recorded', m.supabase.schema_complete, 'Bootstrap schema, or reconcile from supabase_migrations');
  chk('GitHub token', m.github.configured, 'Studio -> Settings -> GitHub');
  if (isWSL()) warn('WSL detected - autostart uses guarded shell hook unless systemd --user is live');
  say(C.d + 'state: ' + STATE + C.x);
  say(C.d + 'logs : ' + LOG + C.x);
}

function cmdHelp() {
  const rows = [
    ['start', 'Start Studio (127.0.0.1, kernel-assigned dynamic port)'],
    ['stop', 'Stop daemon (verifies PID ownership first)'],
    ['restart', 'Stop then start; prints the new URL'],
    ['status', 'Daemon + account + projects + default-project readiness'],
    ['logs', 'Tail ~/.portrox/logs/studio.log'],
    ['enable-autostart', 'Register login autostart (systemd/launchd/Startup/shell)'],
    ['disable-autostart', 'Remove autostart registration'],
    ['build <site>|--all', 'Render static site(s) into dist/ (UI credentials injected)'],
    ['doctor', 'Check prerequisites and UI configuration'],
    ['help', 'This table'],
  ];
  say('\n' + C.b + C.c + 'PORTROX' + C.x + ' ' + C.d + '- self-hostable portfolio engine' + C.x + '\n');
  say(C.b + 'USAGE' + C.x + '  portrox <command>   ' + C.d + '(alias: px)' + C.x + '\n');
  const w = Math.max(...rows.map(r => r[0].length));
  for (const [c, d] of rows) say('  ' + C.c + c.padEnd(w) + C.x + '  ' + d);
  say('\n' + C.d + 'Sites are created and credentials entered ONLY in the Studio UI.' + C.x);
  say(C.d + 'Localhost only. No fixed ports. Nothing here can kill your session.' + C.x + '\n');
}

const [cmd, arg] = process.argv.slice(2);
try {
  switch (cmd) {
    case 'start': await cmdStart(); break;
    case 'stop': await cmdStop(); break;
    case 'restart': await cmdStop(); await cmdStart(); break;
    case 'status': cmdStatus(); break;
    case 'logs': cmdLogs(); break;
    case 'enable-autostart': cmdEnableAutostart(); break;
    case 'disable-autostart': cmdDisableAutostart(); break;
    case 'doctor': cmdDoctor(); break;
    case 'build': await cmdBuild(arg || '--all'); break;
    case undefined: case 'help': case '--help': case '-h': cmdHelp(); break;
    default: die('unknown command "' + cmd + '" - try: portrox help');
  }
} catch (e) { die(e && e.message ? e.message : String(e)); }
