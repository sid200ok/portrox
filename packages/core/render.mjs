/** Portrox renderer: sites/<id>/ -> dist/<id>/  (static, zero CDN, zero runtime deps) */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const CORE = dirname(fileURLToPath(import.meta.url));

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const j = (p, f) => { try { return JSON.parse(readFileSync(p,'utf8')); } catch { return f; } };
const txt = (p, f) => { try { return readFileSync(p,'utf8'); } catch { return f; } };

/** Minimal XSS-safe Markdown. Raw HTML is NEVER passed through. */
function md(src) {
  const inline = t => esc(t)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|#[^)\s]*|\/[^)\s]*)\)/g, '<a href="$2">$1</a>');
  const out = []; let list = null, code = false, buf = [];
  const flush = () => { if (list) { out.push('<' + list + '>' + buf.map(x => '<li>' + inline(x) + '</li>').join('') + '</' + list + '>'); list = null; buf = []; } };
  for (const raw of String(src).replace(/\r\n?/g,'\n').split('\n')) {
    const l = raw.trimEnd();
    if (/^```/.test(l)) { if (code) { out.push('<pre><code>' + esc(buf.join('\n')) + '</code></pre>'); buf = []; code = false; } else { flush(); code = true; } continue; }
    if (code) { buf.push(raw); continue; }
    if (l.trim() === '') { flush(); continue; }
    let m;
    if ((m = l.match(/^(#{1,4})\s+(.*)$/))) { flush(); const n = m[1].length; out.push('<h' + n + '>' + inline(m[2]) + '</h' + n + '>'); continue; }
    if ((m = l.match(/^[-*+]\s+(.*)$/))) { if (list !== 'ul') { flush(); list = 'ul'; } buf.push(m[1]); continue; }
    if ((m = l.match(/^\d+[.)]\s+(.*)$/))) { if (list !== 'ol') { flush(); list = 'ol'; } buf.push(m[1]); continue; }
    if ((m = l.match(/^>\s?(.*)$/))) { flush(); out.push('<blockquote>' + inline(m[1]) + '</blockquote>'); continue; }
    if (/^(-{3,}|\*{3,})$/.test(l)) { flush(); out.push('<hr>'); continue; }
    flush(); out.push('<p>' + inline(l) + '</p>');
  }
  if (code) out.push('<pre><code>' + esc(buf.join('\n')) + '</code></pre>');
  flush();
  return out.join('\n');
}

const ICON = {
  mail:'<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
  ext:'<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/>',
  lock:'<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  cal:'<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
};
const svg = (n, sz) => '<svg width="' + (sz||18) + '" height="' + (sz||18) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICON[n]||'') + '</svg>';

function copyDir(src, dst) {
  if (existsSync(src) === false) return 0;
  let n = 0; mkdirSync(dst, { recursive:true });
  for (const e of readdirSync(src)) {
    const s = join(src,e), d = join(dst,e);
    if (statSync(s).isDirectory()) n += copyDir(s,d); else { copyFileSync(s,d); n++; }
  }
  return n;
}

export async function renderSite(siteDir, outDir) {
  let done_guard = false;
  const cfg = j(join(siteDir,'site.json'), {});
  const rawBase = String((cfg.pages && cfg.pages.base_path) || '').replace(/\/$/,'');
  const B = rawBase === '' ? './' : rawBase + '/';   // project mode MUST prefix assets
  const profile = j(join(siteDir,'data/profile.json'), {});
  const exp = j(join(siteDir,'data/experience.json'), []);
  const proj = j(join(siteDir,'data/projects.json'), []);
  const svc = j(join(siteDir,'data/services.json'), []);
  const avail = j(join(siteDir,'data/availability.json'), { timezone:'UTC', duration_minutes:30, weekly:[] });
  const name = profile.full_name || cfg.owner || cfg.id;
  const year = new Date().getFullYear();
  const nav = cfg.nav || {};
  // Page descriptions are DERIVED from the owner's own data, never invented.
  // 'Book an appointment' (19 chars) is not a search snippet, and R8 forbids the
  // normalizer fabricating one. These live in renderSite scope, beside svc and
  // avail which the page body already renders, so the snippet cannot disagree
  // with the page. They MUST be declared before layout() and before first use.
  const clipDesc = (t) => t.length <= 160 ? t : t.slice(0, 157).replace(/\s+\S*$/, '').trim() + '...';
  const servicesDesc = () => {
    const titles = (Array.isArray(svc) ? svc : []).map(x => String((x && x.title) || '').trim()).filter(Boolean);
    if (titles.length === 0) return 'Engineering services and how to start a conversation. Book a short call to discuss scope.';
    return clipDesc('Engineering services: ' + titles.join(', ') + '. Book a short call to discuss scope.');
  };
  const bookDesc = () => {
    const w = (avail && Array.isArray(avail.weekly)) ? avail.weekly : [];
    if (w.length === 0) return 'Book a call. Available times are listed on this page once the owner sets them.';
    const parts = w.map(r => String(r.day) + ' ' + String(r.from) + '-' + String(r.to)).join(', ');
    return clipDesc('Book a ' + (avail.duration_minutes || 30) + '-minute call. ' + parts + ' (' + (avail.timezone || 'UTC') + ').');
  };

  const layout = (o) => {
    const link = (href, label, key, cta) => '<a href="' + B + href + '"' + (o.active === key ? ' aria-current="page"' : '') + (cta ? ' class="cta"' : '') + '>' + label + '</a>';
    const tabs = [link('index.html','Home','home')];
    if (nav.services !== false) tabs.push(link('services.html','Services','services'));
    if (nav.appointments !== false) tabs.push(link('book.html','Book Appointments','book'));
    if (nav.about !== false) tabs.push(link('about.html','About Me','about'));
    if (nav.client_auth === true) tabs.push(link('login.html','Login / Register','login'));
    tabs.push(link('about-website.html','About Website','about-website', true));
    return '<!doctype html>\n<html lang="en"><head>\n<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">\n'
      + '<title>' + esc(o.title) + '</title><meta name="description" content="' + esc(o.desc) + '">\n'
      + '<meta property="og:type" content="website"><meta property="og:title" content="' + esc(o.title) + '">\n'
      + '<meta property="og:description" content="' + esc(o.desc) + '">\n'
      + (cfg.seo && cfg.seo.og_image ? '<meta property="og:image" content="' + esc(cfg.seo.og_image) + '">\n' : '')
      + '<meta name="twitter:card" content="' + (cfg.seo && cfg.seo.og_image ? 'summary_large_image' : 'summary') + '"><meta name="generator" content="Portrox">\n'
      + '<link rel="stylesheet" href="' + B + 'assets/portrox.css">\n'
      + '<style id="portrox-theme">:root{--bg:' + esc((cfg.theme&&cfg.theme.bg)||'#020617')
      + ';--panel:' + esc((cfg.theme&&cfg.theme.panel)||'#0f172a')
      + ';--acc:' + esc((cfg.theme&&cfg.theme.accent)||'#22d3ee') + '}</style>\n</head><body>\n'
      + '<a class="skip" href="#main">Skip to content</a>\n'
      + '<nav class="nav"><div class="wrap nav-in"><a class="brand" href="' + B + 'index.html">' + esc(String(name).slice(0,2).toUpperCase()) + '<span>.</span></a>'
      + '<div class="nav-links">' + tabs.join('') + '</div></div></nav>\n'
      + '<main id="main">' + o.body + '</main>\n'
      + '<footer><div class="wrap foot"><p>&copy; ' + year + ' ' + esc(name) + '. Built with <a href="' + B + 'about-website.html">Portrox</a>.</p>'
      + '<p>' + esc((cfg.pages && cfg.pages.mode) === 'project' ? 'Project site' : 'User site') + ' · static · HTTPS</p></div></footer>\n</body></html>';
  };

  rmSync(outDir, { recursive:true, force:true });
  mkdirSync(join(outDir,'assets'), { recursive:true });
  copyFileSync(join(CORE,'portrox.css'), join(outDir,'assets/portrox.css'));
  const media = copyDir(join(siteDir,'assets'), join(outDir,'assets/media'));

  // Public payment options. Lazy optional import so core still renders when the
  // CLI store is absent; failure degrades to an empty panel, never a broken page.
  // Only PUBLIC fields reach the bundle - checkout.publicOptions guarantees it.
  let pay = [];
  try { const CO = await import('../cli/checkout.mjs'); pay = CO.publicOptions(); } catch {}
  const payPanel = pay.length
    ? '<div class="card" style="margin-top:18px"><h3>Payment</h3>'
      + pay.map(o => {
          if (o.kind === 'manual') return '<p><b>' + esc(o.label) + '</b><br>' + esc(o.payee_name)
            + (o.upi_id ? ' &middot; UPI <code>' + esc(o.upi_id) + '</code>' : '')
            + '<br>' + esc(o.instructions) + '</p>';
          if (o.kind === 'hosted_link') return '<p><a class="btn btn-p" href="' + esc(o.checkout_url)
            + '" rel="noopener noreferrer" target="_blank">Pay with ' + esc(o.label) + '</a></p>';
          return '<p class="note">' + esc(o.label) + ' &mdash; arranged directly after your request.</p>';
        }).join('')
      + '<p class="note">After paying, send the reference through the contact form. The owner confirms every booking; payment is never marked automatically.</p></div>'
    : '';
  const pages = {};

  pages['index.html'] = layout({ title: (cfg.seo && cfg.seo.title) || name, desc: (cfg.seo && cfg.seo.description) || '', active:'home',
    body: '<section class="hero"><div class="wrap">'
      + (cfg.flags && cfg.flags.available_for_hire ? '<span class="pill"><i></i>Available for hire</span>' : '')
      + '<div class="prose" style="margin:0 auto;text-align:left">' + md(txt(join(siteDir,'content/intro.md'), '# ' + name)) + '</div>'
      + '<div class="row" style="margin-top:26px"><a class="btn btn-p" href="' + B + 'book.html">' + svg('cal') + ' Book a call</a>'
      + '<a class="btn btn-g" href="' + B + 'about.html">About me</a></div></div></section>'
      + (proj.length ? '<section class="alt"><div class="wrap"><h2>Selected work</h2><div class="grid g3">'
        + proj.slice(0,6).map(p => '<article class="card"><h3>' + esc(p.title) + '</h3><p>' + esc(p.summary) + '</p>'
          + '<div class="tags">' + (p.stack||[]).map(t => '<span class="tag">' + esc(t) + '</span>').join('') + '</div>'
          + (p.url ? '<p style="margin:14px 0 0"><a href="' + esc(p.url) + '" rel="noopener noreferrer" target="_blank">' + svg('ext',15) + ' View</a></p>' : '')
          + '</article>').join('') + '</div></div></section>' : '')
      + '<section id="contact"><div class="wrap" style="max-width:720px"><h2>Get in touch</h2><div class="card">'
      + '<form id="contact-form" novalidate>'
      + '<label class="field"><span>Name</span><input name="full_name" required maxlength="120" autocomplete="name"></label>'
      + '<label class="field"><span>Email</span><input name="email" type="email" required maxlength="254" autocomplete="email"></label>'
      + '<label class="field"><span>Message</span><textarea name="message" required maxlength="5000" rows="5"></textarea></label>'
      + '<input class="hp" name="honeypot" tabindex="-1" autocomplete="off" aria-hidden="true">'
      + '<button class="btn btn-p" type="submit" style="width:100%">' + svg('mail') + ' Send message</button>'
      + '<p class="status" data-status role="status" aria-live="polite"></p></form></div></div></section>' });

  const avatar = profile.avatar ? B + 'assets/media/' + profile.avatar : '';
  pages['about.html'] = layout({ title:'About — ' + name, desc: profile.headline || '', active:'about',
    body:'<section><div class="wrap"><div class="profile">'
      + (avatar ? '<img class="avatar" src="' + esc(avatar) + '" alt="' + esc(name) + '" width="132" height="132">' : '<div class="avatar"></div>')
      + '<div><h1 style="font-size:2rem;margin:0 0 6px">' + esc(name) + '</h1>'
      + '<p class="lede" style="margin:0 0 10px;text-align:left">' + esc(profile.headline) + '</p>'
      + '<p class="org">' + esc(profile.location) + (profile.hourly_rate ? ' · <span class="rate">' + esc(profile.hourly_rate) + '</span>' : '') + '</p>'
      + (cfg.flags && cfg.flags.available_for_hire ? '<span class="avail">Available for hire</span>' : '')
      + '<div class="tags" style="margin-top:14px">' + (profile.skills||[]).map(s => '<span class="tag">' + esc(s) + '</span>').join('') + '</div>'
      + '<!--PORTROX_LINKS--><div class="row" style="justify-content:flex-start;margin-top:16px">'
      + Object.entries(profile.links||{}).filter(([,v]) => typeof v === 'string' && v.length > 0).map(([k,v]) => {
          const href = k === 'email' ? 'mailto:' + v : v;
          if (/^(https?:\/\/|mailto:)/i.test(href) === false) return '';
          return '<a class="btn btn-g" href="' + esc(href) + '" rel="noopener noreferrer"' + (k === 'email' ? '' : ' target="_blank"') + '>' + esc(k) + '</a>';
        }).join('') + '</div></div></div>'
      + '<div class="prose" style="margin-top:34px">' + md(txt(join(siteDir,'content/about.md'),'')) + '</div>'
      + (exp.length ? '<h2 style="margin-top:44px">Work history</h2><div class="tl">' + exp.map(e =>
        '<article><div class="meta"><h3>' + esc(e.role) + '</h3><span class="when">' + esc(e.period) + '</span></div>'
        + '<p class="org">' + esc(e.org) + (e.location ? ' · ' + esc(e.location) : '') + '</p>'
        + '<p style="color:var(--dim);font-size:14px;margin:0">' + esc(e.summary) + '</p>'
        + ((e.stack||[]).length ? '<div class="tags" style="margin-top:9px">' + e.stack.map(t => '<span class="tag">' + esc(t) + '</span>').join('') + '</div>' : '')
        + '</article>').join('') + '</div>' : '')
      + (proj.length ? '<h2 style="margin-top:44px">Portfolio</h2><div class="grid g3">' + proj.map(p =>
        '<article class="card"><h3>' + esc(p.title) + '</h3><p>' + esc(p.summary) + '</p>'
        + '<div class="tags">' + (p.stack||[]).map(t => '<span class="tag">' + esc(t) + '</span>').join('') + '</div>'
        + (p.url ? '<p style="margin:14px 0 0"><a href="' + esc(p.url) + '" rel="noopener noreferrer" target="_blank">' + svg('ext',15) + ' Open</a></p>' : '')
        + '</article>').join('') + '</div>' : '')
      + '</div></section>' });

  pages['services.html'] = layout({ title:'Services — ' + name, desc: servicesDesc(), active:'services',
    body:'<section><div class="wrap"><h2>Services</h2>'
      + (svc.length ? '<div class="grid g3">' + svc.map(s => '<article class="card"><h3>' + esc(s.title) + '</h3><p>' + esc(s.description) + '</p>'
        + (s.price ? '<p class="rate" style="margin:0 0 12px">' + esc(s.price) + '</p>' : '')
        + ((s.deliverables||[]).length ? '<ul style="color:var(--dim);font-size:14px;padding-left:20px;margin:0 0 14px">' + s.deliverables.map(d => '<li>' + esc(d) + '</li>').join('') + '</ul>' : '')
        + (s.payment_url ? '<a class="btn btn-p" href="' + esc(s.payment_url) + '" rel="noopener noreferrer" target="_blank">Buy / Enquire</a>' : '<a class="btn btn-g" href="' + B + 'book.html">Discuss</a>')
        + '</article>').join('') + '</div>' : '<p class="note">No services listed yet.</p>')
      + '<p class="note" style="margin-top:22px">Checkout uses public payment links. Secret keys, webhook verification and payment confirmation run server-side, never in this static site.</p></div></section>' });

  const weekly = avail.weekly || [];
  pages['book.html'] = layout({ title:'Book — ' + name, desc: bookDesc(), active:'book',
    body:'<section><div class="wrap" style="max-width:760px"><h2>Book an appointment</h2><div class="card">'
      + '<p class="org">' + esc(avail.duration_minutes || 30) + ' minutes · ' + esc(avail.timezone || 'UTC') + ' · ' + (cfg.flags && cfg.flags.paid_booking ? 'Paid booking' : 'Free booking') + '</p>'
      + (weekly.length ? '<h3>Weekly availability</h3><div class="slots" style="margin-bottom:18px">' + weekly.map(w => '<span class="slot">' + esc(w.day) + ' ' + esc(w.from) + '–' + esc(w.to) + '</span>').join('') + '</div>' : '<p class="note">Availability not configured yet.</p>')
      + '<form id="book-form" novalidate>'
      + '<label class="field"><span>Name</span><input name="full_name" required maxlength="120"></label>'
      + '<label class="field"><span>Email</span><input name="email" type="email" required maxlength="254"></label>'
      + '<label class="field"><span>Preferred slot (your local time)</span><input name="starts_at" type="datetime-local" required></label>'
      + '<label class="field"><span>Agenda</span><textarea name="message" rows="4" maxlength="2000"></textarea></label>'
      + '<input class="hp" name="honeypot" tabindex="-1" autocomplete="off" aria-hidden="true">'
      + '<button class="btn btn-p" type="submit" style="width:100%">' + svg('cal') + ' Request booking</button>'
      + '<p class="status" data-status role="status" aria-live="polite"></p></form></div>'
      + '<div class="card" id="pay-ref" hidden style="margin-top:18px"><h3>Send your payment reference</h3>'
      + '<p class="note">Already paid? Paste the transaction reference. The owner verifies it and confirms your booking.</p>'
      + '<label class="field"><span>Reference</span><input id="pay-ref-val" maxlength="120" autocomplete="off"></label>'
      + '<button class="btn btn-p" type="button" id="pay-ref-send">Send reference</button>'
      + '<p class="status" data-ref-status role="status" aria-live="polite"></p></div>'
      + '<p class="note" style="margin-top:18px">Slots are locked server-side. The owner confirms every booking; payment is never marked automatically.</p>'
      + payPanel + '</div></section>' });

  if (nav.client_auth === true) {
    pages['login.html'] = layout({ title:'Client login — ' + name, desc:'Client portal', active:'login',
      body:'<section><div class="wrap" style="max-width:460px"><h2>Client portal</h2><div class="card"><p class="note">Client authentication is enabled for this site. Supabase Auth wiring lands in Phase 3, scoped to <code>site_id</code>.</p></div></div></section>' });
  }

  pages['about-website.html'] = layout({ title:'About this website — Portrox', desc:'Portrox: self-hostable portfolio engine by Siddhant Kumar.', active:'about-website',
    body:'<section><div class="wrap"><span class="lock">' + svg('lock',13) + ' System page · not editable</span>'
      + '<div class="prose" style="margin-top:20px">' + md(txt(join(CORE,'system-pages/about-website.md'), '# Portrox')) + '</div></div></section>' });

  if (cfg.supabase && cfg.supabase.url && cfg.supabase.publishable_key) {
    if (/^https:\/\/[a-z0-9.-]+\.supabase\.(co|in)$/i.test(cfg.supabase.url) === false) throw new Error('bad supabase.url');
    if (/^sb_(secret|service)_/.test(cfg.supabase.publishable_key)) throw new Error('REFUSING secret key in public site');
    writeFileSync(join(outDir,'assets/site-config.js'), 'window.PORTROX=' + JSON.stringify({ url:cfg.supabase.url, key:cfg.supabase.publishable_key, site:cfg.id, pay:pay, minutes:(avail.duration_minutes || 30) }) + ';\n');
    writeFileSync(join(outDir,'assets/forms.js'), readFileSync(join(CORE,'forms.js'),'utf8'));
    for (const k of Object.keys(pages)) {
      pages[k] = pages[k].replace('</body>', '<script src="' + B + 'assets/site-config.js"></script><script src="' + B + 'assets/forms.js"></script></body>');
    }
  }

  // PORTROX_FORMGUARD: an unconfigured form must not native-GET-submit.
  if (!(cfg.supabase && cfg.supabase.url && cfg.supabase.publishable_key)) {
    for (const k of Object.keys(pages)) {
      pages[k] = pages[k].replace('</body>',
        '<script>document.querySelectorAll("#contact-form,#book-form").forEach(function(f){'
        + 'f.addEventListener("submit",function(e){e.preventDefault();'
        + 'var s=f.querySelector("[data-status]");if(s){s.textContent="Form not configured yet.";s.className="status err";}});'
        + 'var b=f.querySelector("button[type=submit]");if(b){b.disabled=true;b.title="Not configured";}});<\/script></body>');
    }
    done_guard = true;
  }
  let bytes = 0;
  for (const [n, html] of Object.entries(pages)) { writeFileSync(join(outDir,n), html); bytes += Buffer.byteLength(html); }
  writeFileSync(join(outDir,'.nojekyll'), '');
  writeFileSync(join(outDir,'robots.txt'), 'User-agent: *\nAllow: /\n');
  writeFileSync(join(outDir,'404.html'), layout({ title:'Not found', desc:'', active:'', body:'<section><div class="wrap"><h1>404</h1><p class="lede">That page does not exist.</p><p><a class="btn btn-p" href="' + B + 'index.html">Go home</a></p></div></section>' }));
  const origin = String(cfg.live_url || '').replace(/\/$/,'');
  const urls = Object.keys(pages).concat(['404.html']).filter(n => n !== '404.html')
    .map(n => '  <url><loc>' + esc(origin + '/' + (n === 'index.html' ? '' : n)) + '</loc></url>').join('\n');
  writeFileSync(join(outDir,'sitemap.xml'),
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls + '\n</urlset>\n');
  writeFileSync(join(outDir,'robots.txt'), 'User-agent: *\nAllow: /\nSitemap: ' + origin + '/sitemap.xml\n');
  if (cfg.pages && cfg.pages.mode === 'custom' && cfg.pages.cname) writeFileSync(join(outDir,'CNAME'), cfg.pages.cname + '\n');
  return { pages: Object.keys(pages).length, bytes, media, base: B };
}
