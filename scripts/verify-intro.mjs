/**
 * Proves the intro wizard against the REAL invariant: the rendered homepage has
 * exactly ONE h1. The heading policy is DERIVED from the current intro.md, not
 * assumed - intro.md is the source of the homepage h1, while render.mjs supplies
 * the about-page h1 separately.
 * Save/render on a scratch copy; the live file is never modified.
 */
import { mkdtempSync, mkdirSync, cpSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as IW from '../packages/cli/intro-wizard.mjs';

const REAL = process.cwd();
const site = process.argv[2] || 'sid200ok.github.io';
let bad = 0;
const ok = m => console.log('OK   ' + m);
const fail = m => { bad++; console.log('FAIL ' + m); };
const mustThrow = (fn, re, label) => {
  try { fn(); fail(label + ' did NOT refuse'); }
  catch (e) { re.test(e.message) ? ok(label + ' refused') : fail(label + ' wrong error: ' + e.message); }
};
const A = { name: 'Probe Person', headline: 'Backend Engineer', years: '5', skills: ['Python', 'PostgreSQL'], seeking: 'Open to remote roles.', location: 'Bihar, India', availability: 'Available immediately' };

const policy = IW.headingPolicy(REAL, site);
const OPT = { heading: policy };
console.log('current intro supplies the homepage h1: ' + policy);

let md = '';
try {
  md = IW.composeIntro(A, OPT);
  md === IW.composeIntro(A, OPT) ? ok('deterministic output') : fail('output is not deterministic');
  const n = (md.match(/^#\s/gm) || []).length;
  n === (policy ? 1 : 0) ? ok('heading count matches the current artifact (' + n + ')') : fail('heading count ' + n + ', expected ' + (policy ? 1 : 0));
  /[<>]/.test(md) === false ? ok('no raw angle brackets') : fail('raw angle brackets present');
  IW.previewIntro(REAL, site, A).markdown === md ? ok('preview equals save bytes') : fail('preview differs from save');
} catch (e) { fail('compose threw: ' + e.message); }

console.log('\n-- refusals --');
mustThrow(() => IW.composeIntro({ ...A, name: '' }, OPT), /name/, 'missing name');
mustThrow(() => IW.composeIntro({ ...A, headline: '' }, OPT), /headline/, 'missing headline');
mustThrow(() => IW.composeIntro({ ...A, skills: [] }, OPT), /skill/, 'no skills');
mustThrow(() => IW.composeIntro({ ...A, years: 'abc' }, OPT), /years/, 'non-numeric years');
try {
  const inj = IW.composeIntro({ ...A, name: 'X <script>alert(1)</script>' }, OPT);
  /[<>]/.test(inj) === false ? ok('angle brackets stripped from answers') : fail('injection survived');
} catch (e) { ok('injection refused: ' + e.message); }

console.log('\n-- render invariant (scratch copy) --');
const livePath = join(REAL, 'sites', site, 'content', 'intro.md');
const liveBefore = readFileSync(livePath, 'utf8');
const box = mkdtempSync(join(tmpdir(), 'px-intro-'));
try {
  mkdirSync(join(box, 'sites'), { recursive: true });
  cpSync(join(REAL, 'sites', site), join(box, 'sites', site), { recursive: true, filter: s => s.includes('.content-history') === false });
  IW.saveIntro(box, site, A);
  const out = mkdtempSync(join(tmpdir(), 'px-intro-out-'));
  try {
    const { renderSite } = await import(join(REAL, 'packages/core/render.mjs'));
    await renderSite(join(box, 'sites', site), out);
    const html = readFileSync(join(out, 'index.html'), 'utf8');
    const n = (html.match(/<h1[\s>]/gi) || []).length;
    n === 1 ? ok('rendered homepage has exactly ONE h1') : fail('rendered homepage has ' + n + ' h1 elements');
    html.includes('Probe Person') ? ok('generated prose reached the artifact') : fail('prose missing from artifact');
    const about = readFileSync(join(out, 'about.html'), 'utf8');
    (about.match(/<h1[\s>]/gi) || []).length === 1 ? ok('about page still has exactly ONE h1') : fail('about page h1 count changed');
  } finally { rmSync(out, { recursive: true, force: true }); }
} catch (e) { fail('render invariant threw: ' + e.message); }
finally { rmSync(box, { recursive: true, force: true }); ok('scratch copy removed'); }

readFileSync(livePath, 'utf8') === liveBefore ? ok('live intro.md byte-identical') : fail('live intro.md CHANGED');
console.log('\n' + (bad === 0 ? 'INTRO OK' : 'INTRO BAD=' + bad));
process.exit(bad === 0 ? 0 : 1);
