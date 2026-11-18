import { readFileSync, writeFileSync } from 'node:fs';
const F = 'packages/cli/studio-ui.mjs';
let s = readFileSync(F, 'utf8');
let n = 0;
function must(label, from, to) {
  if (s.includes(from) === false) {
    if (s.includes(to)) { console.log('SKIP already applied: ' + label); return; }
    console.error('FAIL anchor missing: ' + label); process.exit(1);
  }
  s = s.split(from).join(to); n++; console.log('OK   ' + label);
}

/* 1. Whole Supabase settings panel, delimited by the next branch. */
const START = "  if(S.sub==='supabase'){";
const END = "  } else if(S.sub==='github'){";
const NEW = `  if(S.sub==='supabase'){
    var regions=sb.regions||[];
    body='<div class="card"><header><h3>Supabase project</h3>'+(sb.configured?'<span class="pill ok"><span class="dot"></span>Saved</span>':'<span class="pill mute">Not set</span>')+'</header>'
      +'<p class="desc">Three values only. The connection string is <b>derived for you</b> from the project reference — you never type a DSN. The publishable key is public and is the only key that reaches a rendered site.</p>'
      +'<form id="f-sb">'
      +'<div class="field"><label>Project URL</label><input class="inp mono" id="sb-url" placeholder="https://xxxx.supabase.co" value="'+h(sb.url||'')+'"></div>'
      +'<div class="field"><label>Publishable key</label><div class="pw"><input class="inp mono" id="sb-key" type="password" placeholder="sb_publishable_…"></div>'
      +'<p class="hint">'+(sb.configured?'Stored key ends ·'+h(sb.key_tail)+'. Leave blank to keep it.':'Supabase → Project Settings → API → publishable / anon key.')+'</p></div>'
      +'<div class="field"><label>Database password</label><div class="pw"><input class="inp mono" id="sb-dbpw" type="password" placeholder="your Supabase database password" autocomplete="new-password"></div>'
      +'<p class="hint">'+(sb.db_configured?'Stored password ends ·'+h(sb.db_password_tail)+'. Leave blank to keep it.':'Supabase → Project Settings → Database. Only the password is asked; host, port, user and database are filled in automatically.')+'</p></div>'
      +'<div class="field"><label>Project region (for the IPv4 pooler)</label><select class="inp" id="sb-region"><option value="">— direct connection only —</option>'
      +regions.map(function(r){return '<option value="'+h(r)+'"'+(sb.region===r?' selected':'')+'>'+h(r)+'</option>'}).join('')+'</select>'
      +'<p class="hint">The direct host is IPv6-only on the free tier. If WSL has no IPv6 route, select your region so the IPv4 session pooler can be used.</p></div>'
      +'<button class="btn pri" type="submit">Save project</button></form></div>'
      +'<div class="card" style="margin-top:14px"><header><h3>Database connection</h3>'
      +(sb.db_ok?'<span class="pill ok"><span class="dot"></span>Reachable</span>':(sb.db_configured?'<span class="pill warn">Untested</span>':'<span class="pill mute">Password needed</span>'))+'</header>'
      +'<p class="desc">The Studio connects as the database administrator over TLS. Credentials travel in the process environment and SQL on stdin — never in a command line.</p>'
      +'<dl class="kv"><dt>Project ref</dt><dd class="mono">'+h(sb.project_ref||'—')+'</dd>'
      +'<dt>Direct DSN</dt><dd class="mono">'+h(sb.dsn_direct||'—')+'</dd>'
      +'<dt>Pooler DSN</dt><dd class="mono">'+h(sb.dsn_pooler||'— select a region —')+'</dd>'
      +'<dt>Last mode</dt><dd>'+h(sb.db_mode||'—')+'</dd>'
      +'<dt>Server</dt><dd>'+h(sb.server_version||'—')+'</dd></dl>'
      +(sb.db_error?'<div class="alert err" style="margin-top:14px">'+h(sb.db_error)+'</div>':'')
      +'<div class="hr"></div><button class="btn pri" data-act="dbtest">'+ic('db')+'<span>Test connection</span></button>'
      +'<p class="hint" style="margin-top:10px">Requires <span class="mono">psql</span>. Install with <span class="mono">sudo apt-get install -y postgresql-client</span>.</p></div>';
  } else if(S.sub==='github'){`;
if (s.includes(START) && s.includes(END)) {
  const i = s.indexOf(START), j = s.indexOf(END, i);
  if (i < 0 || j < 0) { console.error('FAIL supabase panel bounds'); process.exit(1); }
  const old = s.slice(i, j + END.length);
  if (old.includes('sb-dbpw')) console.log('SKIP already applied: supabase panel');
  else { s = s.slice(0, i) + NEW + s.slice(j + END.length); n++; console.log('OK   supabase panel replaced'); }
} else { console.error('FAIL supabase panel markers absent'); process.exit(1); }

/* 2. Setup checklist. */
must('setup steps',
  "    {d:!!sb.configured,t:'Connect Supabase',s:'Project URL and publishable key'},\n    {d:!!sb.signed_in,t:'Sign in to Supabase',s:'Establishes the site owner identity'},",
  "    {d:!!sb.configured,t:'Connect Supabase project',s:'Project URL and publishable key'},\n    {d:!!sb.db_configured,t:'Set the database password',s:'The DSN is derived; only the password is asked'},\n    {d:!!sb.db_ok,t:'Verify the database connection',s:'Read-only probe over TLS'},");

/* 3. Dashboard metric. */
must('db metric',
  "   +metric('db','Supabase',sb.signed_in?'Ready':(sb.configured?'Sign in':'Off'),sb.configured?(sb.url||''):'not connected')",
  "   +metric('db','Supabase',sb.db_ok?'Ready':(sb.db_configured?'Test DB':(sb.configured?'Password':'Off')),sb.configured?(sb.project_ref||sb.url||''):'not connected')");

/* 4. Form handlers. */
must('sb handlers',
  "  if((f=$('f-sb')))f.onsubmit=function(e){e.preventDefault();busy(e.target,true);\n    api('/api/config/supabase',{url:$('sb-url').value,publishable_key:$('sb-key').value}).then(function(c){S.cfg=c;toast('Supabase connection saved.','ok');logline('supabase connection saved','ok');render()}).catch(function(x){toast(x.message,'err');logline('supabase: '+x.message,'err')}).finally(function(){busy(e.target,false)})};\n  if((f=$('f-sbin')))f.onsubmit=function(e){e.preventDefault();busy(e.target,true);\n    api('/api/config/signin',{email:$('sb-email').value,password:$('sb-pass').value}).then(function(c){S.cfg=c;toast('Signed in to Supabase.','ok');logline('supabase sign-in ok','ok');render()}).catch(function(x){toast(x.message,'err');logline('sign-in: '+x.message,'err')}).finally(function(){busy(e.target,false)})};",
  "  if((f=$('f-sb')))f.onsubmit=function(e){e.preventDefault();busy(e.target,true);\n    api('/api/config/supabase',{url:$('sb-url').value,publishable_key:$('sb-key').value,db_password:$('sb-dbpw').value,region:$('sb-region').value}).then(function(c){S.cfg=c;toast('Supabase project saved. DSN derived.','ok');logline('supabase project saved ref='+(c.supabase.project_ref||''),'ok');render()}).catch(function(x){toast(x.message,'err');logline('supabase: '+x.message,'err')}).finally(function(){busy(e.target,false)})};");

/* 5. Action: sign-out of Supabase Auth -> database test. */
must('dbtest action',
  "  if(a==='sbout')return api('/api/config/signout',{}).then(function(c){S.cfg=c;toast('Signed out of Supabase.','ok');render()}).catch(function(x){toast(x.message,'err')});",
  "  if(a==='dbtest'){if(btn){btn.disabled=true;btn.classList.add('busy')}logline('testing database connection …');\n    return api('/api/config/test-db',{}).then(function(c){S.cfg=c;var d=c.supabase;\n      if(d.db_ok){toast('Database reachable via '+d.db_mode+' ('+d.server_version+')','ok');logline('database OK mode='+d.db_mode+' server='+d.server_version,'ok')}\n      else{toast('Database test failed','err');logline('database FAILED: '+d.db_error,'err')}render()})\n      .catch(function(x){toast(x.message,'err');logline('database: '+x.message,'err')})\n      .finally(function(){if(btn){btn.disabled=false;btn.classList.remove('busy')}});}");

if (n === 0) console.log('\nnothing changed');
else { writeFileSync(F, s); console.log('\nPATCHED ' + n + ' site(s)'); }
