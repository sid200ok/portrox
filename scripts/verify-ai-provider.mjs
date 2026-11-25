/**
 * Proves the whole provider flow against a LOCAL OpenAI-compatible mock, so the
 * gate needs no real API key and no network. Uses a sandbox PORTROX_HOME so your
 * real provider config is never touched.
 */
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const box = mkdtempSync(join(tmpdir(), 'px-ai-'));
process.env.PORTROX_HOME = box;
const AI = await import('../packages/cli/ai-provider.mjs');

// Generated at runtime: a literal test key is itself a secret-audit finding.
const KEY = 'px-mock-' + randomBytes(12).toString('hex');
const BADKEY = 'px-bad-' + randomBytes(12).toString('hex');

let bad = 0;
const ok = m => console.log('OK   ' + m);
const fail = m => { bad++; console.log('FAIL ' + m); };
const mustThrow = async (fn, re, label) => {
  try { await fn(); fail(label + ' did NOT refuse'); }
  catch (e) { re.test(e.message) ? ok(label + ' refused') : fail(label + ' wrong error: ' + e.message); }
};

let sawAuth = '', sawBody = null;
const srv = createServer((req, res) => {
  sawAuth = req.headers.authorization || '';
  let b = ''; req.on('data', c => b += c);
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url.endsWith('/models')) {
      if (sawAuth !== 'Bearer ' + KEY) { res.statusCode = 401; return res.end('{"error":{"message":"bad key"}}'); }
      return res.end(JSON.stringify({ data: [{ id: 'meta/llama-3.1-8b-instruct' }, { id: 'nvidia/nemotron-4-340b' }] }));
    }
    if (req.url.endsWith('/chat/completions')) {
      sawBody = JSON.parse(b || '{}');
      return res.end(JSON.stringify({ choices: [{ message: { content: 'ready' } }], usage: { total_tokens: 7 } }));
    }
    res.statusCode = 404; res.end('{}');
  });
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + srv.address().port + '/v1';

try {
  console.log('default base: ' + AI.DEFAULT_BASE);
  AI.DEFAULT_BASE === 'https://integrate.api.nvidia.com/v1' ? ok('NVIDIA is the default') : fail('wrong default base');
  AI.checkUrl('https://api.openai.com/v1') === 'https://api.openai.com/v1' ? ok('any https provider accepted') : fail('https provider rejected');

  await mustThrow(() => AI.checkUrl('http://example.com/v1'), /loopback/, 'plain http to a remote host');
  await mustThrow(() => AI.checkUrl('ftp://x/v1'), /http or https/, 'non-http scheme');
  await mustThrow(() => AI.checkUrl('not a url'), /invalid base URL/, 'malformed URL');
  await mustThrow(() => AI.validateKey(), /no API key/, 'validate without a key');

  AI.saveProvider({ base_url: base, api_key: BADKEY });
  await mustThrow(() => AI.validateKey(), /401/, 'invalid key rejected');

  const st = AI.saveProvider({ base_url: base, api_key: KEY });
  JSON.stringify(st).includes(KEY) === false ? ok('status never leaks the key') : fail('status leaked the key');
  st.fingerprint.length === 8 ? ok('fingerprint exposed instead') : fail('no fingerprint');

  const v = await AI.validateKey();
  v.count === 2 ? ok('key validated, 2 models loaded') : fail('model count ' + v.count);
  sawAuth === 'Bearer ' + KEY ? ok('Bearer auth sent') : fail('wrong auth header');

  await mustThrow(() => AI.selectModel('not-in-catalogue'), /catalogue/, 'model outside the catalogue');
  await mustThrow(() => AI.selectModel(v.model, { temperature: 9 }), /temperature/, 'out-of-range temperature');
  await mustThrow(() => AI.selectModel(v.model, { max_tokens: 0 }), /max_tokens/, 'out-of-range max_tokens');
  const sel = AI.selectModel(v.model, { temperature: 0.2, max_tokens: 64 });
  sel.params.temperature === 0.2 && sel.params.max_tokens === 64 ? ok('model and params stored') : fail('params not stored');

  const chat = await AI.testChat('say ready');
  chat.reply === 'ready' ? ok('chat test round trip') : fail('unexpected reply: ' + chat.reply);
  sawBody && sawBody.model === v.model && sawBody.stream === false ? ok('chat request uses the selected model, non-streaming') : fail('wrong chat payload');
  sawBody.temperature === 0.2 && sawBody.max_tokens === 64 ? ok('params forwarded to the provider') : fail('params not forwarded');

  await mustThrow(() => AI.setTasks(['not_a_task']), /unknown task/, 'unknown task id');
  const t = AI.setTasks(['draft_reply', 'intro_draft', 'draft_reply']);
  t.tasks.length === 2 ? ok('tasks deduplicated and allowlisted') : fail('task dedupe failed');
  AI.TASKS.length >= 10 ? ok(AI.TASKS.length + ' tasks in the catalogue') : fail('catalogue too small');

  await mustThrow(() => AI.clearProvider('nope'), /CLEAR/, 'clear without confirmation');
  AI.clearProvider('CLEAR');
  AI.hasKey() === false ? ok('provider cleared') : fail('key survived clear');
} catch (e) { fail('flow threw: ' + e.message); }
finally { srv.close(); rmSync(box, { recursive: true, force: true }); ok('sandbox removed'); }

console.log('\n' + (bad === 0 ? 'AI PROVIDER OK' : 'AI PROVIDER BAD=' + bad));
process.exit(bad === 0 ? 0 : 1);
