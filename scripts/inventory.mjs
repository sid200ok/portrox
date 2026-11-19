/**
 * Content inventory. Every other gate proves the MACHINE works; none proves the
 * PORTFOLIO has content. A structurally perfect site with empty services and no
 * bookable slots is a shell, not a launch.
 *   node scripts/inventory.mjs [site_id]
 * Informational: always exits 0. Filling content is an editorial decision.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const siteId = process.argv[2] || 'sid200ok.github.io';
const root = join(process.cwd(), 'sites', siteId);
if (existsSync(root) === false) { console.error('no such site: ' + siteId); process.exit(0); }
const words = s => String(s || '').replace(/[#*`>\-]/g, ' ').split(/\s+/).filter(Boolean).length;
const load = p => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const gaps = [];
console.log('site: ' + siteId);

console.log('\n-- data collections --');
for (const f of ['experience.json', 'projects.json', 'services.json']) {
  const p = join(root, 'data', f);
  const j = load(p);
  const n = Array.isArray(j) ? j.length : (j && Array.isArray(j.items) ? j.items.length : 0);
  console.log((n > 0 ? 'OK   ' : 'EMPTY') + ' ' + f + ': ' + n + ' entries');
  if (n === 0) gaps.push(f + ' has no entries');
}

console.log('\n-- profile --');
const prof = load(join(root, 'data', 'profile.json')) || {};
for (const k of ['full_name', 'headline', 'location', 'email']) {
  const v = prof[k] || (prof.links && prof.links[k]) || '';
  console.log((String(v).trim() ? 'OK   ' : 'MISS ') + ' profile.' + k + (v ? ': ' + String(v).slice(0, 60) : ''));
  if (!String(v).trim() && k !== 'location') gaps.push('profile.' + k + ' missing');
}
const links = prof.links || {};
console.log('     links: ' + (Object.keys(links).join(', ') || '(none)'));
const skills = Array.isArray(prof.skills) ? prof.skills.length : 0;
console.log((skills ? 'OK   ' : 'EMPTY') + ' profile.skills: ' + skills);

console.log('\n-- narrative content --');
for (const f of ['intro.md', 'about.md']) {
  const p = join(root, 'content', f);
  const n = existsSync(p) ? words(readFileSync(p, 'utf8')) : 0;
  console.log((n >= 40 ? 'OK   ' : 'THIN ') + ' ' + f + ': ' + n + ' words');
  if (n < 40) gaps.push(f + ' is thin (' + n + ' words)');
}

console.log('\n-- booking availability --');
const av = load(join(root, 'data', 'availability.json'));
if (!av) { console.log('EMPTY availability.json absent'); gaps.push('no availability.json - booking cannot offer slots'); }
else {
  const slots = Array.isArray(av.slots) ? av.slots.length
    : Array.isArray(av.weekly) ? av.weekly.length
    : Array.isArray(av.rules) ? av.rules.length : 0;
  console.log((slots > 0 ? 'OK   ' : 'EMPTY') + ' availability entries: ' + slots);
  console.log('     keys: ' + Object.keys(av).join(', '));
  if (slots === 0) gaps.push('availability has no slots - /book.html cannot book anything');
}

console.log('\n-- site config --');
const cfg = load(join(root, 'site.json')) || {};
console.log('     published: ' + Boolean(cfg.published) + ' | registered: ' + Boolean(cfg.registered));
console.log('     seo.title: ' + ((cfg.seo && cfg.seo.title) || '(none)'));
console.log('     nav: ' + JSON.stringify(cfg.nav || {}));

console.log('\n-- summary --');
if (gaps.length === 0) console.log('INVENTORY COMPLETE');
else { console.log('INVENTORY GAPS=' + gaps.length); for (const g of gaps) console.log('  ' + g); }
process.exit(0);
