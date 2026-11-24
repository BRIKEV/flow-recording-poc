// SQL, read as data: `insert into orders (item) values ($1)` → `insert orders {item: "book"}`.
// Standard SQL only, no ORM knowledge; anything it doesn't recognise is shown as it is.
import { Verbatim, value } from './payload.mjs';

// Split on a separator at depth 0, outside quotes
function split(str, sep = ',') {
  const parts = [];
  let depth = 0, quote = null, cur = '';
  for (const ch of str) {
    if (quote) { if (ch === quote) quote = null; }
    else if (ch === "'" || ch === '"') quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === sep && depth === 0) { parts.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}
const ident = (x) => x.replace(/"/g, '');
const literal = (x) => {
  if (/^'.*'$/s.test(x)) return x.slice(1, -1).replace(/''/g, "'");
  if (/^-?\d+(\.\d+)?$/.test(x)) return Number(x);
  if (/^(null|true|false)$/i.test(x)) return JSON.parse(x.toLowerCase());
  return new Verbatim(x);
};
const record = (cols, vals) => value(Object.fromEntries(cols.map((c, i) => [c, vals[i]])));
// Drop table aliases ("n0".id, t.id → id) and identifier quotes, never inside a string
// literal: '12:00:00.000Z' stays as it is. A number (0.5) is not an alias.
const expr = (x) =>
  x
    .split(/('(?:[^']|'')*')/)
    .map((part, i) => (i % 2 ? part : part.replace(/(?:"\w+"|\b[a-z_]\w*)\.(?=["a-z_*])/gi, '').replace(/"/g, '')))
    .join('');
// Aggregates in a select list, which say what the read is for: coalesce(sum(t.amount), 0) → sum(amount)
const aggregates = (list) => [...list.matchAll(/\b(count|sum|avg|min|max)\s*\(([^()]*)\)/gi)].map((m) => `${m[1].toLowerCase()}(${expr(m[2]).trim()})`);

export function sqlText(q) {
  let m;
  if ((m = q.match(/^insert into\s+(\S+)\s*\(([^)]*)\)\s*values\s*(.*?)(\s+(on conflict|returning)\b.*)?$/is))) {
    const cols = split(m[2]).map(ident);
    const rows = split(m[3]).map((t) => split(t.replace(/^\(|\)$/g, '')).map(literal));
    const all = rows.map((r) => record(cols, r)).join(', ');
    if (rows.length === 1 || all.length <= 100) return `insert ${ident(m[1])} ${all}`;
    return `insert ${ident(m[1])} ${record(cols, rows[0])}, … +${rows.length - 1} rows`;
  }
  if ((m = q.match(/^update\s+(\S+)(?:\s+as\s+\S+)?\s+set\s+(.*?)(?:\s+where\s+(.*?))?(\s+returning\b.*)?$/is))) {
    const sets = split(m[2]).map((a) => a.split(/\s*=\s*/));
    return `update ${ident(m[1])} ${record(sets.map(([c]) => expr(c)), sets.map(([, v]) => literal(v)))}${m[3] ? ` where ${expr(m[3])}` : ''}`;
  }
  if ((m = q.match(/^delete from\s+(\S+)(?:\s+as\s+\S+)?(?:\s+where\s+(.*?))?(\s+returning\b.*)?$/is))) {
    return `delete ${ident(m[1])}${m[2] ? ` where ${expr(m[2])}` : ''}`;
  }
  if ((m = q.match(/^select\b(.*?)\bfrom\s+("?[\w.]+"?)(.*)$/is))) {
    const where = m[3].match(/\bwhere\s+(.*?)(\s+(order by|group by|limit|offset|for update)\b.*)?$/is);
    const agg = aggregates(m[1]);
    return `select ${ident(m[2])}${agg.length ? ` ${agg.join(', ')}` : ''}${where ? ` where ${expr(where[1])}` : ''}`;
  }
  return q;
}

// Bound parameters ($1, $2…) replaced by their values when the instrumentation records
// them: db.query.parameter.<n> (stable semconv) or db.postgresql.values (pg's
// enhancedDatabaseReporting).
export function withValues(q, a) {
  const values = a['db.postgresql.values'] ?? Object.keys(a).filter((k) => k.startsWith('db.query.parameter.'))
    .sort((x, y) => Number(x.split('.').pop()) - Number(y.split('.').pop())).map((k) => a[k]);
  if (!Array.isArray(values) || !values.length) return q;
  const sqlLiteral = (v) => (v === null ? 'null' : /^-?\d+(\.\d+)?$/.test(String(v)) ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
  return q.replace(/\$(\d+)/g, (m, n) => (values[n - 1] === undefined ? m : sqlLiteral(values[n - 1])));
}
