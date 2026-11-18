/**
 * Portrox local authentication.
 * Credentials + recovery live in ~/.portrox/auth.json (0600) in a 0700 dir.
 * Passwords and recovery answers are scrypt-hashed with per-item salts.
 * Sessions are in-memory only: restarting the daemon signs everyone out.
 *
 * Emergency reset (local shell access required):
 *   node packages/cli/auth-store.mjs reset
 */
import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync, renameSync, unlinkSync } from 'node:fs';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const HOME = process.env.PORTROX_HOME || join(homedir(), '.portrox');
const FILE = join(HOME, 'auth.json');

const ABS_TTL = 8 * 3600 * 1000;
const IDLE_TTL = 30 * 60 * 1000;
const MAX_FAIL = 5;
const FAIL_WINDOW = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const RECOVER_MAX = 3;
const RECOVER_WINDOW = 60 * 60 * 1000;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const sessions = new Map();
const resetTokens = new Map();
let fails = [];
let recoverFails = [];

export const QUESTION_BANK = [
  { id: 'mobile',     label: 'Last 4 digits of your mobile number' },
  { id: 'nickname',   label: 'Childhood nickname' },
  { id: 'birthplace', label: 'City you were born in' },
  { id: 'teacher',    label: 'Favourite school teacher\u2019s name' },
  { id: 'pet',        label: 'First pet\u2019s name' },
  { id: 'street',     label: 'Street you grew up on' }
];

function ensureDir() {
  mkdirSync(HOME, { recursive: true, mode: 0o700 });
  try { chmodSync(HOME, 0o700); } catch {}
}
function hash(value, salt) {
  return scryptSync(String(value), Buffer.from(salt, 'hex'), 64, SCRYPT).toString('hex');
}
function makeSecret(value) {
  const salt = randomBytes(16).toString('hex');
  return { salt, hash: hash(value, salt) };
}
function verify(value, rec) {
  if (!rec || !rec.salt || !rec.hash) return false;
  const a = Buffer.from(hash(value, rec.salt), 'hex');
  const b = Buffer.from(rec.hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const b32 = n => {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (const b of randomBytes(n)) out += A[b % A.length];
  return out;
};

function blank() {
  return {
    version: 1,
    user: { username: 'admin', ...makeSecret('admin'), createdAt: Date.now(), rotated: false },
    prompt: { dismissed: false },
    recovery: { required: 2, questions: [], key: null },
    updatedAt: Date.now()
  };
}

export function load() {
  ensureDir();
  if (existsSync(FILE) === false) { const b = blank(); save(b); return b; }
  try {
    const c = JSON.parse(readFileSync(FILE, 'utf8'));
    if (!c.user || !c.user.hash) throw new Error('corrupt');
    c.prompt = c.prompt || { dismissed: false };
    c.recovery = c.recovery || { required: 2, questions: [], key: null };
    return c;
  } catch {
    const b = blank(); save(b); return b;
  }
}
export function save(c) {
  ensureDir();
  c.updatedAt = Date.now();
  const tmp = FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(c, null, 2), { mode: 0o600 });
  renameSync(tmp, FILE);
  try { chmodSync(FILE, 0o600); } catch {}
}

export function isDefaultCredentials() {
  const c = load();
  return c.user.username === 'admin' && verify('admin', c.user);
}

export function publicState() {
  const c = load();
  return {
    username: c.user.username,
    rotated: Boolean(c.user.rotated),
    promptDismissed: Boolean(c.prompt.dismissed),
    usingDefaults: isDefaultCredentials(),
    recoveryConfigured: c.recovery.questions.length >= c.recovery.required,
    recoveryQuestions: c.recovery.questions.map(q => ({ id: q.id, label: q.label })),
    recoveryRequired: c.recovery.required,
    recoveryKeySet: Boolean(c.recovery.key),
    questionBank: QUESTION_BANK
  };
}

function lockedFor() {
  const now = Date.now();
  fails = fails.filter(t => now - t < FAIL_WINDOW);
  if (fails.length >= MAX_FAIL) {
    const oldest = fails[0];
    return Math.max(0, LOCK_MS - (now - oldest));
  }
  return 0;
}

export function login({ username, password }) {
  const wait = lockedFor();
  if (wait > 0) throw new Error('Too many attempts. Try again in ' + Math.ceil(wait / 60000) + ' min.');
  const c = load();
  const okUser = String(username || '').trim() === c.user.username;
  const okPass = verify(String(password || ''), c.user);
  if (!okUser || !okPass) {
    fails.push(Date.now());
    const left = Math.max(0, MAX_FAIL - fails.length);
    throw new Error('Invalid username or password.' + (left > 0 ? ' ' + left + ' attempt(s) left.' : ' Locked for 15 min.'));
  }
  fails = [];
  const sid = randomBytes(32).toString('hex');
  sessions.set(sid, { username: c.user.username, created: Date.now(), seen: Date.now() });
  return { sid, ...publicState() };
}

export function session(sid) {
  if (!sid) return null;
  const s = sessions.get(sid);
  if (!s) return null;
  const now = Date.now();
  if (now - s.created > ABS_TTL || now - s.seen > IDLE_TTL) { sessions.delete(sid); return null; }
  s.seen = now;
  return s;
}
export function logout(sid) { if (sid) sessions.delete(sid); }
export function logoutAll() { sessions.clear(); }

export function changeCredentials({ currentPassword, username, password, dismissPrompt }) {
  const c = load();
  if (!verify(String(currentPassword || ''), c.user)) throw new Error('Current password is incorrect.');
  const u = String(username || '').trim();
  if (u && !/^[a-zA-Z0-9._-]{3,32}$/.test(u)) throw new Error('Username must be 3-32 chars: letters, digits, dot, underscore, hyphen.');
  if (password) {
    if (String(password).length < 8) throw new Error('New password must be at least 8 characters.');
    if (String(password) === 'admin') throw new Error('Choose a password other than the default.');
    c.user = { ...c.user, ...makeSecret(String(password)), rotated: true };
  }
  if (u) c.user.username = u;
  if (dismissPrompt === true) c.prompt.dismissed = true;
  if (c.user.username !== 'admin' || c.user.rotated) c.user.rotated = true;
  save(c);
  logoutAll();
  return publicState();
}

export function dismissPrompt() {
  const c = load();
  c.prompt.dismissed = true;
  save(c);
  return publicState();
}

export function setupRecovery({ currentPassword, answers, required }) {
  const c = load();
  if (!verify(String(currentPassword || ''), c.user)) throw new Error('Current password is incorrect.');
  const list = Array.isArray(answers) ? answers.filter(a => a && a.id && String(a.value || '').trim()) : [];
  const req = Math.max(1, Math.min(list.length || 1, Number(required) || 2));
  if (list.length < req) throw new Error('Provide at least ' + req + ' answers.');
  const seen = new Set();
  c.recovery.questions = list.map(a => {
    const meta = QUESTION_BANK.find(q => q.id === a.id);
    if (!meta) throw new Error('Unknown question id: ' + a.id);
    if (seen.has(a.id)) throw new Error('Duplicate question: ' + a.id);
    seen.add(a.id);
    if (norm(a.value).length < 2) throw new Error('Answer too short for: ' + meta.label);
    return { id: a.id, label: meta.label, ...makeSecret(norm(a.value)) };
  });
  c.recovery.required = req;
  save(c);
  return publicState();
}

export function issueRecoveryKey({ currentPassword }) {
  const c = load();
  if (!verify(String(currentPassword || ''), c.user)) throw new Error('Current password is incorrect.');
  const key = b32(24).match(/.{1,4}/g).join('-');
  c.recovery.key = makeSecret(norm(key));
  save(c);
  return { key };
}

export function recover({ answers, key }) {
  const now = Date.now();
  recoverFails = recoverFails.filter(t => now - t < RECOVER_WINDOW);
  if (recoverFails.length >= RECOVER_MAX) throw new Error('Too many recovery attempts. Try again in an hour.');
  const c = load();
  let pass = false;

  if (key && c.recovery.key) {
    pass = verify(norm(key), c.recovery.key);
  } else {
    if (c.recovery.questions.length === 0) throw new Error('No recovery method configured. Use: node packages/cli/auth-store.mjs reset');
    const given = Array.isArray(answers) ? answers : [];
    let correct = 0;
    for (const q of c.recovery.questions) {
      const a = given.find(x => x && x.id === q.id);
      if (a && verify(norm(a.value), q)) correct++;
    }
    pass = correct >= c.recovery.required;
  }

  if (!pass) { recoverFails.push(now); throw new Error('Recovery failed. Answers did not match.'); }
  recoverFails = [];
  const token = randomBytes(24).toString('hex');
  resetTokens.set(token, { expires: now + 10 * 60 * 1000 });
  return { resetToken: token, expiresIn: 600 };
}

export function resetWithToken({ resetToken, username, password }) {
  const rec = resetTokens.get(String(resetToken || ''));
  if (!rec || Date.now() > rec.expires) throw new Error('Reset token invalid or expired. Start recovery again.');
  resetTokens.delete(String(resetToken));
  const u = String(username || '').trim();
  const p = String(password || '');
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(u)) throw new Error('Username must be 3-32 chars: letters, digits, dot, underscore, hyphen.');
  if (p.length < 8) throw new Error('Password must be at least 8 characters.');
  if (p === 'admin') throw new Error('Choose a password other than the default.');
  const c = load();
  c.user = { username: u, ...makeSecret(p), createdAt: c.user.createdAt, rotated: true };
  c.prompt.dismissed = true;
  save(c);
  logoutAll();
  fails = [];
  return publicState();
}

function cliReset() {
  ensureDir();
  if (existsSync(FILE)) { try { unlinkSync(FILE); } catch {} }
  const c = blank();
  const key = b32(24).match(/.{1,4}/g).join('-');
  c.recovery.key = makeSecret(norm(key));
  save(c);
  logoutAll();
  fails = []; recoverFails = [];
  console.log('Portrox auth reset.');
  console.log('  username : admin');
  console.log('  password : admin');
  console.log('  recovery key (save this now, shown once):');
  console.log('    ' + key);
  console.log('Sign in and rotate immediately.');
}

if (process.argv[1] && process.argv[1].endsWith('auth-store.mjs')) {
  const cmd = process.argv[2];
  if (cmd === 'reset') cliReset();
  else if (cmd === 'status') console.log(JSON.stringify(publicState(), null, 2));
  else console.log('usage: node packages/cli/auth-store.mjs <reset|status>');
}
