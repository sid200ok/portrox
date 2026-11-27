/**
 * The acceptance ledger must be internally consistent.
 *
 *   node scripts/verify-acceptance.mjs
 *
 * WHY THIS EXISTS: a section-tick helper flipped 19 Studio boxes and a sign-off
 * was written at a commit, with no browser opened and 30 required boxes still
 * open. The ledger is the only artefact that says "a human looked at this", so a
 * false entry disarms the last gate. The helper automated RECORDING acceptance
 * without automating its PRECONDITIONS.
 *
 * WHAT IT CANNOT DO: prove a human actually performed a check. Only consistency
 * is machine-checkable. Truth is the operator's, and this gate says so out loud.
 *
 * FAILS when:
 *   - a sign-off exists while any non-OPTIONAL box is unticked
 *   - the signed commit is not the current HEAD (stale acceptance)
 *   - the sign-off line is partially filled
 * PASSES when unsigned, however many boxes are open: unsigned is honest.
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const F = 'docs/LAUNCH.md';
let bad = 0;
const ok = m => console.log('OK   ' + m);
const fail = m => { bad++; console.log('FAIL ' + m); };
const note = m => console.log('NOTE ' + m);

const src = readFileSync(F, 'utf8');
const lines = src.split('\n');
const open = [], done = [];
for (const l of lines) {
  const t = l.trim();
  if (t.startsWith('- [ ]')) (t.includes('OPTIONAL') ? note : open.push.bind(open))(t.slice(5).trim());
  else if (t.startsWith('- [x]')) done.push(t.slice(5).trim());
}
const optional = lines.filter(l => l.trim().startsWith('- [ ]') && l.includes('OPTIONAL')).length;
console.log('acceptance: ' + done.length + ' ticked, ' + open.length + ' required open, ' + optional + ' optional open');

const m = /^Current sign-off:(.*)$/m.exec(src);
if (!m) { fail('no "Current sign-off:" line found'); }
else {
  const v = m[1].trim();
  const blank = /^_+\s+commit\s+_+\s+date\s+_+$/.test(v);
  if (blank) {
    ok('unsigned - honest state, ' + open.length + ' required check(s) still to perform');
  } else {
    const full = /^(.+?)\s+commit\s+([0-9a-f]{7,40})\s+date\s+(\d{4}-\d{2}-\d{2})$/.exec(v);
    if (!full) fail('sign-off is partially filled or malformed: "' + v + '"');
    else {
      const who = full[1].trim(), sha = full[2], date = full[3];
      if (open.length > 0) fail('SIGNED with ' + open.length + ' required box(es) still open - revoke the sign-off');
      else ok('signed with every required box ticked');
      const head = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
      if (!head) fail('cannot read HEAD - is this a git checkout?');
      else if (!head.startsWith(sha) && !sha.startsWith(head)) fail('signed commit ' + sha + ' is not HEAD ' + head + ' - acceptance is stale, re-run and re-sign');
      else ok('signed commit matches HEAD (' + head + ')');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) fail('sign-off date is not a real date: ' + date);
      else if (Date.parse(date) > Date.now() + 86400000) fail('sign-off date is in the future: ' + date);
      else ok('sign-off date plausible (' + date + ', ' + who + ')');
    }
  }
}

note('this gate proves CONSISTENCY, not that a human performed the checks.');
note('section 8 (Studio rendering) can only be satisfied in a browser with the console open.');
console.log(bad === 0 ? '\nACCEPTANCE OK' : '\nACCEPTANCE BAD=' + bad);
process.exit(bad === 0 ? 0 : 1);
