/**
 * Verify the EMITTED browser script.
 * node --check IS the parser and is authoritative. A regex heuristic that
 * looks for "a newline between two single quotes" matches ordinary JS such as
 *   var a = 'x';
 *   var b = 'y';
 * and produced false failures. It has been removed permanently.
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
  app: renderApp({ csrf, auth, port: 45000, pid: 1234, version: '0.4.0' }),
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
    // Real structural hazards, not quote heuristics.
    html.includes('</script></body>') ? ok(name + ': script closed before body end') : fail(name + ': script/body closure wrong');
    /<script[^>]*src=/.test(html) ? fail(name + ': external script tag (CDN) present') : ok(name + ': no external script tags');
  }

  const app = pages.app;
  for (const id of ['view', 'ttl', 'crumb', 'navtoggle', 'scrim', 'sb', 'secwarn', 'sync', 'refresh', 'signout', 'fixcreds', 'toasts', 'modalroot']) {
    app.includes('id="' + id + '"') ? ok('app has #' + id) : fail('app missing #' + id);
  }
  for (const r of ['dashboard', 'studio', 'settings', 'about']) {
    app.includes('data-nav="' + r + '"') ? ok('nav item ' + r) : fail('nav item ' + r + ' missing');
    app.includes('function v' + r.charAt(0).toUpperCase() + r.slice(1)) ? ok('view builder v' + r) : fail('view builder v' + r + ' missing');
  }
  for (const m of ['navcollapsed', 'navright', 'navopen', 'toggleNav', 'portrox.nav', 'portrox.side', 'String.fromCharCode(10)']) {
    app.includes(m) ? ok('marker ' + m) : fail('missing marker ' + m);
  }
  for (const t of ['supabase', 'github', 'security', 'appearance']) {
    app.includes("'" + t + "'") ? ok('settings tab ' + t) : fail('settings tab ' + t + ' missing');
  }
  app.includes('AUTH.weakPassword') ? ok('warning gated on weakPassword') : fail('warning not gated on weakPassword');
  app.includes('recoveryAnswers') ? ok('atomic credentials+recovery payload') : fail('recovery not atomic');
  app.includes('sb-dbpw') ? ok('database password field present') : fail('database password field missing');
  app.includes('db_configured') ? ok('database state surfaced') : fail('database state not surfaced');
  app.includes('f-sbin') ? fail('obsolete Supabase Auth sign-in form still present') : ok('Supabase Auth sign-in removed');
  app.includes('cdn.tailwindcss.com') || app.includes('unpkg.com') ? fail('runtime CDN present') : ok('zero CDN');
} finally {
  try { rmSync(box, { recursive: true, force: true }); } catch {}
}

console.log('\n' + (bad === 0 ? 'UI OK' : 'UI BAD=' + bad));
process.exit(bad === 0 ? 0 : 1);
