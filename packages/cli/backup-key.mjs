/**
 * Offsite backup key custody, UI-only. No terminal prompt ever asks for a secret.
 * Stored at ~/.portrox/backup-key.json 0600 inside the 0700 dir, exactly like the
 * Supabase and GitHub tokens. The key is returned ONCE by generate() so the
 * browser can show it for copying into a password manager; it is never logged.
 * The key must ALSO live in your password manager - otherwise a dead machine
 * means undecryptable offsite bundles. confirmCustody() records that you did it.
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const HOME = process.env.PORTROX_HOME || join(homedir(), '.portrox');
const P = join(HOME, 'backup-key.json');
export class KeyError extends Error { constructor(m, c) { super(m); this.code = c || 400; } }

function read() { try { return JSON.parse(readFileSync(P, 'utf8')); } catch { return null; } }
export function hasKey() { const j = read(); return Boolean(j && typeof j.key === 'string' && j.key.length >= 20); }
export function readKey() { const j = read(); return (j && j.key) || ''; }
export function status() {
  const j = read();
  return { configured: Boolean(j && j.key), created_at: (j && j.created_at) || null, custody_confirmed: Boolean(j && j.custody_confirmed), fingerprint: fingerprint() };
}
/**
 * The key is NEVER returned to the browser. Displaying a secret invites it being
 * pasted into a chat, a screenshot or a screen-share - that happened three times.
 * Instead the server copies it straight to the OS clipboard and returns only a
 * non-reversible fingerprint so the operator can confirm identity.
 */
function clipboard(text) {
  const tools = process.platform === 'darwin' ? [['pbcopy', []]]
    : process.platform === 'win32' ? [['clip', []]]
    : [['clip.exe', []], ['xclip', ['-selection', 'clipboard']], ['wl-copy', []]];
  for (const [cmd, args] of tools) {
    const r = spawnSync(cmd, args, { input: text, encoding: 'utf8', timeout: 10000 });
    if (r.status === 0) return cmd;
  }
  return '';
}
export function fingerprint() {
  const k = readKey();
  return k ? createHash('sha256').update(k).digest('hex').slice(0, 8) : '';
}
export function copyKey() {
  const k = readKey();
  if (!k) throw new KeyError('no key to copy', 404);
  const via = clipboard(k);
  if (!via) throw new KeyError('no clipboard tool found (clip.exe / pbcopy / xclip / wl-copy)', 500);
  return { copied: true, via, fingerprint: fingerprint() };
}
export function generateKey() {
  mkdirSync(HOME, { recursive: true, mode: 0o700 });
  const key = randomBytes(32).toString('base64url');
  writeFileSync(P, JSON.stringify({ key, created_at: new Date().toISOString(), custody_confirmed: false }, null, 2) + '\n', { mode: 0o600 });
  chmodSync(P, 0o600);
  const via = clipboard(key);
  return { created_at: new Date().toISOString(), copied: Boolean(via), via, fingerprint: fingerprint() };
}
export function confirmCustody() {
  const j = read();
  if (!j || !j.key) throw new KeyError('no key to confirm', 404);
  j.custody_confirmed = true; j.confirmed_at = new Date().toISOString();
  writeFileSync(P, JSON.stringify(j, null, 2) + '\n', { mode: 0o600 });
  return status();
}
export function clearKey(confirm) {
  if (confirm !== 'CLEAR') throw new KeyError('confirmation must equal CLEAR', 403);
  if (existsSync(P)) unlinkSync(P);
  return { cleared: true };
}
