/**
 * Verify the EMITTED browser script (node --check is authoritative) and assert
 * the REAL surface. No substring heuristics; no assertions on dead code.
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
  app: renderApp({ csrf, auth, port: 45000, pid: 1234, version: '0.5.1' }),
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
      r.status === 0 ? ok(name + ' script[' + i + '] parses (' + src.length + 'B)')
        : fail(name + ' script[' + i + '] SYNTAX ERROR: ' + String(r.stderr).split('\n').slice(0, 6).join(' | '));
    });
    html.includes('</script></body>') ? ok(name + ': script closed before body end') : fail(name + ': script/body closure wrong');
    /<script[^>]*src=/.test(html) ? fail(name + ': external script tag (CDN)') : ok(name + ': no external script tags');
  }

  const app = pages.app;
  for (const id of ['view', 'ttl', 'crumb', 'navtoggle', 'scrim', 'sb', 'secwarn', 'sync', 'refresh', 'signout', 'fixcreds', 'toasts', 'modalroot'])
    app.includes('id="' + id + '"') ? ok('app has #' + id) : fail('app missing #' + id);
  for (const r of ['dashboard', 'studio', 'settings', 'about']) {
    app.includes('data-nav="' + r + '"') ? ok('nav item ' + r) : fail('nav item ' + r + ' missing');
    app.includes('function v' + r.charAt(0).toUpperCase() + r.slice(1)) ? ok('view builder v' + r) : fail('view builder v' + r + ' missing');
  }
  for (const m of ['navcollapsed', 'navright', 'navopen', 'toggleNav', 'portrox.nav', 'portrox.side', 'String.fromCharCode(10)'])
    app.includes(m) ? ok('marker ' + m) : fail('missing marker ' + m);
  for (const t of ['account', 'supabase', 'github', 'security', 'appearance'])
    app.includes("'" + t + "'") ? ok('settings tab ' + t) : fail('settings tab ' + t + ' missing');

  // Real surface, not dead code.
  app.includes('PORTROX_PROJECT_TAB') ? ok('project-binding tab present') : fail('project-binding tab missing (dead tab still shipped)');
  app.includes('PORTROX_GH_TAB') ? ok('GitHub ops tab present') : fail('GitHub ops tab missing');
  app.includes("'ghops'") ? ok('ghops settings tab registered') : fail('ghops tab not registered');
  app.includes('ghNewRepo') ? ok('create-repo modal present') : fail('create-repo modal missing');
  for (const ep of ['/api/github/repos','/api/github/pages/status','/api/github/pages/enable','/api/github/workflows','/api/github/runs','/api/github/secrets']) {
    app.includes(ep) ? ok('UI calls ' + ep) : fail('UI never calls ' + ep);
  }
  app.includes('gh-repo') ? ok('repository selector present') : fail('repository selector missing');
  app.includes('PORTROX_GH_CONN') ? ok('GitHub connection panel present') : fail('connection panel missing');
  app.includes('PORTROX_CONTENT_TAB') ? ok('content editor tab present') : fail('content editor tab missing - backend-only module');
  app.includes('PORTROX_INBOX_TAB') ? ok('inbox tab present') : fail('inbox tab missing - backend-only module');
  app.includes('PORTROX_MEDIA_TAB') ? ok('media tab present') : fail('media tab missing - backend-only module');
  app.includes('PORTROX_INTRO_TAB') ? ok('intro wizard tab present') : fail('intro tab missing - backend-only module');
  app.includes('PORTROX_BACKUP_TAB') ? ok('backup key tab present') : fail('backup tab missing');
  app.includes('/api/backup/run') ? ok('UI calls /api/backup/run') : fail('UI never calls /api/backup/run');
  app.includes('bk-key') ? fail('UI still renders the raw key in the DOM') : ok('UI never renders the raw key');
  app.includes('/api/backup/key/copy') ? ok('UI calls /api/backup/key/copy') : fail('UI never calls /api/backup/key/copy');
  app.includes('S.bk.fresh') ? fail('backup panel still holds a raw key in state') : ok('backup panel never holds a raw key');
  for (const act of ['bkrun','bkreplace']) {
    app.includes(act) ? ok('backup action ' + act) : fail('backup action ' + act + ' missing');
  }
  for (const ep of ['/api/backup/key','/api/backup/key/generate','/api/backup/key/confirm','/api/backup/key/clear']) {
    app.includes(ep) ? ok('UI calls ' + ep) : fail('UI never calls ' + ep);
  }
  for (const act of ['bkgen','bkcopy','bkconfirm','bkclear','bkstatus']) {
    app.includes(act) ? ok('backup action ' + act) : fail('backup action ' + act + ' missing');
  }
  for (const ep of ['/api/intro/','/api/intro/preview','/api/intro/save']) {
    app.includes(ep) ? ok('UI calls ' + ep) : fail('UI never calls ' + ep);
  }
  for (const id of ['iw-site','iw-name','iw-headline','iw-skills','iw-seeking']) {
    app.includes(id) ? ok('intro control ' + id) : fail('intro control ' + id + ' missing');
  }
  for (const act of ['iwload','iwpreview','iwsave']) {
    app.includes(act) ? ok('intro action ' + act) : fail('intro action ' + act + ' missing');
  }
  for (const ep of ['/api/media/','/api/media/upload','/api/media/delete','/api/media/avatar']) {
    app.includes(ep) ? ok('UI calls ' + ep) : fail('UI never calls ' + ep);
  }
  for (const id of ['md-site','md-file','md-alt']) {
    app.includes(id) ? ok('media control ' + id) : fail('media control ' + id + ' missing');
  }
  for (const act of ['mdload','mdup','mdavatar','mddel']) {
    app.includes(act) ? ok('media action ' + act) : fail('media action ' + act + ' missing');
  }
  for (const ep of ['/api/inbox/','/api/inbox/triage','/api/inbox/delete']) {
    app.includes(ep) ? ok('UI calls ' + ep) : fail('UI never calls ' + ep);
  }
  for (const id of ['ib-site','ib-kind','ib-triage']) {
    app.includes(id) ? ok('inbox control ' + id) : fail('inbox control ' + id + ' missing');
  }
  for (const act of ['ibload','ibtri','ibdel']) {
    app.includes(act) ? ok('inbox action ' + act) : fail('inbox action ' + act + ' missing');
  }
  app.includes("'content'") ? ok('content settings tab registered') : fail('content tab not registered');
  for (const ep of ['/api/content/','/api/content/write']) {
    app.includes(ep) ? ok('UI calls ' + ep) : fail('UI never calls ' + ep);
  }
  for (const id of ['ct-site','ct-file','ct-text']) {
    app.includes(id) ? ok('editor control ' + id) : fail('editor control ' + id + ' missing');
  }
  for (const act of ['ctload','ctopen','ctsave','ctsavebuild']) {
    app.includes(act) ? ok('editor action ' + act) : fail('editor action ' + act + ' missing');
  }
  for (const ep of ['/api/gh/auth/status','/api/gh/auth/connect','/api/gh/auth/system','/api/gh/auth/disconnect','/api/github/secret/set','/api/gh/console','/api/supabase/advisors']) {
    app.includes(ep) ? ok('UI calls ' + ep) : fail('UI never calls ' + ep);
  }
  app.includes('ghc-tok') ? ok('PAT field present') : fail('PAT field missing');
  app.includes('sbadv') ? ok('advisor load action present') : fail('advisor action missing');
  app.includes('/api/config/test-db') ? fail('dead endpoint /api/config/test-db still referenced') : ok('no dead test-db endpoint');
  app.includes('/api/config/supabase') ? fail('dead endpoint /api/config/supabase still referenced') : ok('no dead config/supabase endpoint');
  app.includes('db_configured') ? fail('removed field db_configured still read') : ok('no removed db_configured field');
  app.includes('sb.account&&sb.account.configured') ? ok('checklist uses account state') : fail('checklist not re-pointed at account');
  app.includes('sb.schema_complete') ? ok('checklist uses schema_complete') : fail('checklist missing schema step');
  app.includes("a==='pboot'") ? ok('bootstrap action present') : fail('bootstrap action missing');
  app.includes('sb-tok') ? ok('account token field present') : fail('account token field missing');
  app.includes('db-ref') ? ok('per-site project selector present') : fail('per-site project selector missing');
  app.includes('newProjectModal') ? ok('create-project modal present') : fail('create-project modal missing');
  app.includes('free_limit') ? ok('free project cap surfaced') : fail('free project cap not surfaced');
  app.includes('AUTH.weakPassword') ? ok('warning gated on weakPassword') : fail('warning not gated on weakPassword');
  app.includes('recoveryAnswers') ? ok('atomic credentials+recovery payload') : fail('recovery not atomic');
  app.includes('f-sbin') ? fail('obsolete Supabase Auth sign-in form present') : ok('Supabase Auth sign-in removed');
  (app.includes('cdn.tailwindcss.com') || app.includes('unpkg.com')) ? fail('runtime CDN present') : ok('zero CDN');
} finally {
  try { rmSync(box, { recursive: true, force: true }); } catch {}
}
console.log('\n' + (bad === 0 ? 'UI OK' : 'UI BAD=' + bad));
process.exit(bad === 0 ? 0 : 1);
