/**
 * supabase/migrations is the SINGLE source of truth (applied migrations are
 * immutable). packages/database/migrations is a GENERATED mirror.
 * MIRROR_MAP is EXPORTED so preflight derives its checks from it. Duplicating
 * the literals in two files let a string edit misalign a pair twice.
 *   node scripts/sync-mirrors.mjs          regenerate
 *   node scripts/sync-mirrors.mjs --check  exit 1 if out of sync
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const SRC_DIR = 'supabase/migrations';
export const DST_DIR = 'packages/database/migrations';
export const MIRROR_MAP = {
  '20261117220000_portrox_init.sql': '0001_init.sql',
  '20261118230000_studio_owner.sql': '0002_studio_owner.sql',
  '20261119070000_harden_definer.sql': '0003_harden_definer.sql',
  '20261119080000_perf_rls_fk.sql': '0004_perf_rls_fk.sql',
  '20261119090000_legacy_lockdown.sql': '0005_legacy_lockdown.sql',
  '20261119100000_drop_legacy_policies.sql': '0006_drop_legacy_policies.sql',
  '20261123210000_inbox_triage.sql': '0007_inbox_triage.sql',
  '20261123220000_media_unique.sql': '0008_media_unique.sql',
  '20261126010000_payment_ref.sql': '0009_payment_ref.sql',
  '20261126020000_payment_ref_guard.sql': '0010_payment_ref_guard.sql',
  '20261126030000_book_validate_first.sql': '0011_book_validate_first.sql'
};
/** [mirrorPath, sourcePath] pairs derived from the map. Never hand-written. */
export function mirrorPairs() {
  return Object.entries(MIRROR_MAP).map(([src, dst]) => [join(DST_DIR, dst), join(SRC_DIR, src)]);
}
export function mirrorFiles() {
  return [...Object.keys(MIRROR_MAP).map(f => join(SRC_DIR, f)),
          ...Object.values(MIRROR_MAP).map(f => join(DST_DIR, f))];
}

const isMain = process.argv[1] && process.argv[1].endsWith('sync-mirrors.mjs');
if (isMain) {
  const CHECK = process.argv.includes('--check');
  mkdirSync(DST_DIR, { recursive: true });
  let bad = 0;
  for (const [src, dst] of Object.entries(MIRROR_MAP)) {
    const a = join(SRC_DIR, src), b = join(DST_DIR, dst);
    if (existsSync(a) === false) { console.log('MISS source ' + a); bad++; continue; }
    const want = readFileSync(a);
    const have = existsSync(b) ? readFileSync(b) : null;
    if (have && have.equals(want)) { console.log('OK   ' + dst + ' in sync (' + want.length + 'B)'); continue; }
    if (CHECK) { console.log('DRIFT ' + dst + ' (mirror ' + (have ? have.length : 0) + 'B vs source ' + want.length + 'B)'); bad++; continue; }
    writeFileSync(b, want);
    console.log('SYNC ' + dst + ' <- ' + src + ' (' + want.length + 'B)');
  }
  for (const f of readdirSync(DST_DIR)) {
    if (Object.values(MIRROR_MAP).includes(f) === false) console.log('NOTE orphan mirror (no source mapping): ' + f);
  }
  console.log(bad === 0 ? (CHECK ? 'MIRRORS IN SYNC' : 'MIRRORS SYNCED') : 'MIRRORS BAD=' + bad);
  process.exit(bad === 0 ? 0 : 1);
}
