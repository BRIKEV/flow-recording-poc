// Payloads (request, response, message and log fields) as a reviewer reads them: short,
// on one line. `{a: 1, b: "x", … +3}`.

export const cut = (str, n) => (str.length > n ? str.slice(0, n - 1) + '…' : str);

// Raw SQL tokens ($1, now(), default) shown verbatim
export class Verbatim {
  constructor(text) { this.text = text; }
}

// Payloads as a reviewer reads them, kept short: at most 4 fields at the top, 3 one level
// down, {…} below that; strings cut at 30; arrays show their first item and how many more.
const FIELDS = [4, 3];
export function value(v, depth = 0) {
  if (v instanceof Verbatim) return v.text;
  if (typeof v === 'string') return JSON.stringify(cut(v, 30));
  if (v === null || typeof v !== 'object') return String(v);
  if (Array.isArray(v)) return v.length ? `[${value(v[0], depth)}${v.length > 1 ? `, … +${v.length - 1}` : ''}]` : '[]';
  const entries = Object.entries(v);
  if (!entries.length) return '{}';
  if (depth >= FIELDS.length) return '{…}';
  const shown = entries.slice(0, FIELDS[depth]).map(([k, x]) => `${k}: ${value(x, depth + 1)}`);
  return `{${shown.join(', ')}${entries.length > FIELDS[depth] ? `, … +${entries.length - FIELDS[depth]}` : ''}}`;
}

export function payload(body) {
  if (body === undefined || body === '') return '';
  try {
    return value(JSON.parse(body));
  } catch {
    if (/^[\w.%-]+=[^&]*(&[\w.%-]+=[^&]*)*$/.test(body)) return value(Object.fromEntries(new URLSearchParams(body)));
    return JSON.stringify(cut(body, 60));
  }
}
