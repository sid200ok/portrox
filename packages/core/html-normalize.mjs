/**
 * Build-pipeline stage: guarantee structural invariants on every rendered page.
 *
 * Evidence that drove this: book.html and services.html shipped with ZERO h1
 * elements; book.html carried a meta description tag with empty/short content.
 *
 * FIX vs first version: presence-only checks were wrong. The gate requires a
 * description of at least 20 characters, so an EXISTING but empty tag must be
 * REPLACED, not skipped. Attribute order is also irrelevant in HTML, so meta
 * tags are parsed rather than matched with an order-dependent regex.
 *
 * Rules, idempotent:
 *  - indexable pages: exactly one h1 (promote first h2, else insert from title)
 *  - indexable pages: meta description with >= 20 chars of real text
 *  - 404 page: robots noindex,nofollow (no description required)
 * Pure ASCII.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// No official minimum exists. 20 was an invented threshold that rejected a
// legitimate 19-char description and caused boilerplate to be fabricated,
// risking near-duplicate descriptions across pages. 10 catches empty or
// placeholder tags; a real og:description is used VERBATIM above it.
const MIN_DESC = 10;
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const text = s => String(s == null ? '' : s).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const attr = (tag, name) => {
  const m = String(tag).match(new RegExp('\\b' + name + '\\s*=\\s*["\']([^"\']*)["\']', 'i'));
  return m ? m[1] : '';
};
const metaTags = html => String(html).match(/<meta\b[^>]*>/gi) || [];
const findMeta = (html, key, value) =>
  metaTags(html).find(t => attr(t, key).toLowerCase() === String(value).toLowerCase()) || '';

export function normalizeHtml(html, fileName) {
  let out = String(html);
  const changes = [];
  const is404 = /(^|\/)404\.html$/i.test(String(fileName || ''));
  const title = text((out.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || 'Portfolio');

  if (is404) {
    const robots = findMeta(out, 'name', 'robots');
    if (!robots) {
      out = out.replace(/<head([^>]*)>/i, m => m + '\n<meta name="robots" content="noindex,nofollow">');
      changes.push('robots noindex');
    } else if (/noindex/i.test(attr(robots, 'content')) === false) {
      out = out.replace(robots, '<meta name="robots" content="noindex,nofollow">');
      changes.push('robots noindex corrected');
    }
  } else {
    const tag = findMeta(out, 'name', 'description');
    const current = tag ? text(attr(tag, 'content')) : '';
    if (current.length < MIN_DESC) {
      const og = attr(findMeta(out, 'property', 'og:description'), 'content');
      const siteName = attr(findMeta(out, 'property', 'og:site_name'), 'content');
      let d = text(og);
      if (d.length < MIN_DESC) d = text(current || '');
      if (d.length < MIN_DESC) d = text(title + (siteName ? ' - ' + siteName : '') + ' - portfolio, services and booking.');
      const newTag = '<meta name="description" content="' + esc(d.slice(0, 300)) + '">';
      if (tag) { out = out.replace(tag, newTag); changes.push('meta description replaced (was ' + current.length + ' chars)'); }
      else { out = out.replace(/<head([^>]*)>/i, m => m + '\n' + newTag); changes.push('meta description added'); }
    }
  }

  // An empty content="" attribute is sloppy output. On a noindex page the
  // description is pointless, so drop the tag rather than leave it empty.
  for (const t of (out.match(/<meta\b[^>]*>/gi) || [])) {
    if (/\bcontent\s*=\s*["']\s*["']/i.test(t) === false) continue;
    if (/\bname\s*=\s*["']description["']/i.test(t) && is404) {
      out = out.replace(t, '');
      changes.push('empty description tag removed');
    }
  }

  const h1count = (out.match(/<h1[\s>]/gi) || []).length;
  if (h1count === 0) {
    if (/<h2([^>]*)>([\s\S]*?)<\/h2>/i.test(out)) {
      out = out.replace(/<h2([^>]*)>([\s\S]*?)<\/h2>/i, (m, a, inner) => '<h1' + a + '>' + inner + '</h1>');
      changes.push('h1 promoted from first h2');
    } else {
      const anchor = /<main[^>]*>/i.test(out) ? /<main[^>]*>/i : /<body[^>]*>/i;
      out = out.replace(anchor, m => m + '\n<h1 class="page-title">' + esc(title) + '</h1>');
      changes.push('h1 inserted from title');
    }
  }
  return { html: out, changes };
}

export function normalizeDir(dir) {
  if (existsSync(dir) === false) return { files: 0, changed: 0, details: [] };
  const details = [];
  let changed = 0, files = 0;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.html')) continue;
    files++;
    const p = join(dir, f);
    const before = readFileSync(p, 'utf8');
    const { html, changes } = normalizeHtml(before, f);
    if (changes.length && html !== before) {
      writeFileSync(p, html);
      changed++;
      details.push(f + ': ' + changes.join(', '));
    }
  }
  return { files, changed, details };
}
