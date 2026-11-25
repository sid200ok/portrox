/**
 * Proves task execution against a local mock: assigned-only, deterministic
 * prompts, and that running a task NEVER writes anything.
 */
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const box = mkdtempSync(join(tmpdir(), 'px-task-'));
process.env.PORTROX_HOME = box;
const AI = await import('../packages/cli/ai-provider.mjs');
const T = await import('../packages/cli/ai-tasks.mjs');
const KEY = 'px-mock-' + randomBytes(12).toString('hex');

let bad = 0;
const ok = m => console.log('OK   ' + m);
const fail = m => { bad++; console.log('FAIL ' + m); };
const must = async (fn, re, label) => {
  const rx = re instanceof RegExp ? re : new RegExp(String(re));
  try { await fn(); fail(label + ' did NOT refuse'); }
  catch (e) { rx.test(e.message) ? ok(label + ' refused') : fail(label + ' wrong error: ' + e.message); }
};
let lastBody = null;
const srv = createServer((req, res) => {
  let b = ''; req.on('data', c => b += c);
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'mock/model-1' }] }));
    lastBody = JSON.parse(b || '{}');
    res.end(JSON.stringify({ choices: [{ message: { content: 'DRAFT: thanks for reaching out.' } }] }));
  });
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));

try {
  Object.keys(T.BUILDERS).length === AI.TASKS.length ? ok('a builder for every catalogued task') : fail('builder/catalogue mismatch');
  for (const t of AI.TASKS) {
    const a = T.buildPrompt(t.id, { name: 'A', message: 'hello', owner: 'O', title: 'S', filename: 'f.png', language: 'Hindi', text: 'x', starts_at: '2027-01-01T10:00Z', duration_minutes: 30, timezone: 'Asia/Kolkata', skills: 'Python', location: 'IN', headline: 'Dev', facts: 'none', about: 'x', context: 'y', email: 'a@b.c' });
    typeof a === 'string' && a.length > 10 ? null : fail(t.id + ' produced no prompt');
    a === T.buildPrompt(t.id, { name: 'A', message: 'hello', owner: 'O', title: 'S', filename: 'f.png', language: 'Hindi', text: 'x', starts_at: '2027-01-01T10:00Z', duration_minutes: 30, timezone: 'Asia/Kolkata', skills: 'Python', location: 'IN', headline: 'Dev', facts: 'none', about: 'x', context: 'y', email: 'a@b.c' }) ? null : fail(t.id + ' prompt is not deterministic');
  }
  ok('all 11 prompts build deterministically');
  await must(() => T.buildPrompt('nope'), /unknown task/, 'unknown task');
  await must(() => T.run('draft_reply', {}), /not assigned/, 'unassigned task');

  AI.saveProvider({ base_url: 'http://127.0.0.1:' + srv.address().port + '/v1', api_key: KEY });
  await AI.validateKey();
  AI.setTasks(['draft_reply']);
  await must(() => T.run('intro_draft', {}), /not assigned/, 'a different unassigned task');

  const before = readdirSync(box).sort().join(',');
  const r = await T.run('draft_reply', { name: 'Priya', email: 'p@example.test', message: 'Need a VoIP audit', owner: 'Siddhant' });
  r.draft.startsWith('DRAFT:') ? ok('draft returned') : fail('unexpected draft: ' + r.draft);
  r.writeback === false ? ok('writeback is explicitly false') : fail('writeback not false');
  lastBody.messages[0].role === 'system' ? ok('system instruction sent') : fail('no system message');
  /Never promise availability/.test(lastBody.messages[0].content) ? ok('guardrail in the system prompt') : fail('guardrail missing');
  /Priya/.test(lastBody.messages[1].content) ? ok('payload reached the prompt') : fail('payload missing');
  AI.status().last_test === null ? ok('running a task did NOT record a connectivity test') : fail('task polluted last_test');
  readdirSync(box).sort().join(',') === before ? ok('no new files written by a task') : fail('a task wrote to disk');
} catch (e) { fail('flow threw: ' + e.message); }
finally { srv.close(); rmSync(box, { recursive: true, force: true }); ok('sandbox removed'); }
console.log('\n' + (bad === 0 ? 'AI TASKS OK' : 'AI TASKS BAD=' + bad));
process.exit(bad === 0 ? 0 : 1);
