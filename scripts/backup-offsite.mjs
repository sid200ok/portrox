/**
 * Off-machine backup. backups/ lives on the same disk as the thing it protects;
 * if this machine dies, both die. RESTORE PROVEN proves restorability, not
 * durability.
 *
 * The bundle contains lead PII, so it is encrypted with AES-256-GCM using a
 * scrypt-derived key BEFORE it leaves this machine, and pushed to a PRIVATE
 * repo on a different provider. The passphrase is never written to disk here.
 *
 *   PORTROX_BACKUP_PASSPHRASE='...' node scripts/backup-offsite.mjs
 *   node scripts/backup-offsite.mjs --decrypt <file>   # round-trip check
 *
 * Generate a passphrase once and keep it in your password manager:
 *   node -e 'console.log(require("crypto").randomBytes(32).toString("base64url"))'
 * Losing it means losing the backups. It is not recoverable from this repo.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { loadConfig } from '../packages/cli/config-store.mjs';
import { resolveGitAuth } from '../packages/cli/git-auth.mjs';
import * as GH from '../packages/cli/github-ops.mjs';

import { readKey } from '../packages/cli/backup-key.mjs';
const PASS = process.env.PORTROX_BACKUP_PASSPHRASE || readKey();
const MAGIC = 'PXB1';
const keyOf = (pass, salt) => scryptSync(pass, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

function seal(obj, pass) {
  const salt = randomBytes(16), iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', keyOf(pass, salt), iv);
  const body = Buffer.concat([c.update(gzipSync(Buffer.from(JSON.stringify(obj)))), c.final()]);
  return Buffer.concat([Buffer.from(MAGIC), salt, iv, c.getAuthTag(), body]);
}
function open(buf, pass) {
  if (buf.subarray(0, 4).toString() !== MAGIC) throw new Error('not a Portrox backup bundle');
  const salt = buf.subarray(4, 20), iv = buf.subarray(20, 32), tag = buf.subarray(32, 48), body = buf.subarray(48);
  const d = createDecipheriv('aes-256-gcm', keyOf(pass, salt), iv);
  d.setAuthTag(tag);
  return JSON.parse(gunzipSync(Buffer.concat([d.update(body), d.final()])).toString());
}

const decIdx = process.argv.indexOf('--decrypt');
if (decIdx > 0) {
  const f = process.argv[decIdx + 1];
  if (!PASS) { console.error('FAIL no backup key - Studio -> Settings -> Backup'); process.exit(1); }
  const obj = open(readFileSync(f), PASS);
  console.log('OK   decrypted ' + f);
  console.log('     project ' + obj.project + ' taken ' + obj.taken_at + ' tables ' + Object.keys(obj.tables || {}).length);
  process.exit(0);
}

if (!PASS || PASS.length < 20) { console.error('FAIL no backup key. Studio -> Settings -> Backup -> Generate key.'); process.exit(1); }
const c = loadConfig();
const ref = c.supabase.default_project_ref;
if (!ref) { console.error('FAIL no project'); process.exit(1); }
const base = join(process.cwd(), 'backups', ref);
if (existsSync(base) === false) { console.error('FAIL no local backups - run scripts/backup-db.mjs'); process.exit(1); }
const dirs = readdirSync(base).filter(d => existsSync(join(base, d, 'manifest.json'))).sort();
if (!dirs.length) { console.error('FAIL no backup with a manifest'); process.exit(1); }
const dir = join(base, dirs[dirs.length - 1]);
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
const bundle = { project: ref, taken_at: manifest.taken_at, migrations: manifest.migrations || [], tables: {} };
for (const t of Object.keys(manifest.tables || {})) bundle.tables[t] = JSON.parse(readFileSync(join(dir, t + '.json'), 'utf8'));
console.log('local backup: ' + dir);

// Prove the encryption is reversible BEFORE shipping it anywhere.
const sealed = seal(bundle, PASS);
const back = open(sealed, PASS);
if (JSON.stringify(back) !== JSON.stringify(bundle)) { console.error('FAIL round-trip mismatch'); process.exit(1); }
console.log('OK   encrypt/decrypt round trip verified (' + sealed.length + ' bytes)');

const outDir = join(process.cwd(), 'backups-offsite');
mkdirSync(outDir, { recursive: true, mode: 0o700 });
const stamp = String(manifest.taken_at).replace(/[:.]/g, '-');
const name = ref + '-' + stamp + '.pxb';
writeFileSync(join(outDir, name), sealed, { mode: 0o600 });
console.log('OK   wrote ' + name);

const st = await GH.authStatus();
if (st.connected === false) { console.error('FAIL GitHub not connected'); process.exit(1); }
const repoName = 'portrox-backups';
const full = st.login + '/' + repoName;
try { await GH.getRepo(full); console.log('OK   private repo exists ' + full); }
catch {
  const made = await GH.createRepo({ name: repoName, owner: st.login, description: 'Encrypted Portrox backups', private: true });
  console.log('OK   created PRIVATE repo ' + made.full_name);
}
const info = await GH.getRepo(full);
if (info.private !== true) { console.error('FAIL ' + full + ' is NOT private - refusing to push PII'); process.exit(1); }
console.log('OK   repo confirmed private');

const auth = resolveGitAuth(full);
const tmp = mkdtempSync(join(tmpdir(), 'portrox-off-'));
const git = (args, allowFail) => {
  const r = spawnSync('git', auth.args.concat(args), { cwd: tmp, env: auth.env, encoding: 'utf8', timeout: 180000 });
  if (r.status !== 0) {
    if (allowFail) return { ok: false, out: String(r.stderr || r.stdout || '').trim() };
    throw new Error('git ' + args.join(' ') + ' :: ' + String(r.stderr || r.stdout).trim().slice(0, 240));
  }
  return { ok: true, out: String(r.stdout || '').trim() };
};
try {
  // A4: the previous version did `git init` + `push --force`, replacing remote
  // main with a single commit and DESTROYING every earlier offsite backup.
  // Clone first and APPEND. Init only when the remote is genuinely empty.
  const cloned = git(['clone', '--quiet', auth.url, tmp], true);
  if (cloned.ok) {
    console.log('OK   cloned existing backup repo (history preserved)');
  } else {
    console.log('NOTE remote empty or uncloneable - initialising: ' + cloned.out.slice(0, 120));
    git(['init', '-q', '-b', 'main']);
    git(['remote', 'add', 'origin', auth.url]);
  }
  git(['config', 'user.email', 'portrox@localhost']);
  git(['config', 'user.name', 'Portrox']);
  writeFileSync(join(tmp, name), sealed, { mode: 0o600 });
  writeFileSync(join(tmp, 'README.md'), 'Encrypted Portrox backups. AES-256-GCM with a scrypt key.\nDecrypt: node scripts/backup-offsite.mjs --decrypt <file>\nThe passphrase is NOT in this repo and is not recoverable from it.\n');
  git(['add', '-A']);
  const committed = git(['commit', '-q', '-m', 'Encrypted backup ' + stamp], true);
  if (!committed.ok && /nothing to commit/i.test(committed.out)) {
    console.log('NOTE this bundle is already present offsite');
  } else if (!committed.ok) {
    throw new Error('commit failed: ' + committed.out.slice(0, 200));
  }
  const pushed = git(['push', '-q', 'origin', 'HEAD:refs/heads/main'], true);
  if (!pushed.ok) {
    // Only a brand-new remote may need an upstream set; never force.
    const retry = git(['push', '-q', '-u', 'origin', 'main'], true);
    if (!retry.ok) throw new Error('push failed: ' + (pushed.out + ' | ' + retry.out).slice(0, 240));
  }
  const count = git(['rev-list', '--count', 'HEAD'], true);
  console.log('OK   appended via ' + auth.method + ' (repo now has ' + (count.out || '?') + ' commits)');
} finally { rmSync(tmp, { recursive: true, force: true }); }
console.log('\nOFFSITE OK ' + full + '/' + name);
process.exit(0);
