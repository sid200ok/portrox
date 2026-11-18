import { readFileSync, existsSync } from 'node:fs';
const ID = 'sid200ok.github.io';
const POSITIVE = process.argv.includes('--positive');

let url = '', key = '';
const deployed = 'dist/' + ID + '/assets/site-config.js';
if (existsSync(deployed)) {
  const m = readFileSync(deployed, 'utf8').match(/window\.PORTROX\s*=\s*(\{.*\});?/s);
  if (m) { try { const j = JSON.parse(m[1]); url = j.url || ''; key = j.key || ''; } catch {} }
}
if (!url || !key) {
  const cfg = JSON.parse(readFileSync('sites/' + ID + '/site.json', 'utf8'));
  url = (cfg.supabase && cfg.supabase.url) || '';
  key = (cfg.supabase && cfg.supabase.publishable_key) || '';
}

// Honest semantics: SKIP => exit 0. FAIL => exit 1. Never both.
if (!url || !key) {
  if (POSITIVE) {
    console.log('FAIL precondition: Supabase not configured in the Studio.');
    console.log('     ACTION: portrox status -> open URL -> Setup (Supabase + sign-in + GitHub PAT)');
    console.log('             then Register -> Publish -> portrox build --all -> re-run this.');
    process.exit(1);
  }
  console.log('SKIP Supabase not configured (no verdict). Use --positive to require it.');
  process.exit(0);
}

const H = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
const rpc = async (fn, body) => {
  const r = await fetch(url + '/rest/v1/rpc/' + fn, { method: 'POST', headers: H, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
};
let bad = 0;
const ok = m => console.log('OK   ' + m);
const fail = m => { bad++; console.log('FAIL ' + m); };

const pubRes = await fetch(url + '/rest/v1/sites?id=eq.' + encodeURIComponent(ID) + '&select=id,is_published', { headers: H });
let rows = []; try { rows = await pubRes.json(); } catch {}
const published = Array.isArray(rows) && rows.length > 0 && rows[0].is_published === true;
console.log('site published in DB: ' + published);

if (POSITIVE && published === false) {
  fail('--positive requested but the site is not published.');
  console.log('     ACTION: Studio -> Register -> Publish, then re-run.');
  console.log('RPC BAD=' + bad);
  process.exit(1);
}

const probe = await rpc('portrox_submit', { p_site: ID, p_kind: 'contact', p_full_name: 'Probe', p_email: 'probe@example.invalid', p_message: 'portrox verification probe' });
if (published) {
  (probe.j && probe.j.ok === true && probe.j.id) ? ok('published site ACCEPTS submission id=' + probe.j.id) : fail('published site refused: ' + JSON.stringify(probe));
} else {
  (probe.j && probe.j.error === 'unknown_site') ? ok('unpublished site refused (expected pre-publish)') : fail('unexpected: ' + JSON.stringify(probe));
}

const direct = await fetch(url + '/rest/v1/submissions', { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ site_id: ID, kind: 'contact', full_name: 'Bypass', email: 'bypass@example.invalid', message: 'direct insert attempt' }) });
(direct.status === 401 || direct.status === 403) ? ok('direct INSERT denied (' + direct.status + ')') : fail('direct INSERT allowed: ' + direct.status);

const sel = await fetch(url + '/rest/v1/submissions?select=id&limit=1', { headers: H });
(sel.status === 401 || sel.status === 403) ? ok('anon SELECT denied (' + sel.status + ')') : fail('anon SELECT allowed: ' + sel.status);

const sp = await fetch(url + '/rest/v1/system_pages?select=slug,is_locked', { headers: H });
sp.status === 200 ? ok('system_pages readable: ' + (await sp.text()).slice(0, 120)) : fail('system_pages read ' + sp.status);

const spw = await fetch(url + '/rest/v1/system_pages?slug=eq.about-website', { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ title: 'hacked' }) });
(spw.status === 401 || spw.status === 403 || spw.status === 404) ? ok('system_pages write denied (' + spw.status + ')') : fail('system_pages WRITABLE: ' + spw.status);

const past = await rpc('portrox_book', { p_site: ID, p_full_name: 'Probe', p_email: 'probe@example.invalid', p_message: 'past slot probe', p_starts_at: '2000-01-01T00:00:00Z', p_minutes: 30 });
(past.j && (past.j.error === 'past_slot' || past.j.error === 'unknown_site')) ? ok('past slot rejected (' + past.j.error + ')') : fail('past slot accepted: ' + JSON.stringify(past));

console.log(bad === 0 ? (published ? 'RPC OK (published)' : 'RPC OK (pre-publish)') : 'RPC BAD=' + bad);
process.exit(bad === 0 ? 0 : 1);
