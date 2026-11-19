/**
 * SQL comment stripper for transport.
 *
 * HONEST STATUS: this was introduced on a hypothesis that was later DISPROVEN.
 * A direct probe showed the Supabase query endpoint handles semicolons inside
 * comments, quoted identifiers inside comments, and semicolons inside DO
 * comments correctly. The real cause of the earlier 42601/42809 failures was
 * never isolated (three changes landed together). This module is kept as
 * defensive normalisation only. It is NOT a proven fix for anything.
 *
 * CRITICAL CORRECTNESS RULE: a dollar-quoted STRING LITERAL is data, not code.
 *   insert into t values ($$keep -- this$$)   MUST survive byte-identical.
 * Only a DO/AS body is PL/pgSQL, where -- really is a comment. Recursing into
 * every dollar quote silently truncated string data. That bug is fixed here.
 *
 * Real lexer: single quotes with '' escape, quoted identifiers, nested block
 * comments, dollar quotes with body-vs-literal discrimination. Pure ASCII.
 */

/** Word immediately before position i, lowercased. Empty if punctuation. */
function prevWord(s, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(s[j])) j--;
  const end = j + 1;
  while (j >= 0 && /[A-Za-z_]/.test(s[j])) j--;
  return s.slice(j + 1, end).toLowerCase();
}

export function stripSqlComments(sql) {
  const s = String(sql == null ? '' : sql);
  const n = s.length;
  let out = '';
  let i = 0;
  while (i < n) {
    const c = s[i], d = s[i + 1];
    if (c === '-' && d === '-') {
      while (i < n && s[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      let depth = 1; i += 2;
      while (i < n && depth > 0) {
        if (s[i] === '/' && s[i + 1] === '*') { depth++; i += 2; }
        else if (s[i] === '*' && s[i + 1] === '/') { depth--; i += 2; }
        else i++;
      }
      out += ' ';
      continue;
    }
    if (c === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(s.slice(i));
      if (m) {
        const tag = m[0];
        const end = s.indexOf(tag, i + tag.length);
        if (end === -1) { out += s.slice(i); break; }
        const body = s.slice(i + tag.length, end);
        const w = prevWord(s, i);
        // DO $tag$ ... $tag$  and  AS $tag$ ... $tag$  are code bodies.
        // Anything else is a string literal and MUST be preserved verbatim.
        const isBody = (w === 'do' || w === 'as');
        out += tag + (isBody ? stripSqlComments(body) : body) + tag;
        i = end + tag.length;
        continue;
      }
    }
    if (c === "'") {
      out += c; i++;
      while (i < n) {
        if (s[i] === "'" && s[i + 1] === "'") { out += "''"; i += 2; continue; }
        out += s[i];
        if (s[i] === "'") { i++; break; }
        i++;
      }
      continue;
    }
    if (c === '"') {
      out += c; i++;
      while (i < n) { out += s[i]; if (s[i] === '"') { i++; break; } i++; }
      continue;
    }
    out += c; i++;
  }
  return out;
}

export function sanitizeForTransport(sql) {
  return stripSqlComments(sql)
    .split('\n').map(l => l.replace(/\s+$/, ''))
    .filter((l, idx, arr) => !(l === '' && arr[idx - 1] === ''))
    .join('\n').trim();
}
