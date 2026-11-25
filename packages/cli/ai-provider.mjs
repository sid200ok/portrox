/**
 * One OpenAI-compatible client, configurable base URL. NVIDIA NIM is the default
 * because integrate.api.nvidia.com/v1 implements the OpenAI Chat Completions API
 * and exposes /v1/models. The same client therefore serves OpenAI, Groq,
 * Together, OpenRouter, vLLM, Ollama and self-hosted NIM without new code.
 *
 * The key is stored 0600 and NEVER returned to the browser - only a fingerprint.
 * Every task is DRAFT-ONLY and human-approved: nothing auto-sends, auto-publishes
 * or auto-charges.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

const HOME = process.env.PORTROX_HOME || join(homedir(), '.portrox');
const P = join(HOME, 'ai-provider.json');
export const DEFAULT_BASE = 'https://integrate.api.nvidia.com/v1';
export class AIError extends Error { constructor(m, c) { super(m); this.code = c || 400; } }

export const TASKS = [
  { id: 'draft_reply', label: 'Draft a reply to a new lead', group: 'Inbox' },
  { id: 'triage_suggest', label: 'Suggest a triage state', group: 'Inbox' },
  { id: 'summarize_lead', label: 'Summarise a long message', group: 'Inbox' },
  { id: 'spam_score', label: 'Flag likely spam (never auto-delete)', group: 'Inbox' },
  { id: 'booking_confirm_draft', label: 'Draft booking confirmation text', group: 'Booking' },
  { id: 'booking_reminder_draft', label: 'Draft a booking reminder', group: 'Booking' },
  { id: 'intro_draft', label: 'Propose homepage intro prose', group: 'Content' },
  { id: 'service_copy', label: 'Propose service descriptions', group: 'Content' },
  { id: 'seo_description', label: 'Propose meta descriptions', group: 'Content' },
  { id: 'alt_text', label: 'Propose alt text for media', group: 'Content' },
  { id: 'translate', label: 'Translate content into a draft', group: 'Content' }
];
const TASK_IDS = TASKS.map(t => t.id);
export const PARAM_LIMITS = { temperature: [0, 2], top_p: [0, 1], max_tokens: [1, 8192] };

function read() { try { return JSON.parse(readFileSync(P, 'utf8')); } catch { return {}; } }
function write(j) {
  mkdirSync(HOME, { recursive: true, mode: 0o700 });
  writeFileSync(P, JSON.stringify(j, null, 2) + '\n', { mode: 0o600 });
  chmodSync(P, 0o600);
}
const fp = k => k ? createHash('sha256').update(k).digest('hex').slice(0, 8) : '';

export function baseUrl() { return read().base_url || DEFAULT_BASE; }
export function hasKey() { const k = read().api_key; return typeof k === 'string' && k.length >= 8; }
export function status() {
  const j = read();
  return {
    base_url: j.base_url || DEFAULT_BASE, configured: Boolean(j.api_key),
    fingerprint: fp(j.api_key), validated_at: j.validated_at || null,
    model_count: Array.isArray(j.models) ? j.models.length : 0,
    model: j.model || '', params: j.params || { temperature: 0.7, top_p: 0.95, max_tokens: 512 },
    tasks: Array.isArray(j.tasks) ? j.tasks : [], last_test: j.last_test || null
  };
}

/** https anywhere; http ONLY for loopback, so a local NIM works but plaintext
 *  to a remote host cannot leak the key. */
export function checkUrl(u) {
  let x; try { x = new URL(String(u || '')); } catch { throw new AIError('invalid base URL'); }
  if (!/^https?:$/.test(x.protocol)) throw new AIError('base URL must be http or https');
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(x.hostname);
  if (x.protocol === 'http:' && !local) throw new AIError('plain http is only allowed for loopback (local NIM); use https');
  return x.toString().replace(/\/+$/, '');
}

export function saveProvider({ base_url, api_key }) {
  const j = read();
  const url = checkUrl(base_url || DEFAULT_BASE);
  if (api_key !== undefined) {
    const k = String(api_key || '').trim();
    if (k && k.length < 8) throw new AIError('API key looks too short');
    if (k) j.api_key = k; else delete j.api_key;
  }
  if (url !== j.base_url) { j.models = []; j.model = ''; j.validated_at = null; }
  j.base_url = url;
  write(j);
  return status();
}

async function call(path, { method = 'GET', body, timeout = 30000 } = {}) {
  const j = read();
  if (!j.api_key) throw new AIError('no API key - save one first', 409);
  const url = checkUrl(j.base_url || DEFAULT_BASE) + path;
  const r = await fetch(url, {
    method,
    headers: { Authorization: 'Bearer ' + j.api_key, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout)
  });
  const txt = await r.text();
  let data = null; try { data = JSON.parse(txt); } catch {}
  if (!r.ok) {
    const msg = (data && (data.error?.message || data.message || data.detail)) || txt.slice(0, 160);
    throw new AIError('provider HTTP ' + r.status + ': ' + msg, r.status === 401 || r.status === 403 ? 401 : 502);
  }
  return data;
}

export async function validateKey() {
  const d = await call('/models');
  const list = Array.isArray(d?.data) ? d.data : (Array.isArray(d) ? d : []);
  const models = list.map(m => String(m?.id || m?.name || '')).filter(Boolean).sort();
  if (models.length === 0) throw new AIError('key accepted but /models returned no models', 502);
  const j = read();
  j.models = models; j.validated_at = new Date().toISOString();
  if (!j.model || !models.includes(j.model)) j.model = models[0];
  write(j);
  return { ok: true, count: models.length, models, model: j.model };
}

export function models() { const j = read(); return Array.isArray(j.models) ? j.models : []; }

export function selectModel(model, params = {}) {
  const j = read();
  const m = String(model || '');
  if (!Array.isArray(j.models) || !j.models.includes(m)) throw new AIError('model not in the validated catalogue: ' + m);
  const p = { ...(j.params || { temperature: 0.7, top_p: 0.95, max_tokens: 512 }) };
  for (const [k, [lo, hi]] of Object.entries(PARAM_LIMITS)) {
    if (params[k] === undefined) continue;
    const v = Number(params[k]);
    if (!Number.isFinite(v) || v < lo || v > hi) throw new AIError(k + ' must be between ' + lo + ' and ' + hi);
    p[k] = k === 'max_tokens' ? Math.round(v) : v;
  }
  j.model = m; j.params = p; write(j);
  return status();
}

export async function testChat(prompt) {
  const j = read();
  if (!j.model) throw new AIError('select a model first', 409);
  const q = String(prompt || 'Reply with the single word: ready').slice(0, 2000);
  const t0 = Date.now();
  const d = await call('/chat/completions', {
    method: 'POST',
    body: { model: j.model, messages: [{ role: 'user', content: q }], ...(j.params || {}), stream: false }
  });
  const reply = d?.choices?.[0]?.message?.content ?? '';
  if (!String(reply).trim()) throw new AIError('model returned an empty reply', 502);
  const out = { ok: true, ms: Date.now() - t0, model: j.model, reply: String(reply).slice(0, 4000), usage: d?.usage || null };
  j.last_test = { at: new Date().toISOString(), ms: out.ms, model: j.model }; write(j);
  return out;
}

export function setTasks(ids) {
  const list = Array.isArray(ids) ? ids.map(String) : [];
  const bad = list.filter(x => !TASK_IDS.includes(x));
  if (bad.length) throw new AIError('unknown task(s): ' + bad.join(', '));
  const j = read(); j.tasks = [...new Set(list)]; write(j);
  return { tasks: j.tasks, catalogue: TASKS };
}

export function clearProvider(confirm) {
  if (confirm !== 'CLEAR') throw new AIError('confirmation must equal CLEAR', 403);
  if (existsSync(P)) write({});
  return { cleared: true };
}
