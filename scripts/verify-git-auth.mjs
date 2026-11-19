/**
 * Reports which git auth methods actually work for the site repo.
 *   node scripts/verify-git-auth.mjs [owner/repo]
 * Read-only: uses git ls-remote. Never prompts, never pushes.
 */
import { describeGitAuth, resolveGitAuth } from '../packages/cli/git-auth.mjs';
import { loadConfig } from '../packages/cli/config-store.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const siteId = 'sid200ok.github.io';
let full = process.argv[2];
if (!full) {
  const p = join(process.cwd(), 'sites', siteId, 'site.json');
  const cfg = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
  full = (cfg.pages && cfg.pages.repo) || ('sid200ok/' + siteId);
}
console.log('repo: ' + full);
const rows = describeGitAuth(full);
for (const r of rows) {
  console.log((r.ok ? 'OK   ' : 'FAIL ') + r.method.padEnd(6) + ' ' + r.url + (r.error ? '  :: ' + r.error : ''));
}
const c = loadConfig();
console.log('stored PAT: ' + (c.github && c.github.token ? 'yes' : 'no') + ' | gh login: ' + (c.github.login || '(none)'));
try {
  const a = resolveGitAuth(full);
  console.log('\nCHOSEN ' + a.method + ' -> ' + a.url);
  console.log('GIT AUTH OK');
  process.exit(0);
} catch (e) {
  console.log('\nFAIL ' + e.message);
  console.log('ACTION: run `gh auth login` (or `gh auth refresh -s repo,workflow`), or set up an SSH key, or store a PAT in Studio -> Settings -> GitHub ops.');
  process.exit(1);
}
