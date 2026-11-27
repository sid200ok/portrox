/**
 * Site availability rules - ONE implementation shared by the probes and the gate.
 *
 * WHY THIS EXISTS: every booking probe used to invent a slot with setUTCHours().
 * The DB audit booked 2027-05-16T09:00Z, which is Sunday 14:30 Asia/Kolkata -
 * outside every rule - and the RPC accepted it. Probes must derive slots from
 * the same rules the SQL enforces, or they prove nothing.
 *
 * HARD RULE R1: never use host local time. The host may sit on any offset
 * (it is currently Asia/Amman, +03). The site timezone is the only authority.
 *
 * Semantics, identical to public.portrox_book:
 *   - a slot must start on the duration grid measured from the window's "from"
 *   - the whole slot must end at or before the window's "to"
 *   - seconds must be zero
 *   - day names are compared on their first three letters, case-insensitive
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const toMin = s => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
};

/** Milliseconds that tz is ahead of UTC at the instant ts. */
function offsetMs(ts, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const p = {};
  for (const part of dtf.formatToParts(new Date(ts))) {
    if (part.type !== 'literal') p[part.type] = part.value;
  }
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day),
                         Number(p.hour) % 24, Number(p.minute), Number(p.second));
  return asUtc - ts;
}

/** Wall-clock components of an instant, in tz. */
function localParts(ts, tz) {
  const shifted = new Date(ts + offsetMs(ts, tz));
  return {
    y: shifted.getUTCFullYear(), mo: shifted.getUTCMonth() + 1, d: shifted.getUTCDate(),
    h: shifted.getUTCHours(), mi: shifted.getUTCMinutes(), s: shifted.getUTCSeconds(),
    dow: shifted.getUTCDay(), mins: shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
  };
}

/** Wall clock in tz -> UTC epoch. Two passes settle any fixed or DST offset. */
function zonedToUtc(y, mo, d, h, mi, tz) {
  const naive = Date.UTC(y, mo - 1, d, h, mi, 0);
  let ts = naive - offsetMs(naive, tz);
  ts = naive - offsetMs(ts, tz);
  return ts;
}

/** Read and validate sites/<id>/data/availability.json. Throws on a bad file. */
export function loadRules(siteId, repoRoot = process.cwd()) {
  const p = join(repoRoot, 'sites', siteId, 'data', 'availability.json');
  if (!existsSync(p)) throw new Error('availability.json missing: ' + p);
  const rules = JSON.parse(readFileSync(p, 'utf8'));
  const problems = validateRules(rules);
  if (problems.length) throw new Error('invalid availability.json: ' + problems.join('; '));
  return rules;
}

export function validateRules(rules) {
  const bad = [];
  if (!rules || typeof rules !== 'object') return ['not an object'];
  try { new Intl.DateTimeFormat('en-US', { timeZone: rules.timezone }); }
  catch { bad.push('unknown timezone ' + rules.timezone); }
  const d = rules.duration_minutes;
  if (!Number.isInteger(d) || d < 5 || d > 240) bad.push('duration_minutes must be an integer 5..240');
  if (!Array.isArray(rules.weekly) || rules.weekly.length === 0) bad.push('weekly must be a non-empty array');
  else for (const r of rules.weekly) {
    const day = String((r && r.day) || '').slice(0, 3).toLowerCase();
    if (!DOW.includes(day)) bad.push('bad day ' + (r && r.day));
    const f = toMin(r && r.from), t = toMin(r && r.to);
    if (f === null || t === null) bad.push('bad window ' + JSON.stringify(r));
    else if (t <= f) bad.push('window ends before it starts ' + JSON.stringify(r));
    else if (t - f < (Number.isInteger(d) ? d : 30)) bad.push('window shorter than one slot ' + JSON.stringify(r));
  }
  return bad;
}

/** 'OK' | 'off_grid' | 'outside_availability' for an ISO instant. */
export function verdict(iso, rules) {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return 'outside_availability';
  const L = localParts(ts, rules.timezone);
  if (L.s !== 0) return 'off_grid';
  const dur = rules.duration_minutes;
  let inWindow = false;
  for (const r of rules.weekly) {
    if (String(r.day).slice(0, 3).toLowerCase() !== DOW[L.dow]) continue;
    const f = toMin(r.from), t = toMin(r.to);
    if (L.mins < f || L.mins >= t) continue;
    inWindow = true;
    if (L.mins + dur <= t && ((L.mins - f) % dur) === 0) return 'OK';
  }
  return inWindow ? 'off_grid' : 'outside_availability';
}

/**
 * First valid grid slot at or after ms, as an ISO string.
 * Mutates nothing. Searches up to 500 days, then throws rather than lying.
 */
export function snapSlot(ms, rules) {
  const tz = rules.timezone, dur = rules.duration_minutes;
  const start = localParts(ms, tz);
  const weekly = rules.weekly
    .map(r => ({ day: String(r.day).slice(0, 3).toLowerCase(), f: toMin(r.from), t: toMin(r.to) }))
    .sort((a, b) => a.f - b.f);
  for (let d = 0; d < 500; d++) {
    const day = new Date(Date.UTC(start.y, start.mo - 1, start.d + d));
    const dow = DOW[day.getUTCDay()];
    for (const r of weekly) {
      if (r.day !== dow) continue;
      for (let k = r.f; k + dur <= r.t; k += dur) {
        const ts = zonedToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(),
                              Math.floor(k / 60), k % 60, tz);
        if (ts >= ms) return new Date(ts).toISOString();
      }
    }
  }
  throw new Error('no available slot within 500 days - check availability.json');
}

/** A valid slot daysAhead in the future. Probes use this, never setUTCHours. */
export function nextValidSlot(rules, { daysAhead = 45, from = Date.now() } = {}) {
  return snapSlot(from + daysAhead * 86400000, rules);
}

/** 'YYYY-MM-DD HH:MM <tz>' - the string the inbox must show. */
export function slotText(iso, rules) {
  const L = localParts(Date.parse(iso), rules.timezone);
  const p2 = n => String(n).padStart(2, '0');
  return `${L.y}-${p2(L.mo)}-${p2(L.d)} ${p2(L.h)}:${p2(L.mi)} ${rules.timezone}`;
}

/** An instant that is deliberately outside every rule: Sunday 03:00 local. */
export function sundayThreeAm(rules, { daysAhead = 14, from = Date.now() } = {}) {
  const start = localParts(from + daysAhead * 86400000, rules.timezone);
  for (let d = 0; d < 40; d++) {
    const day = new Date(Date.UTC(start.y, start.mo - 1, start.d + d));
    if (day.getUTCDay() !== 0) continue;
    return new Date(zonedToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(),
                               3, 0, rules.timezone)).toISOString();
  }
  throw new Error('no Sunday found');
}

export function describe(rules) {
  return rules.weekly.map(r => `${r.day} ${r.from}-${r.to}`).join(', ')
       + ` | ${rules.timezone} | ${rules.duration_minutes} min`;
}
