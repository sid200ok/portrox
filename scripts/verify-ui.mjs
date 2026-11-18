/**
 * Verify the EMITTED browser script, not just the Node module.
 * `node --check studio-ui.mjs` cannot catch a bare \n inside the template
 * literal turning into a real newline in a single-quoted browser string.
 * This extracts every <script> block and syntax-checks it.
 */
import { renderApp, renderLogin } from '../packages/cli/studio-ui.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

let bad = 0;
const ok = m => console.log('OK   ' + m);
const fail = m => { bad++; console.log('FAIL ' + m); };
const box = mkdtempSync(join(tmpdir(), 'portrox-ui-'));

const auth = {
  username: 'admin', weakPassword: true, passwordRotated: false, rotated: false,
  usingDefaults: true, promptDismissed: false, recoveryConfigured: false,
  recoveryQuestions: [], recoveryRequired: 2, recoveryKeySet: false,
  questionBank: [{ id: 'nickname', label: 'Childhood nickname' }]
};
const csrf = 'a'.repeat(48);
const pages = {
  app: renderApp({ csrf, auth, port: 45000, pid: 1234, version: '0.3.0' }),
  login: renderLogin({ csrf, state: auth, port: 45000 })
};

try {
  for (const [name, html] of Object.entries(pages)) {
    const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    blocks.length > 0 ? ok(name + ': ' + blocks.length + ' script block(s), ' + html.length + 'B') : fail(name + ': no script block');
    blocks.forEach((src, i) => {
      const f = join(box, name + '-' + i + '.js');
      writeFileSync(f, src);
      const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
      if (r.status === 0) ok(name + ' script[' + i + '] parses (' + src.length + 'B)');
      else fail(name + ' script[' + i + '] SYNTAX ERROR: ' + String(r.stderr).split('\n').slice(0, 6).join(' | '));
    });
    // A bare newline inside a single-quoted JS string is the exact bug class.
    const suspicious = blocks.some(s => /'[^'\n]*\n[^']*'/.test(s));
    suspicious ? fail(name + ': newline inside a single-quoted string literal') : ok(name + ': no multi-line string literals');
  }

  const app = pages.app;
  for (const id of ['view', 'ttl', 'crumb', 'navtoggle', 'scrim', 'sb', 'secwarn', 'sync', 'refresh', 'signout', 'fixcreds', 'toasts', 'modalroot']) {
    app.includes('id="' + id + '"') ? ok('app has #' + id) : fail('app missing #' + id);
  }
  for (const r of ['dashboard', 'studio', 'settings', 'about']) {
    app.includes('data-nav="' + r + '"') ? ok('nav item ' + r) : fail('nav item ' + r + ' missing');
    app.includes("function v" + r.charAt(0).toUpperCase() + r.slice(1)) ? ok('view builder v' + r) : fail('view builder v' + r + ' missing');
  }
  for (const marker of ['navcollapsed', 'navright', 'navopen', 'toggleNav', 'portrox.nav', 'portrox.side', 'Ctrl', 'String.fromCharCode(10)']) {
    app.includes(marker) ? ok('nav/escape marker ' + marker) : fail('missing marker ' + marker);
  }
  for (const sub of ['supabase', 'github', 'security', 'appearance']) {
    app.includes("'" + sub + "'") ? ok('settings tab ' + sub) : fail('settings tab ' + sub + ' missing');
  }
  app.includes('AUTH.weakPassword') ? ok('warning gated on weakPassword') : fail('warning not gated on weakPassword');
  app.includes('recoveryAnswers') ? ok('atomic credentials+recovery payload') : fail('recovery not sent atomically');
  app.includes('Node 20+') ? ok('engine floor label correct') : fail('engine floor label wrong');
  app.includes('cdn.tailwindcss.com') || app.includes('unpkg.com') ? fail('runtime CDN present') : ok('zero CDN');
} finally {
  try { rmSync(box, { recursive: true, force: true }); } catch {}
}

console.log('\n' + (bad === 0 ? 'UI OK' : 'UI BAD=' + bad));
process.exit(bad === 0 ? 0 : 1);
