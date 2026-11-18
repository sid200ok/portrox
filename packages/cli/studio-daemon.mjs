/**
 * Portrox Studio daemon.
 * Binds 127.0.0.1:0 (kernel-assigned). State 0600 in 0700 dir.
 * ALL credentials are entered through this UI and stored via config-store.
 * No .env reads. No dependency on `gh auth`.
 */
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, rmSync, cpSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, extname, normalize, resolve, dirname, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { maskedConfig, setSupabase, signIn, signOut, setGithub, sb, gh, gitEnv, publicSupabase, loadConfig } from './config-store.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = process.env.PORTROX_REPO || resolve(HERE, '../..');
const HOME = process.env.PORTROX_HOME || join(homedir(), '.portrox');
const HOST = '127.0.0.1';
const STATE = join(HOME, 'state.json');
const TOKEN = randomBytes(24).toString('hex');
mkdirSync(HOME, { recursive: true, mode: 0o700 });
try { chmodSync(HOME, 0o700); } catch {}

const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg',
  '.jpeg':'image/jpeg', '.webp':'image/webp', '.ico':'image/x-icon', '.xml':'application/xml; charset=utf-8',
  '.txt':'text/plain; charset=utf-8', '.md':'text/markdown; charset=utf-8' };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sitesDir = join(REPO, 'sites');
const listSites = () => existsSync(sitesDir) ? readdirSync(sitesDir).filter(n => { try { return statSync(join(sitesDir,n)).isDirectory(); } catch { return false; } }) : [];
const cfgOf = n => { try { return JSON.parse(readFileSync(join(sitesDir,n,'site.json'),'utf8')); } catch { return {}; } };
const writeCfg = (n,c) => writeFileSync(join(sitesDir,n,'site.json'), JSON.stringify(c,null,2)+'\n');
const log = (...a) => console.log('[portrox]', ...a);
const slug = raw => String(raw||'').trim().toLowerCase().replace(/[^a-z0-9.-]/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'');

function git(args, cwd) {
  let env; try { env = gitEnv(); } catch (e) { return { ok:false, out:'', err:e.message }; }
  const r = spawnSync('git', args, { encoding:'utf8', cwd, env });
  return { ok: r.status === 0, out: String(r.stdout||'').trim(), err: String(r.stderr||'').trim() };
}

function targets(name, mode, login) {
  const base = slug(name);
  const m = ['user','project','org','custom'].includes(mode) ? mode : 'project';
  if (m === 'user') return { m, folder: login+'.github.io', repo: login+'/'+login+'.github.io', base_path:'', url:'https://'+login+'.github.io', owner: login };
  if (m === 'org') { if (!base) throw new Error('org mode needs the org login as name'); return { m, folder: base+'.github.io', repo: base+'/'+base+'.github.io', base_path:'', url:'https://'+base+'.github.io', owner: base }; }
  if (!base) throw new Error('name required');
  if (m === 'custom') return { m, folder: base+'.github.io', repo: login+'/'+base, base_path:'', url:'', owner: login };
  return { m, folder: base+'.github.io', repo: login+'/'+base, base_path:'/'+base, url:'https://'+login+'.github.io/'+base, owner: login };
}

function createSite({ name, mode, headline }) {
  const g = maskedConfig().github;
  if (!g.login) throw new Error('Setup → GitHub first (token determines the account).');
  const t = targets(name, mode, g.login);
  const root = join(sitesDir, t.folder);
  if (existsSync(root)) throw new Error('site already exists: ' + t.folder);
  for (const d of ['content','data','assets/avatars','assets/covers','assets/backgrounds']) mkdirSync(join(root,d),{recursive:true});
  const cfg = {
    id: t.folder, name: t.folder, owner: t.owner,
    pages: { mode: t.m, repo: t.repo, branch: 'gh-pages', base_path: t.base_path, cname: '' },
    seo: { title: (headline||t.folder)+' — Portfolio', description: 'Portfolio built with Portrox.', og_image: '' },
    nav: { services:true, appointments:true, about:true, client_auth:false },
    theme: { bg:'#020617', panel:'#0f172a', accent:'#22d3ee' },
    supabase: publicSupabase(),
    flags: { available_for_hire:true, paid_booking:false, auto_email:false },
    live_url: t.url, registered: false, published: false
  };
  writeCfg(t.folder, cfg);
  writeFileSync(join(root,'content/intro.md'), '# '+(headline||t.folder)+'\n\nBuilder. Engineer. Available for remote work.\n');
  writeFileSync(join(root,'content/about.md'), '## About me\n\nWrite your professional overview here.\n');
  writeFileSync(join(root,'data/profile.json'), JSON.stringify({ full_name: headline||t.folder, headline:'', location:'', hourly_rate:null, avatar:'', skills:[], links:{} },null,2)+'\n');
  for (const f of ['experience','projects','services']) writeFileSync(join(root,'data',f+'.json'),'[]\n');
  writeFileSync(join(root,'data/availability.json'), JSON.stringify({ timezone:'UTC', duration_minutes:30, weekly:[] },null,2)+'\n');
  return cfg;
}

async function registerSite(id) {
  const c = loadConfig();
  if (!c.supabase.user_id) throw new Error('Setup → Supabase sign-in first (owner identity).');
  const cfg = cfgOf(id);
  const row = { id, owner_id: c.supabase.user_id, display_name: (cfg.seo && cfg.seo.title) || id,
    pages_mode: cfg.pages.mode, repo: cfg.pages.repo, base_path: cfg.pages.base_path || '',
    seo: cfg.seo || {}, nav: cfg.nav || {}, flags: cfg.flags || {}, theme: cfg.theme || {}, is_published: false };
  const ins = await sb('/rest/v1/sites', { method:'POST', body: row, prefer:'return=representation' });
  if (ins.ok === false && ins.status !== 409) throw new Error('sites insert failed: ' + ins.status + ' ' + ins.text.slice(0,200));
  const mem = await sb('/rest/v1/site_members', { method:'POST', body: { site_id:id, user_id:c.supabase.user_id, role:'owner' }, prefer:'return=minimal' });
  if (mem.ok === false && mem.status !== 409) throw new Error('site_members insert failed: ' + mem.status + ' ' + mem.text.slice(0,200));
  cfg.registered = true; writeCfg(id, cfg);
  return { registered:true, site_id:id, owner_id:c.supabase.user_id };
}

async function buildOne(id) {
  const cfg = cfgOf(id);
  cfg.supabase = publicSupabase();          // sourced from UI config, never .env
  writeCfg(id, cfg);
  const { renderSite } = await import(join(REPO,'packages/core/render.mjs'));
  return renderSite(join(sitesDir,id), join(REPO,'dist',id));
}

async function ensureRepo(cfg) {
  const [owner, name] = cfg.pages.repo.split('/');
  const view = await gh('/repos/'+cfg.pages.repo);
  if (view.ok) return { repo: cfg.pages.repo, created:false };
  const g = maskedConfig().github;
  const body = { name, private:false, description:'Portfolio published by Portrox', has_issues:false, has_wiki:false };
  const cr = (owner === g.login) ? await gh('/user/repos',{method:'POST',body}) : await gh('/orgs/'+owner+'/repos',{method:'POST',body});
  if (cr.ok === false) throw new Error('repo create failed: '+cr.status+' '+cr.text.slice(0,200));
  return { repo: cfg.pages.repo, created:true };
}

async function configurePages(cfg) {
  const src = { branch: cfg.pages.branch || 'gh-pages', path: '/' };
  const body = { build_type:'legacy', source: src, ...(cfg.pages.mode==='custom' && cfg.pages.cname ? { cname: cfg.pages.cname, https_enforced:true } : {}) };
  let r = await gh('/repos/'+cfg.pages.repo+'/pages', { method:'POST', body });
  if (r.ok === false) r = await gh('/repos/'+cfg.pages.repo+'/pages', { method:'PUT', body });
  if (r.ok === false) throw new Error('pages config failed: '+r.status+' '+r.text.slice(0,200));
  const disabled = [];
  for (const wf of ['deploy-pages.yml','pages.yml']) {
    const d = await gh('/repos/'+cfg.pages.repo+'/actions/workflows/'+wf+'/disable', { method:'PUT' });
    if (d.ok) disabled.push(wf);
  }
  const check = await gh('/repos/'+cfg.pages.repo+'/pages');
  return { pages: check.json ? { build_type: check.json.build_type, source: check.json.source, status: check.json.status } : null, disabled_workflows: disabled };
}

async function publish(id) {
  const cfg = cfgOf(id);
  if (cfg.pages.mode === 'custom' && !cfg.pages.cname) throw new Error('custom mode: set pages.cname in site.json (your domain) before publishing');
  if (cfg.registered !== true) await registerSite(id);
  await ensureRepo(cfg);
  await buildOne(id);
  const src = join(REPO,'dist',id);
  const tmp = join(HOME,'publish-'+id.replace(/[^a-z0-9.-]/gi,'_')+'-'+Date.now());
  mkdirSync(tmp,{recursive:true,mode:0o700});
  try {
    const remote = 'https://github.com/'+cfg.pages.repo+'.git';
    if (git(['clone','--depth','1',remote,tmp]).ok === false) {
      git(['init','-q','-b','portrox-publish'],tmp);
      if (git(['remote','get-url','origin'],tmp).ok) git(['remote','set-url','origin',remote],tmp);
      else git(['remote','add','origin',remote],tmp);
    }
    const local = 'publish-'+Date.now();
    if (git(['checkout','--orphan',local],tmp).ok === false) throw new Error('orphan checkout failed');
    for (const e of readdirSync(tmp)) if (e !== '.git') rmSync(join(tmp,e),{recursive:true,force:true});
    cpSync(src,tmp,{recursive:true});
    writeFileSync(join(tmp,'.nojekyll'),'');
    git(['add','-A'],tmp);
    const cm = git(['-c','user.name=Portrox','-c','user.email=portrox@localhost','commit','-m','Publish via Portrox'],tmp);
    if (cm.ok === false && /nothing to commit/i.test(cm.out+cm.err) === false) throw new Error('commit failed: '+cm.err);
    const push = git(['push','-f','origin','HEAD:refs/heads/'+(cfg.pages.branch||'gh-pages')],tmp);
    if (push.ok === false) throw new Error('push failed: '+push.err.replace(/ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+/g,'[REDACTED]'));
    const pages = await configurePages(cfg);
    const patch = await sb('/rest/v1/sites?id=eq.'+encodeURIComponent(id), { method:'PATCH', body:{ is_published:true }, prefer:'return=minimal' });
    if (patch.ok === false) throw new Error('mark published failed: '+patch.status+' '+patch.text.slice(0,200));
    const c2 = cfgOf(id); c2.published = true; c2.registered = true; writeCfg(id,c2);
    return { url: cfg.live_url || '(set cname)', repo: cfg.pages.repo, branch: cfg.pages.branch||'gh-pages', is_published:true, ...pages };
  } finally { rmSync(tmp,{recursive:true,force:true}); }
}

function shell(port) {
  const rows = listSites().map(n => {
    const c = cfgOf(n);
    const built = existsSync(join(REPO,'dist',n,'index.html'));
    return '<tr><td><b>'+esc(n)+'</b><div class=dim>'+esc(c.seo&&c.seo.title)+'</div></td>'
      + '<td><span class=badge>'+esc(c.pages&&c.pages.mode)+'</span></td>'
      + '<td class=dim>'+esc(c.live_url||'(cname pending)')+'</td>'
      + '<td class=dim>'+(c.registered?'registered':'—')+' / '+(c.published?'live':'draft')+'</td>'
      + '<td>'+(built?'<a class=btn href="/preview/'+encodeURIComponent(n)+'/">Preview</a>':'<span class=dim>not built</span>')+'</td>'
      + '<td><button class=btn data-act=build data-id="'+esc(n)+'">Build</button> '
      + '<button class=btn data-act=register data-id="'+esc(n)+'">Register</button> '
      + '<button class="btn btn-p" data-act=publish data-id="'+esc(n)+'">Publish</button></td></tr>';
  }).join('');
  return `<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Portrox Studio</title><style>
:root{--bg:#020617;--panel:#0f172a;--line:#1e293b;--fg:#e2e8f0;--dim:#94a3b8;--acc:#22d3ee;--ok:#4ade80;--warn:#fcd34d}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
header{padding:20px 26px;border-bottom:1px solid var(--line);display:flex;gap:14px;align-items:center;flex-wrap:wrap}
h1{margin:0;font-size:19px}.dot{width:9px;height:9px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 4px #4ade8022}
main{max-width:1140px;margin:0 auto;padding:24px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px;margin-bottom:18px}
h3{margin:0 0 10px}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:11px;text-transform:uppercase;letter-spacing:.09em;color:var(--dim)}
.dim{color:var(--dim);font-size:12px}.badge{font-size:11px;padding:3px 9px;border-radius:999px;background:#22d3ee1a;color:var(--acc);border:1px solid #22d3ee44}
.btn{padding:7px 13px;border-radius:9px;background:#0b1220;border:1px solid var(--line);color:#fff;font-weight:600;font-size:12px;cursor:pointer;text-decoration:none;display:inline-block}
.btn-p{background:var(--acc);color:#04222b;border-color:var(--acc)}
input,select{width:100%;padding:10px;border-radius:9px;background:#0b1220;border:1px solid var(--line);color:#fff;font:inherit}
label{display:block;font-size:12px;color:var(--dim);margin:10px 0 4px}
.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(230px,1fr))}
pre{background:#0b1220;border:1px solid var(--line);padding:12px;border-radius:10px;overflow:auto;font-size:12px;max-height:300px}
.note{background:#22d3ee0d;border:1px solid #22d3ee33;border-radius:10px;padding:12px;font-size:13px;color:#cbd5e1}
.state{font-size:12px;margin-top:10px}
.good{color:var(--ok)}.bad{color:var(--warn)}
</style></head><body>
<header><span class=dot></span><h1>Portrox Studio</h1><span class=dim>127.0.0.1:${port} · kernel-assigned port · all credentials entered here</span></header>
<main>
<div class=card><h3>Setup · Supabase</h3>
<p class=note>Paste your <b>Project URL</b> and <b>publishable (anon)</b> key, then sign in with your Supabase Auth email/password. Sign-in establishes the site owner identity. Passwords are never stored; tokens are never sent back to this page.</p>
<div class=grid>
<div><label>Project URL</label><input id=sb-url placeholder="https://xxxx.supabase.co"></div>
<div><label>Publishable key</label><input id=sb-key type=password placeholder="sb_publishable_…"></div>
</div>
<p style="margin-top:12px"><button class=btn id=sb-save>Save Supabase</button></p>
<div class=grid>
<div><label>Auth email</label><input id=sb-email type=email autocomplete=username></div>
<div><label>Auth password</label><input id=sb-pass type=password autocomplete=current-password></div>
</div>
<p style="margin-top:12px"><button class="btn btn-p" id=sb-in>Sign in</button> <button class=btn id=sb-out>Sign out</button></p>
<div class=state id=sb-state></div></div>

<div class=card><h3>Setup · GitHub</h3>
<p class=note>Personal Access Token with <code>repo</code> + <code>workflow</code> scope. Used to create repositories, push rendered output, and configure Pages. Stored at <code>~/.portrox/config.json</code> (0600) and passed to git via environment only.</p>
<div class=grid><div><label>GitHub PAT</label><input id=gh-tok type=password placeholder="github_pat_… or ghp_…"></div></div>
<p style="margin-top:12px"><button class="btn btn-p" id=gh-save>Validate &amp; save</button></p>
<div class=state id=gh-state></div></div>

<div class=card><h3>Create new portfolio site</h3>
<p class=note>One account has exactly ONE <code>{account}.github.io</code> user site. Site #2 onward: <b>project</b> (<code>account.github.io/repo</code>), <b>org</b>, or <b>custom</b> domain.</p>
<div class=grid>
<div><label>Name / slug</label><input id=f-name placeholder="client-x"></div>
<div><label>Headline</label><input id=f-head placeholder="Client X"></div>
<div><label>Mode</label><select id=f-mode><option value=project>project (unlimited)</option><option value=user>user (one per account)</option><option value=org>org</option><option value=custom>custom domain</option></select></div>
</div>
<p style="margin-top:12px"><button class="btn btn-p" id=f-create>Create site</button></p></div>

<div class=card><h3>Sites</h3>
<table><thead><tr><th>Site</th><th>Mode</th><th>Live URL</th><th>DB / state</th><th>Local</th><th>Actions</th></tr></thead>
<tbody>${rows || '<tr><td colspan=6 class=dim>No sites yet.</td></tr>'}</tbody></table></div>

<div class=card><h3>Output</h3><pre id=out>Ready.</pre></div>
</main>
<script>
var TOKEN=${JSON.stringify(TOKEN)};
var out=document.getElementById('out');
function show(x){ out.textContent = typeof x==='string'? x : JSON.stringify(x,null,2); }
function api(p,b){ return fetch(p,{method:'POST',headers:{'Content-Type':'application/json','x-portrox-token':TOKEN},body:JSON.stringify(b||{})})
  .then(function(r){ return r.json().catch(function(){return {error:'bad json'};}).then(function(j){ if(r.ok===false) throw new Error(j.error||('HTTP '+r.status)); return j; }); }); }
function paint(c){
  var s=c.supabase,g=c.github;
  document.getElementById('sb-state').innerHTML = s.configured
    ? '<span class=good>URL saved</span> <span class=dim>'+s.url+' · key …'+s.key_tail+'</span><br>'+(s.signed_in?'<span class=good>signed in</span> <span class=dim>'+s.email+' · owner '+s.user_id+'</span>':'<span class=bad>not signed in</span>')
    : '<span class=bad>not configured</span>';
  document.getElementById('gh-state').innerHTML = g.configured
    ? '<span class=good>token saved</span> <span class=dim>'+g.login+' · …'+g.token_tail+' · scopes: '+(g.scopes||'(fine-grained)')+'</span>'
    : '<span class=bad>not configured</span>';
  if(s.url && !document.getElementById('sb-url').value) document.getElementById('sb-url').value=s.url;
  if(s.email && !document.getElementById('sb-email').value) document.getElementById('sb-email').value=s.email;
}
fetch('/api/config').then(function(r){return r.json();}).then(paint).catch(function(e){show('config: '+e.message);});
document.getElementById('sb-save').onclick=function(){ api('/api/config/supabase',{url:document.getElementById('sb-url').value,publishable_key:document.getElementById('sb-key').value}).then(function(c){paint(c);show('Supabase saved.');document.getElementById('sb-key').value='';}).catch(function(e){show('ERROR: '+e.message);}); };
document.getElementById('sb-in').onclick=function(){ api('/api/config/signin',{email:document.getElementById('sb-email').value,password:document.getElementById('sb-pass').value}).then(function(c){paint(c);show('Signed in.');document.getElementById('sb-pass').value='';}).catch(function(e){show('ERROR: '+e.message);}); };
document.getElementById('sb-out').onclick=function(){ api('/api/config/signout',{}).then(function(c){paint(c);show('Signed out.');}).catch(function(e){show('ERROR: '+e.message);}); };
document.getElementById('gh-save').onclick=function(){ api('/api/config/github',{token:document.getElementById('gh-tok').value}).then(function(c){paint(c);show('GitHub validated.');document.getElementById('gh-tok').value='';}).catch(function(e){show('ERROR: '+e.message);}); };
document.getElementById('f-create').onclick=function(){ api('/api/sites',{name:document.getElementById('f-name').value,headline:document.getElementById('f-head').value,mode:document.getElementById('f-mode').value}).then(function(j){show(j);setTimeout(function(){location.reload();},900);}).catch(function(e){show('ERROR: '+e.message);}); };
Array.prototype.forEach.call(document.querySelectorAll('button[data-act]'),function(b){
  b.onclick=function(){
    var id=b.getAttribute('data-id'),act=b.getAttribute('data-act');
    if(act==='publish' && !confirm('Provision repo if needed, force-push rendered output to '+id+', switch Pages to branch deploy, and mark the site live?')) return;
    show(act+' '+id+' …');
    api('/api/sites/'+encodeURIComponent(id)+'/'+act,{}).then(show).catch(function(e){show('ERROR: '+e.message);});
  };
});
</script></body></html>`;
}

function safeJoin(root, rel) {
  const base = resolve(root);
  const p = resolve(join(base, normalize(rel)));
  return (p === base || p.startsWith(base + sep)) ? p : null;
}
function readBody(req) {
  return new Promise(res => {
    let b='', over=false;
    req.on('data', c => { b+=c; if (b.length > 1e6) { over=true; req.removeAllListeners('data'); res({__oversize:true}); } });
    req.on('end', () => { if (over) return; try { res(JSON.parse(b||'{}')); } catch { res({}); } });
    req.on('error', () => res({}));
  });
}

const server = createServer(async (req,res) => {
  const port = server.address().port;
  const u = new URL(req.url,'http://127.0.0.1');
  const send=(c,b,t)=>{res.writeHead(c,{'Content-Type':t||'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(b);};
  const json=(c,o)=>send(c,JSON.stringify(o),MIME['.json']);
  try {
    const host=String(req.headers.host||'');
    if (host !== HOST+':'+port && host !== 'localhost:'+port) return json(403,{error:'bad host'});
    if (req.method==='GET' && u.pathname==='/api/health') return json(200,{ok:true,pid:process.pid,port,sites:listSites()});
    if (req.method==='GET' && u.pathname==='/api/config') return json(200,maskedConfig());
    if (req.method==='GET' && u.pathname==='/api/sites') return json(200,listSites().map(n=>({id:n,cfg:cfgOf(n)})));
    if (req.method==='GET' && (u.pathname==='/'||u.pathname==='/index.html')) return send(200,shell(port),MIME['.html']);

    if (req.method==='POST') {
      if (req.headers['x-portrox-token'] !== TOKEN) return json(403,{error:'bad token'});
      const origin=req.headers.origin;
      if (origin && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)===false) return json(403,{error:'bad origin'});
      const b=await readBody(req);
      if (b.__oversize) return json(413,{error:'body too large'});
      try {
        if (u.pathname==='/api/config/supabase') return json(200,setSupabase(b));
        if (u.pathname==='/api/config/signin')   return json(200,await signIn(b));
        if (u.pathname==='/api/config/signout')  return json(200,signOut());
        if (u.pathname==='/api/config/github')   return json(200,await setGithub(b));
        if (u.pathname==='/api/sites')           return json(200,createSite(b));
        const m=u.pathname.match(/^\/api\/sites\/([^/]+)\/(build|register|publish)$/);
        if (m) {
          const id=decodeURIComponent(m[1]);
          if (listSites().includes(id)===false) return json(404,{error:'unknown site'});
          if (m[2]==='build')    return json(200,await buildOne(id));
          if (m[2]==='register') return json(200,await registerSite(id));
          return json(200,await publish(id));
        }
      } catch(e){ return json(400,{error:String(e&&e.message||e).replace(/ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|sb_secret_[A-Za-z0-9_-]+/g,'[REDACTED]')}); }
      return json(404,{error:'not found'});
    }

    const pm=u.pathname.match(/^\/preview\/([^/]+)\/?(.*)$/);
    if (pm) {
      const site=decodeURIComponent(pm[1]);
      if (listSites().includes(site)===false) return send(404,'unknown site');
      let rel=decodeURIComponent(pm[2]||'');
      if (rel===''||rel.endsWith('/')) rel+='index.html';
      const f=safeJoin(join(REPO,'dist',site),rel);
      if (f===null||existsSync(f)===false||statSync(f).isFile()===false) return send(404,'not built - click Build');
      return send(200,readFileSync(f),MIME[extname(f).toLowerCase()]||'application/octet-stream');
    }
    send(404,'not found');
  } catch(e){ send(500,'error: '+String(e&&e.message||e).replace(/ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+/g,'[REDACTED]')); }
});

server.on('error',e=>{log('server error',e&&e.message);process.exit(1);});
server.listen(Number(process.env.PORTROX_PORT||0),HOST,()=>{
  const port=server.address().port;
  writeFileSync(STATE,JSON.stringify({pid:process.pid,port,host:HOST,url:'http://'+HOST+':'+port,token:TOKEN,startedAt:Date.now(),repo:REPO,version:'0.2.0'},null,2),{mode:0o600});
  try{chmodSync(STATE,0o600);}catch{}
  log('studio listening http://'+HOST+':'+port+' pid='+process.pid);
});
const bye=s=>{log(s+' -> shutdown');try{server.close();}catch{}process.exit(0);};
process.on('SIGTERM',()=>bye('SIGTERM'));
process.on('SIGINT',()=>bye('SIGINT'));
