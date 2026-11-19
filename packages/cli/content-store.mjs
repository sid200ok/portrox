/**
 * Phase 2 module 1: editable site content, behind an allowlist.
 *
 * NOT a general file API:
 *  - only the files in EDITABLE may be touched
 *  - no traversal, no absolute paths, no symlinks
 *  - JSON must parse AND satisfy a shape check
 *  - writes are atomic (tmp + rename); previous bytes are archived, CAPPED
 *
 * site.json CONTRACT (corrected): the rule is "protected fields must not
 * CHANGE", not "protected fields must not be PRESENT". A load-edit-save editor
 * naturally sends the whole document; blanket-rejecting unknown keys made
 * site.json impossible to round-trip and broke the restore path. Protected
 * fields are now COMPARED to the current value: identical is accepted as a
 * no-op, different is refused. id, database, published, repo stay immutable.
 * Pure ASCII.
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, lstatSync, statSync, readdirSync, unlinkSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';

export const EDITABLE = {
  'content/intro.md': { kind: 'markdown' },
  'content/about.md': { kind: 'markdown' },
  'data/profile.json': { kind: 'json', shape: 'profile' },
  'data/experience.json': { kind: 'json', shape: 'list' },
  'data/projects.json': { kind: 'json', shape: 'list' },
  'data/services.json': { kind: 'json', shape: 'list' },
  'data/availability.json': { kind: 'json', shape: 'availability' },
  'site.json': { kind: 'json', shape: 'siteSettings' }
};
const SITE_MUTABLE = ['seo', 'nav', 'theme', 'flags'];
const HISTORY_KEEP = 20;

export class ContentError extends Error {
  constructor(message, code) { super(message); this.code = code || 400; }
}

function siteRoot(repo, siteId) {
  if (/^[A-Za-z0-9._-]+$/.test(String(siteId || '')) === false) throw new ContentError('invalid site id');
  const base = resolve(join(repo, 'sites'));
  const root = resolve(join(base, siteId));
  if (relative(base, root).startsWith('..')) throw new ContentError('site escapes sites/');
  if (existsSync(root) === false) throw new ContentError('unknown site: ' + siteId, 404);
  if (lstatSync(root).isSymbolicLink()) throw new ContentError('site root is a symlink');
  return root;
}

function target(root, file) {
  const spec = EDITABLE[file];
  if (!spec) throw new ContentError('not an editable file: ' + file, 403);
  const p = resolve(join(root, file));
  const rel = relative(root, p);
  if (rel.startsWith('..') || rel.startsWith(sep)) throw new ContentError('path escapes the site');
  if (existsSync(p) && lstatSync(p).isSymbolicLink()) throw new ContentError('refusing to write through a symlink');
  return { p, spec };
}

/**
 * A2: JSON object key order carries no meaning. Raw stringify comparison
 * refused a protected field that had not actually changed, simply because the
 * editor rebuilt the object in a different key order. Canonicalise: sort object
 * keys recursively; arrays keep their order because order IS meaningful there.
 */
function canon(v) {
  if (v === undefined) return 'undefined';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
}
const same = (a, b) => canon(a) === canon(b);

function validate(spec, text, root) {
  if (spec.kind === 'markdown') {
    const words = String(text).trim().split(/\s+/).filter(Boolean).length;
    if (words < 3) throw new ContentError('markdown too short (need at least 3 words)');
    if (/<script/i.test(text)) throw new ContentError('raw <script> is not allowed in content');
    return;
  }
  let j;
  try { j = JSON.parse(text); } catch (e) { throw new ContentError('invalid JSON: ' + e.message); }
  if (spec.shape === 'list') {
    if (Array.isArray(j) === false) throw new ContentError('expected a JSON array');
    j.forEach((x, i) => { if (x === null || typeof x !== 'object' || Array.isArray(x)) throw new ContentError('entry ' + i + ' must be an object'); });
    return;
  }
  if (spec.shape === 'profile') {
    if (j === null || typeof j !== 'object' || Array.isArray(j)) throw new ContentError('profile must be an object');
    if (typeof j.full_name !== 'string' || j.full_name.trim() === '') throw new ContentError('profile.full_name is required');
    if (j.links && typeof j.links !== 'object') throw new ContentError('profile.links must be an object');
    if (j.skills && Array.isArray(j.skills) === false) throw new ContentError('profile.skills must be an array');
    return;
  }
  if (spec.shape === 'availability') {
    if (j === null || typeof j !== 'object' || Array.isArray(j)) throw new ContentError('availability must be an object');
    if (typeof j.timezone !== 'string' || !j.timezone) throw new ContentError('availability.timezone is required');
    if (Array.isArray(j.weekly) === false) throw new ContentError('availability.weekly must be an array');
    if (j.duration_minutes !== undefined && (!Number.isInteger(j.duration_minutes) || j.duration_minutes < 5 || j.duration_minutes > 240)) {
      throw new ContentError('availability.duration_minutes must be an integer 5..240');
    }
    return;
  }
  if (spec.shape === 'siteSettings') {
    const cur = JSON.parse(readFileSync(join(root, 'site.json'), 'utf8'));
    if (j === null || typeof j !== 'object' || Array.isArray(j)) throw new ContentError('settings must be an object');
    // Protected top-level fields: present is fine, CHANGED is not.
    for (const k of Object.keys(j)) {
      if (SITE_MUTABLE.includes(k) || k === 'pages') continue;
      if (same(j[k], cur[k]) === false) {
        throw new ContentError('site.json field not editable here: ' + k, 403);
      }
    }
    const merged = { ...cur };
    for (const k of SITE_MUTABLE) if (j[k] !== undefined) merged[k] = j[k];
    if (j.pages !== undefined) {
      if (j.pages === null || typeof j.pages !== 'object' || Array.isArray(j.pages)) throw new ContentError('pages must be an object');
      for (const k of Object.keys(j.pages)) {
        if (k === 'cname') continue;
        if (same(j.pages[k], (cur.pages || {})[k]) === false) {
          throw new ContentError('only pages.cname is editable; changed: pages.' + k, 403);
        }
      }
      merged.pages = { ...(cur.pages || {}), ...(j.pages.cname !== undefined ? { cname: String(j.pages.cname) } : {}) };
    }
    return JSON.stringify(merged, null, 2) + '\n';
  }
  throw new ContentError('unknown shape: ' + spec.shape);
}

function archive(root, file, p) {
  const hist = join(root, '.content-history');
  mkdirSync(hist, { recursive: true, mode: 0o700 });
  const prefix = file.replace(/\//g, '__') + '.';
  if (existsSync(p)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    writeFileSync(join(hist, prefix + stamp), readFileSync(p), { mode: 0o600 });
  }
  // Cap growth: the gate alone writes ~32 archives per release.
  const mine = readdirSync(hist).filter(f => f.startsWith(prefix)).sort();
  for (const f of mine.slice(0, Math.max(0, mine.length - HISTORY_KEEP))) {
    try { unlinkSync(join(hist, f)); } catch {}
  }
  return mine.length;
}

export function listContent(repo, siteId) {
  const root = siteRoot(repo, siteId);
  return Object.entries(EDITABLE).map(([file, spec]) => ({
    file, kind: spec.kind, exists: existsSync(join(root, file)),
    bytes: existsSync(join(root, file)) ? statSync(join(root, file)).size : 0
  }));
}

export function readContent(repo, siteId, file) {
  const root = siteRoot(repo, siteId);
  const { p, spec } = target(root, file);
  if (existsSync(p) === false) throw new ContentError('no such content file: ' + file, 404);
  const text = readFileSync(p, 'utf8');
  return { file, kind: spec.kind, text, bytes: Buffer.byteLength(text) };
}

export function writeContent(repo, siteId, file, text) {
  const root = siteRoot(repo, siteId);
  const { p, spec } = target(root, file);
  if (typeof text !== 'string') throw new ContentError('text must be a string');
  if (text.length > 512 * 1024) throw new ContentError('content too large (max 512 KiB)', 413);
  const merged = validate(spec, text, root);
  const out = typeof merged === 'string' ? merged : text;
  archive(root, file, p);
  const tmp = p + '.tmp';
  writeFileSync(tmp, out);
  renameSync(tmp, p);
  return { file, bytes: Buffer.byteLength(out), history: true, keep: HISTORY_KEEP };
}
