/**
 * supabase/migrations is the SINGLE source of truth (applied migrations are
 * immutable). packages/database/migrations is a GENERATED mirror.
 * Hand-maintaining both caused drift: formatting hooks touched one side only.
 *   node scripts/sync-mirrors.mjs        # regenerate
 *   node scripts/sync-mirrors.mjs --check # exit 1 if out of sync
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'supabase/migrations';
const DST = 'packages/database/migrations';
const MAP = {
  '20261117220000_portrox_init.sql': '0001_init.sql',
  '20261118230000_studio_owner.sql': '0002_studio_owner.sql',
  '20261119070000_harden_definer.sql': '0003_harden_definer.sql'
};
const CHECK = process.argv.includes('--check');
mkdirSync(DST, { recursive: true });
let bad = 0;
for (const [src, dst] of Object.entries(MAP)) {
  const a = join(SRC, src), b = join(DST, dst);
  if (existsSync(a) === false) { console.log('MISS source ' + a); bad++; continue; }
  const want = readFileSync(a);
  const have = existsSync(b) ? readFileSync(b) : null;
  if (have && have.equals(want)) { console.log('OK   ' + dst + ' in sync'); continue; }
  if (CHECK) { console.log('DRIFT ' + dst + ' (mirror ' + (have ? have.length : 0) + 'B vs source ' + want.length + 'B)'); bad++; continue; }
  writeFileSync(b, want);
  console.log('SYNC ' + dst + ' <- ' + src + ' (' + want.length + 'B)');
}
// Report any stray mirror files with no source.
for (const f of readdirSync(DST)) {
  if (Object.values(MAP).includes(f) === false) console.log('NOTE orphan mirror (no source mapping): ' + f);
}
console.log(bad === 0 ? (CHECK ? 'MIRRORS IN SYNC' : 'MIRRORS SYNCED') : 'MIRRORS BAD=' + bad);
process.exit(bad === 0 ? 0 : 1);
