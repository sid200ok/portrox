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
import { randomBytes } from 'node:crypto';

const HOME = process.env.PORTROX_HOME || join(homedir(), '.portrox');
const P = join(HOME, 'backup-key.json');
export class KeyError extends Error { constructor(m, c) { super(m); this.code = c || 400; } }

function read() { try { return JSON.parse(readFileSync(P, 'utf8')); } catch { return null; } }
export function hasKey() { const j = read(); return Boolean(j && typeof j.key === 'string' && j.key.length >= 20); }
export function readKey() { const j = read(); return (j && j.key) || ''; }
export function status() {
  const j = read();
  return { configured: Boolean(j && j.key), created_at: (j && j.created_at) || null, custody_confirmed: Boolean(j && j.custody_confirmed) };
}
export function generateKey() {
  mkdirSync(HOME, { recursive: true, mode: 0o700 });
  const key = randomBytes(32).toString('base64url');
  writeFileSync(P, JSON.stringify({ key, created_at: new Date().toISOString(), custody_confirmed: false }, null, 2) + '\n', { mode: 0o600 });
  chmodSync(P, 0o600);
  return { key, created_at: new Date().toISOString() };   // shown ONCE, in the browser
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
