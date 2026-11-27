/**
 * Schema parity. supabase/migrations is the source of truth; packages/database is
 * a GENERATED mirror of the PORTROX schema only.
 *
 *   node scripts/verify-migrations.mjs
 *
 * WHY: the source tree held 19 migrations while the mirror held 12, and no gate
 * noticed. A self-hoster following the mirror would get a different schema.
 * Every source file must now be either byte-mirrored or explicitly declared
 * legacy with a reason. Filename matching is NOT used - mirrors are renamed, so
 * MIRROR_MAP is the only authority.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { MIRROR_MAP } from './sync-mirrors.mjs';

const SRC = 'supabase/migrations';
const DST = 'packages/database/migrations';
let bad = 0;
const ok = m => console.log('OK   ' + m);
const fail = m => { bad++; console.log('FAIL ' + m); };

if (!MIRROR_MAP || typeof MIRROR_MAP !== 'object') {
  console.log('FAIL MIRROR_MAP is not exported by scripts/sync-mirrors.mjs');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync('supabase/legacy-migrations.json', 'utf8')).legacy || {};
const source = readdirSync(SRC).filter(f => f.endsWith('.sql')).sort();
const mirrors = readdirSync(DST).filter(f => f.endsWith('.sql')).sort();
const mapped = new Set(Object.keys(MIRROR_MAP));
const declared = new Set(Object.keys(manifest));

const undeclared = source.filter(f => !mapped.has(f) && !declared.has(f));
const both = source.filter(f => mapped.has(f) && declared.has(f));
const staleMap = [...mapped].filter(f => !source.includes(f));
const staleLegacy = [...declared].filter(f => !source.includes(f));
const orphanMirrors = mirrors.filter(f => !Object.values(MIRROR_MAP).includes(f));

console.log('source=' + source.length + ' mirrored=' + mapped.size + ' declared legacy=' + declared.size + ' mirror files=' + mirrors.length);

undeclared.length ? fail('undeclared source migration(s): ' + undeclared.join(', '))
                  : ok('every source migration is mirrored or declared legacy');
both.length ? fail('file is BOTH mirrored and legacy: ' + both.join(', '))
            : ok('no file is claimed by both sets');
staleMap.length ? fail('MIRROR_MAP names missing file(s): ' + staleMap.join(', '))
                : ok('MIRROR_MAP has no stale entries');
staleLegacy.length ? fail('legacy manifest names missing file(s): ' + staleLegacy.join(', '))
                   : ok('legacy manifest has no stale entries');
orphanMirrors.length ? fail('mirror file(s) not in MIRROR_MAP: ' + orphanMirrors.join(', '))
                     : ok('no orphan mirror files');

for (const [src, dst] of Object.entries(MIRROR_MAP)) {
  const a = join(SRC, src), b = join(DST, dst);
  if (!existsSync(a) || !existsSync(b)) { fail('mirror pair incomplete: ' + src + ' -> ' + dst); continue; }
  readFileSync(a).equals(readFileSync(b))
    ? ok('byte-identical ' + dst)
    : fail('DRIFT ' + dst + ' - run node scripts/sync-mirrors.mjs');
}

for (const f of declared) {
  const reason = String(manifest[f] || '').trim();
  reason.length >= 20 ? ok('legacy reason recorded: ' + f) : fail('legacy entry lacks a real reason: ' + f);
}

const accounted = mapped.size + declared.size;
accounted === source.length
  ? ok('arithmetic closes: ' + source.length + ' = ' + mapped.size + ' mirrored + ' + declared.size + ' legacy')
  : fail('arithmetic does not close: ' + source.length + ' source vs ' + accounted + ' accounted');

console.log(bad === 0 ? '\nMIGRATIONS OK' : '\nMIGRATIONS BAD=' + bad);
process.exit(bad === 0 ? 0 : 1);
