/**
 * SQL comment stripper for transport.
 *
 * WHY: the Supabase SQL endpoints split statements naively on ';' and do not
 * fully respect comments or dollar quotes. A semicolon INSIDE a comment orphaned
 * the comment tail, which was then parsed as SQL:
 *   "-- ... (privilege granted; latent exposure)"  ->  42601 near ")"
 *   '-- ... "array_agg" is an aggregate function'  ->  42809 array_agg
 * Stripping comments before sending removes that entire failure class.
 *
 * This is a real lexer, not a regex: it respects single-quoted strings ('' escape),
 * double-quoted identifiers, dollar-quoted bodies (recursively), and nested
 * block comments. Pure ASCII.
 */
export function stripSqlComments(sql) {
  const s = String(sql == null ? '' : sql);
  const n = s.length;
  let out = '';
  let i = 0;
  while (i < n) {
    const c = s[i], d = s[i + 1];
    if (c === '-' && d === '-') {                 // line comment
      while (i < n && s[i] !== '\n') i++;
      continue;                                   // newline is emitted next pass
    }
    if (c === '/' && d === '*') {                 // nested block comment
      let depth = 1; i += 2;
      while (i < n && depth > 0) {
        if (s[i] === '/' && s[i + 1] === '*') { depth++; i += 2; }
        else if (s[i] === '*' && s[i + 1] === '/') { depth--; i += 2; }
        else i++;
      }
      out += ' ';
      continue;
    }
    if (c === '$') {                              // dollar-quoted body
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(s.slice(i));
      if (m) {
        const tag = m[0];
        const end = s.indexOf(tag, i + tag.length);
        if (end === -1) { out += s.slice(i); break; }
        const body = s.slice(i + tag.length, end);
        out += tag + stripSqlComments(body) + tag;  // recurse: PL/pgSQL comments too
        i = end + tag.length;
        continue;
      }
    }
    if (c === "'") {                              // single-quoted string
      out += c; i++;
      while (i < n) {
        if (s[i] === "'" && s[i + 1] === "'") { out += "''"; i += 2; continue; }
        out += s[i];
        if (s[i] === "'") { i++; break; }
        i++;
      }
      continue;
    }
    if (c === '"') {                              // quoted identifier
      out += c; i++;
      while (i < n) { out += s[i]; if (s[i] === '"') { i++; break; } i++; }
      continue;
    }
    out += c; i++;
  }
  return out;
}

/** Collapse blank runs left behind, keep statement text byte-identical otherwise. */
export function sanitizeForTransport(sql) {
  return stripSqlComments(sql).split('\n').map(l => l.replace(/\s+$/, '')).filter((l, idx, arr) => !(l === '' && arr[idx - 1] === '')).join('\n').trim();
}
