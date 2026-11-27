/**
 * File rules -> public.availability.
 *
 *   node scripts/sync-availability.mjs [--dry-run]
 *
 * D5: content files are canonical, so direction is always file -> DB.
 *
 * CORRECTION: the first version compared JSON.stringify(file) with
 * JSON.stringify(read-back) and reported weekly=false on correct data. jsonb
 * normalises object key order (shorter keys first, then bytewise), so key order
 * is NOT a semantic difference. Comparison is now canonical and recursive, and
 * a mismatch prints both sides instead of a bare boolean.
 */
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { loadConfig, accessToken } from '../packages/cli/config-store.mjs';
import * as M from '../packages/cli/supabase-mgmt.mjs';
import { loadRules, validateRules, describe } from '../packages/core/availability.mjs';

const DRY = process.argv.includes('--dry-run');
const c = loadConfig();
const ref = c.supabase.default_project_ref;
if (!ref || !c.supabase.access_token) { console.log('NOTE no project/token - skipping availability sync'); process.exit(0); }
const T = () => accessToken();
const q = (sql, ro) => M.runQuery(T(), ref, sql, ro ? { read_only: true } : undefined);

let bad = 0;
const ok = m => console.log('OK   ' + m);
const fail = m => { bad++; console.log('FAIL ' + m); };
const note = m => console.log('NOTE ' + m);

const lit = s => {
  const v = String(s);
  if (v.includes('$px$')) throw new Error('payload contains the dollar-quote tag');
  return '$px$' + v + '$px$';
};

/** Order-insensitive on object keys, order-sensitive on arrays. */
const canon = v => {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
};

const sites = readdirSync('sites').filter(d => existsSync('sites/' + d + '/site.json'));
if (sites.length === 0) { console.log('NOTE no sites'); process.exit(0); }

for (const id of sites) {
  let rules;
  try { rules = loadRules(id); }
  catch (e) { fail(id + ': ' + e.message); continue; }
  const problems = validateRules(rules);
  if (problems.length) { fail(id + ': ' + problems.join('; ')); continue; }

  const cfg = JSON.parse(readFileSync('sites/' + id + '/site.json', 'utf8'));
  const paid = Boolean(cfg && cfg.flags && cfg.flags.paid_booking);

  let registered = false;
  try {
    const r = await q('select count(*)::int as n from public.sites where id = ' + lit(id), true);
    registered = Number(r && r[0] && r[0].n) > 0;
  } catch (e) { fail(id + ': cannot read sites: ' + e.message); continue; }
  if (!registered) { note(id + ': not registered in the DB yet - register + publish first'); continue; }

  console.log('site ' + id + ' | ' + describe(rules) + ' | paid_booking=' + paid);
  if (DRY) { ok(id + ': rules valid (dry run, nothing written)'); continue; }

  const sql =
    'insert into public.availability (site_id, timezone, duration_minutes, weekly, paid_booking) values ('
    + lit(id) + ', ' + lit(rules.timezone) + ', ' + Number(rules.duration_minutes) + ', '
    + lit(JSON.stringify(rules.weekly)) + '::jsonb, ' + (paid ? 'true' : 'false') + ') '
    + 'on conflict (site_id) do update set timezone = excluded.timezone, '
    + 'duration_minutes = excluded.duration_minutes, weekly = excluded.weekly, '
    + 'paid_booking = excluded.paid_booking;';
  try { await q(sql); } catch (e) { fail(id + ': upsert failed: ' + e.message); continue; }

  try {
    const r = await q('select timezone, duration_minutes, weekly, paid_booking from public.availability where site_id = ' + lit(id), true);
    const row = r && r[0];
    if (!row) { fail(id + ': no row after upsert'); continue; }
    const weekly = typeof row.weekly === 'string' ? JSON.parse(row.weekly) : row.weekly;
    const checks = [
      ['timezone', row.timezone === rules.timezone],
      ['duration_minutes', Number(row.duration_minutes) === Number(rules.duration_minutes)],
      ['weekly', canon(weekly) === canon(rules.weekly)],
      ['paid_booking', Boolean(row.paid_booking) === paid]
    ];
    const drifted = checks.filter(([, good]) => !good).map(([k]) => k);
    if (drifted.length === 0) {
      ok(id + ': table matches the file semantically (' + weekly.length + ' rules, jsonb key order ignored)');
    } else {
      fail(id + ': read-back differs in ' + drifted.join(', '));
      if (drifted.includes('weekly')) {
        console.log('     file : ' + canon(rules.weekly));
        console.log('     table: ' + canon(weekly));
      }
    }
  } catch (e) { fail(id + ': read-back failed: ' + e.message); }
}

console.log(bad === 0 ? 'AVAILABILITY SYNC OK' : 'AVAILABILITY SYNC BAD=' + bad);
process.exit(bad === 0 ? 0 : 1);
