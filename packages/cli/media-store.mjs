/**
 * Media uploads as BUILD ASSETS, not runtime storage.
 *
 * Supabase Storage writes need a service-role key, which Portrox refuses to
 * store. render.mjs already copies sites/<id>/assets/ -> dist/assets/media/,
 * and profile.avatar reads from that path. So an upload is a file write plus a
 * metadata row, and publishing ships it. No secret key, no CDN, no runtime dep.
 *
 * Defences: extension allowlist (SVG refused - it can carry script), MAGIC-BYTE
 * sniff so a renamed .html cannot pose as .png, filename slug, size cap,
 * traversal refusal, typed confirmation on delete.
 */
import { readFileSync, writeFileSync, unlinkSync, existsSync, readdirSync, statSync, mkdirSync, lstatSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { loadConfig, accessToken } from './config-store.mjs';
import * as M from './supabase-mgmt.mjs';

export const MAX_BYTES = 700 * 1024;
export const EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'];
export class MediaError extends Error { constructor(m, c) { super(m); this.code = c || 400; } }

const SITE = /^[A-Za-z0-9._-]+$/;
const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const lit = v => "'" + String(v == null ? '' : v).replace(/'/g, "''") + "'";
const rows = r => Array.isArray(r) ? r : [];

function siteDir(repo, siteId) {
  if (!SITE.test(String(siteId || ''))) throw new MediaError('invalid site id');
  const base = resolve(join(repo, 'sites'));
  const root = resolve(join(base, String(siteId)));
  if (relative(base, root).startsWith('..')) throw new MediaError('site escapes sites/');
  if (existsSync(root) === false) throw new MediaError('unknown site: ' + siteId, 404);
  const dir = join(root, 'assets');
  mkdirSync(dir, { recursive: true });
  if (lstatSync(dir).isSymbolicLink()) throw new MediaError('assets is a symlink');
  return { root, dir };
}
function safeName(n) {
  const s = String(n || '').toLowerCase();
  if (!NAME.test(s)) throw new MediaError('invalid filename (lowercase letters, digits, dot, dash, underscore; max 64)');
  const ext = s.split('.').pop();
  if (EXT.includes(ext) === false) throw new MediaError('extension not allowed: ' + ext + ' (SVG is refused: it can carry script)');
  return { name: s, ext };
}
function sniff(buf, ext) {
  const h = buf.subarray(0, 16);
  const hex = h.toString('hex');
  const asc = h.toString('latin1');
  if (ext === 'png') return hex.startsWith('89504e470d0a1a0a');
  if (ext === 'jpg' || ext === 'jpeg') return hex.startsWith('ffd8ff');
  if (ext === 'gif') return asc.startsWith('GIF8');
  if (ext === 'webp') return asc.slice(0, 4) === 'RIFF' && asc.slice(8, 12) === 'WEBP';
  if (ext === 'avif') return asc.slice(4, 8) === 'ftyp' && /avif|avis/.test(asc.slice(8, 16));
  return false;
}
function proj() {
  const r = loadConfig().supabase.default_project_ref;
  if (!r || !accessToken()) throw new MediaError('no bound project or account token');
  return r;
}
const run = (sql, ro) => M.runQuery(accessToken(), proj(), sql, ro ? { read_only: true } : undefined);

/**
 * The allowed `kind` values come from the DATABASE CHECK constraint, not from a
 * list I invented. Guessing 'image' violated media_kind_check. Reading the
 * constraint means this can never drift from the schema again.
 */
let _kinds = null;
export async function allowedKinds() {
  if (_kinds) return _kinds;
  const r = rows(await run("select pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.media'::regclass and contype = 'c' and conname like '%kind%'", true));
  const defs = r.map(x => String(x.def || '')).join(' ');
  const found = [...defs.matchAll(/'([^']+)'::text|'([^']+)'/g)].map(m => m[1] || m[2]).filter(Boolean);
  _kinds = [...new Set(found)];
  if (_kinds.length === 0) throw new MediaError('could not read media_kind_check - refusing to guess allowed kinds');
  return _kinds;
}

export function listMedia(repo, siteId) {
  const { dir } = siteDir(repo, siteId);
  return readdirSync(dir).filter(f => NAME.test(f) && EXT.includes(f.split('.').pop()))
    .map(f => ({ name: f, bytes: statSync(join(dir, f)).size, path: 'assets/media/' + f }));
}

export async function uploadMedia(repo, siteId, fileName, dataB64, { alt = '', kind } = {}) {
  const { dir } = siteDir(repo, siteId);
  const { name, ext } = safeName(fileName);
  const kinds = await allowedKinds();
  const useKind = kind || kinds[0];
  if (kinds.includes(useKind) === false) throw new MediaError('invalid kind: ' + useKind + ' (allowed: ' + kinds.join(', ') + ')');
  let buf;
  try { buf = Buffer.from(String(dataB64 || ''), 'base64'); } catch { throw new MediaError('data is not base64'); }
  if (buf.length === 0) throw new MediaError('empty payload');
  if (buf.length > MAX_BYTES) throw new MediaError('too large: ' + buf.length + ' > ' + MAX_BYTES + ' bytes', 413);
  if (sniff(buf, ext) === false) throw new MediaError('content does not match .' + ext + ' magic bytes - refusing a renamed file');
  const p = join(dir, name);
  if (existsSync(p) && lstatSync(p).isSymbolicLink()) throw new MediaError('refusing to write through a symlink');
  writeFileSync(p, buf);
  const sp = 'assets/media/' + name;
  await run("insert into public.media (site_id, kind, storage_path, is_active, alt) values ("
    + lit(siteId) + ", " + lit(useKind) + ", " + lit(sp) + ", true, " + lit(alt) + ")"
    + " on conflict (site_id, storage_path) do update set kind = excluded.kind, alt = excluded.alt, is_active = true;");
  return { name, bytes: buf.length, path: sp };
}

export async function deleteMedia(repo, siteId, fileName, confirm) {
  const { dir } = siteDir(repo, siteId);
  const { name } = safeName(fileName);
  if (confirm !== name) throw new MediaError('confirmation must equal the filename', 403);
  const p = join(dir, name);
  if (existsSync(p)) unlinkSync(p);
  await run('delete from public.media where site_id = ' + lit(siteId) + ' and storage_path = ' + lit('assets/media/' + name) + ';');
  const prof = join(repo, 'sites', String(siteId), 'data', 'profile.json');
  if (existsSync(prof)) {
    const j = JSON.parse(readFileSync(prof, 'utf8'));
    if (j.avatar === name) { delete j.avatar; writeFileSync(prof, JSON.stringify(j, null, 2) + '\n'); }
  }
  return { deleted: name };
}

export async function setAvatar(repo, siteId, fileName) {
  const { root, dir } = siteDir(repo, siteId);
  const { name } = safeName(fileName);
  if (existsSync(join(dir, name)) === false) throw new MediaError('no such media file: ' + name, 404);
  const prof = join(root, 'data', 'profile.json');
  const j = JSON.parse(readFileSync(prof, 'utf8'));
  const prev = j.avatar || null;
  j.avatar = name;
  writeFileSync(prof, JSON.stringify(j, null, 2) + '\n');
  const kinds = await allowedKinds();
  if (kinds.includes('avatar')) {
    await run('update public.media set kind = ' + lit('avatar') + ' where site_id = ' + lit(siteId) + ' and storage_path = ' + lit('assets/media/' + name) + ';');
  }
  return { avatar: name, previous: prev };
}

export async function dbRows(siteId) {
  if (!SITE.test(String(siteId || ''))) throw new MediaError('invalid site id');
  return rows(await run('select id, kind, storage_path, is_active, alt, created_at from public.media where site_id = ' + lit(siteId) + ' order by created_at desc', true));
}
