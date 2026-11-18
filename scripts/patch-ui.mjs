import { readFileSync, writeFileSync } from 'node:fs';
const F = 'packages/cli/studio-ui.mjs';
let s = readFileSync(F, 'utf8');
let n = 0;
function sub(label, from, to, required = true) {
  if (s.includes(from) === false) {
    if (s.includes(to)) { console.log('SKIP (already applied) ' + label); return; }
    if (required) { console.error('FAIL anchor not found: ' + label); process.exit(1); }
    return;
  }
  s = s.split(from).join(to); n++; console.log('OK   ' + label);
}

// A1 — banner and indicators keyed on the PASSWORD, not the username.
sub('banner gate -> weakPassword',
  "$('sec-warn').classList.toggle('hide',!AUTH.usingDefaults);",
  "$('sec-warn').classList.toggle('hide',!AUTH.weakPassword);");
sub('banner copy',
  '<b>Default credentials in use.</b> Anyone with access to this machine can sign in as admin. Rotate them now.',
  '<b>Default password in use.</b> The password is still the shipped default, so any local process can sign in. Change the password now.');
sub('settings pill -> weakPassword',
  "+(AUTH.usingDefaults?'<span class=\"pill err\"><span class=\"dot\"></span>Defaults</span>':'<span class=\"pill ok\"><span class=\"dot\"></span>Rotated</span>')+",
  "+(AUTH.weakPassword?'<span class=\"pill err\"><span class=\"dot\"></span>Default password</span>':'<span class=\"pill ok\"><span class=\"dot\"></span>Password rotated</span>')+");
sub('modal warning -> weakPassword',
  "+(AUTH.usingDefaults?'<div class=\"alert warn\">You are signed in with <b>admin / admin</b>. Any local process can do the same.</div>':'')+",
  "+(AUTH.weakPassword?'<div class=\"alert warn\">The password is still the shipped default. Any local process can sign in. Set a new password below.</div>':'')+");
sub('boot prompt gate',
  'if(!AUTH.rotated && !AUTH.promptDismissed) setTimeout(function(){credsModal(true)},450);',
  'if(AUTH.weakPassword && !AUTH.promptDismissed) setTimeout(function(){credsModal(true)},450);');

// A2 — credentials + recovery in ONE atomic call.
sub('atomic credentials+recovery',
  `        api('/api/auth/credentials',{currentPassword:$('cr-cur').value,username:$('cr-user').value,password:pw,dismissPrompt:$('cr-dismiss').checked})
          .then(function(){
            var ans=[];document.querySelectorAll('[data-rq]').forEach(function(i){if(i.value.trim())ans.push({id:i.getAttribute('data-rq'),value:i.value})});
            if(ans.length>=2)return api('/api/auth/recovery/setup',{currentPassword:pw||$('cr-cur').value,answers:ans,required:2}).catch(function(x){toast('Credentials saved, recovery failed: '+x.message,'err')});
          })
          .then(function(){toast('Credentials updated. Sign in again.','ok');setTimeout(function(){location.reload()},900)})`,
  `        var ans=[];document.querySelectorAll('[data-rq]').forEach(function(i){if(i.value.trim())ans.push({id:i.getAttribute('data-rq'),value:i.value})});
        api('/api/auth/credentials',{currentPassword:$('cr-cur').value,username:$('cr-user').value,password:pw,dismissPrompt:$('cr-dismiss').checked,recoveryAnswers:ans,recoveryRequired:2})
          .then(function(r){toast(r&&r.recoverySaved?'Credentials and recovery saved. Sign in again.':'Credentials updated. Sign in again.','ok');setTimeout(function(){location.reload()},900)})`);

// A5 — blank key keeps the stored key.
sub('allow blank key',
  `    var k=$('sb-key').value;
    if(!k&&S.cfg&&S.cfg.supabase.configured){toast('Enter the key to save, or leave the connection unchanged.','info');return}
    busy(e.target,true);`,
  `    var k=$('sb-key').value;
    busy(e.target,true);`);

// A6 — Node engine floor, not the app version.
sub('node version label',
  "'<dt>Runtime</dt><dd>Node '+h(VER.split('.')[0])+'+ · zero dependencies</dd>'",
  "'<dt>Runtime</dt><dd>Node 20+ · zero dependencies</dd>'");

// A7 — preserve newlines in the diagrams.
sub('architecture pre open',
  `'<div class="log" style="max-height:none">Studio (127.0.0.1, kernel port)`,
  `'<pre class="log" style="max-height:none;white-space:pre-wrap;margin:0">Studio (127.0.0.1, kernel port)`);
sub('architecture pre close', 'zero CDN</div></div>', 'zero CDN</pre></div>');
sub('cli pre open',
  `'<div class="log" style="max-height:none">portrox start | stop`,
  `'<pre class="log" style="max-height:none;white-space:pre-wrap;margin:0">portrox start | stop`);
sub('cli pre close', 'emergency local reset</div></div>', 'emergency local reset</pre></div>');

// A8 — dead code.
sub('remove metricSafe', 'function metricSafe(){}\n', '', false);
sub('remove no-op assign', 'S.cfg=c;AUTH=AUTH;toast(', 'S.cfg=c;toast(');

if (n === 0) console.log('\nnothing changed (already patched)');
else { writeFileSync(F, s); console.log('\nPATCHED ' + n + ' site(s)'); }
