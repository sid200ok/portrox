/**
 * Build-pipeline stage: guarantee structural invariants on every rendered page.
 *
 * Evidence that drove each rule:
 *  - book.html and services.html shipped with ZERO h1 elements.
 *  - book.html carried a 19-char description; an invented 20-char minimum made
 *    us fabricate boilerplate. Minimum is 10 and a real og:description is used
 *    VERBATIM above it.
 *  - 404.html carried content="" on description AND on another meta tag. The
 *    previous version removed only name="description" while the gate flags any
 *    name/property tag with empty content. Handling is now GENERIC.
 *
 * Rules, idempotent:
 *  - indexable pages: exactly one h1 (promote first h2, else insert from title)
 *  - indexable pages: description-class meta filled to >= 10 chars of real text
 *  - 404 page: robots noindex,nofollow; ALL empty meta removed
 *  - any page: an empty meta tag is filled if it is description-class and the
 *    page is indexable, otherwise REMOVED. Empty metadata conveys nothing.
 * Pure ASCII.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

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
const DESC_KEYS = new Set(['description', 'og:description', 'twitter:description']);
const swap = (s, from, to) => s.split(from).join(to);

export function normalizeHtml(html, fileName) {
  let out = String(html);
  const changes = [];
  const is404 = /(^|\/)404\.html$/i.test(String(fileName || ''));
  const title = text((out.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || 'Portfolio');

  // Resolve one honest description for indexable pages.
  let desc = '';
  if (is404 === false) {
    const cur = text(attr(findMeta(out, 'name', 'description'), 'content'));
    const og = text(attr(findMeta(out, 'property', 'og:description'), 'content'));
    const siteName = text(attr(findMeta(out, 'property', 'og:site_name'), 'content'));
    desc = cur.length >= MIN_DESC ? cur : (og.length >= MIN_DESC ? og : '');
    if (!desc) desc = text(title + (siteName ? ' - ' + siteName : ''));
    if (desc.length < MIN_DESC) desc = text(title + ' - portfolio, services and booking.');
    desc = desc.slice(0, 300);
  }

  if (is404) {
    const robots = findMeta(out, 'name', 'robots');
    if (!robots) {
      out = out.replace(/<head([^>]*)>/i, m => m + '\n<meta name="robots" content="noindex,nofollow">');
      changes.push('robots noindex');
    } else if (/noindex/i.test(attr(robots, 'content')) === false) {
      out = swap(out, robots, '<meta name="robots" content="noindex,nofollow">');
      changes.push('robots noindex corrected');
    }
  }

  // Generic meta pass. Handles duplicates by replacing every identical instance.
  for (const t of metaTags(out)) {
    const key = (attr(t, 'name') || attr(t, 'property')).toLowerCase();
    if (!key) continue;
    const val = attr(t, 'content');
    const empty = String(val).trim() === '';

    if (is404 === false && DESC_KEYS.has(key)) {
      if (text(val).length < MIN_DESC) {
        const attrName = attr(t, 'name') ? 'name' : 'property';
        out = swap(out, t, '<meta ' + attrName + '="' + key + '" content="' + esc(desc) + '">');
        changes.push(key + ' filled (' + text(val).length + ' -> ' + desc.length + ' chars)');
      }
      continue;
    }
    if (empty === false) continue;
    out = swap(out, t, '');
    changes.push('removed empty ' + key);
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
