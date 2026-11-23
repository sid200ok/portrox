/**
 * Guided intro writer. No AI calls - Portrox makes none. Deterministic prose
 * from your answers, so Preview and Save produce identical bytes.
 *
 * HARD CONSTRAINT: the rendered homepage must have exactly ONE h1. I assumed
 * the profile supplied it and emitted prose only - the scratch render then had
 * ZERO, because intro.md IS the source of the homepage h1. The heading policy is
 * now DERIVED from the current intro.md, never assumed.
 * Raw angle brackets are stripped: the wizard produces plain text, not HTML.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import * as CS from './content-store.mjs';

export class IntroError extends Error { constructor(m, c) { super(m); this.code = c || 400; } }
const clean = (v, max) => String(v == null ? '' : v).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

export function headingPolicy(repo, siteId) {
  const cur = currentIntro(repo, siteId);
  return /^#\s/m.test(cur);
}

export function composeIntro(a = {}, { heading = true } = {}) {
  const name = clean(a.name, 80);
  const headline = clean(a.headline, 140);
  const years = clean(a.years, 6);
  const skills = Array.isArray(a.skills) ? a.skills.map(x => clean(x, 40)).filter(Boolean).slice(0, 6) : [];
  const seeking = clean(a.seeking, 220);
  const location = clean(a.location, 80);
  const availability = clean(a.availability, 120);
  if (!name) throw new IntroError('name is required');
  if (!headline) throw new IntroError('headline is required');
  if (skills.length === 0) throw new IntroError('at least one skill is required');
  if (years && !/^\d{1,2}$/.test(years)) throw new IntroError('years must be a number 0-99');

  const lines = [];
  if (heading) { lines.push('# ' + name); lines.push(''); }
  lines.push('I am ' + name + ', ' + headline + '.');
  lines.push('');
  lines.push((years ? years + '+ years of hands-on work across ' : 'Hands-on work across ') + skills.join(', ') + '.');
  if (seeking) { lines.push(''); lines.push(seeking); }
  const where = [location ? 'Based in ' + location : '', availability].filter(Boolean).join('. ');
  if (where) { lines.push(''); lines.push(where + '.'); }
  lines.push('');
  lines.push('[Get in touch](index.html#contact) or [book a call](book.html).');
  const md = lines.join('\n') + '\n';
  const h1s = (md.match(/^#\s/gm) || []).length;
  if (h1s !== (heading ? 1 : 0)) throw new IntroError('internal error: expected ' + (heading ? 1 : 0) + ' h1, got ' + h1s);
  return md;
}

export function previewIntro(repo, siteId, answers) {
  const md = composeIntro(answers, { heading: headingPolicy(repo, siteId) });
  return { markdown: md, bytes: Buffer.byteLength(md) };
}

export function saveIntro(repo, siteId, answers) {
  const md = composeIntro(answers, { heading: headingPolicy(repo, siteId) });
  return CS.writeContent(repo, siteId, 'content/intro.md', md);
}

export function currentIntro(repo, siteId) {
  const p = join(repo, 'sites', String(siteId), 'content', 'intro.md');
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
}

export function defaultsFromProfile(repo, siteId) {
  const p = join(repo, 'sites', String(siteId), 'data', 'profile.json');
  if (existsSync(p) === false) return {};
  const j = JSON.parse(readFileSync(p, 'utf8'));
  return { name: j.full_name || '', headline: j.headline || '', location: j.location || '', skills: Array.isArray(j.skills) ? j.skills.slice(0, 6) : [] };
}
