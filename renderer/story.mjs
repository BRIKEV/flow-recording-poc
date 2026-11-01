// POC renderer: turns a recording (.json spans) into the story view a reviewer reads.
// Usage: node renderer/story.mjs <recording.json>
import { readFileSync } from 'node:fs';

const spans = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const children = new Map();
for (const s of spans) children.set(s.parentSpanId, [...(children.get(s.parentSpanId) ?? []), s]);
const root = spans.find((s) => s.scope === 'flow-recording' && !spans.some((p) => p.spanId === s.parentSpanId));

const sql = (s) => String(s.attributes['db.query.text'] ?? s.attributes['db.statement'] ?? '').replace(/\s+/g, ' ');

// Curation rules: spans that are true but say nothing to a reviewer
const isNoise = (s) =>
  /^(pg-pool\.connect|pg\.connect|middleware|router|request handler)/.test(s.name) ||
  /^(begin|commit)$|pg_database|pg_advisory|^truncate|^delete from/i.test(sql(s));

const shortSql = (q) =>
  q
    .replace(/ \(("[a-z_]+",? ?)+\) values .*/i, ' …')
    .replace(/select (.{0,40}).* from/i, 'select $1… from')
    .slice(0, 90);

function line(s) {
  const a = s.attributes;
  if (s.name.startsWith('pg.query')) return `db  ${/^(insert|update|delete)/i.test(sql(s)) ? '' : '(read) '}${shortSql(sql(s))}`;
  if (s.name.startsWith('fetch')) {
    const url = new URL(a['url.full']);
    return `→ ${url.host} ${url.pathname.split('/').pop()} ${a['http.response.status_code']}`;
  }
  if (s.kind === 1) {
    const method = a['http.method'] ?? a['http.request.method'];
    const route = a['http.route'] ?? a['url.path'] ?? a['http.target'];
    return `${method} ${route} → ${a['http.status_code'] ?? a['http.response.status_code']}`;
  }
  return null;
}

const out = [];
const walk = (id, depth) => {
  for (const s of children.get(id) ?? []) {
    if (isNoise(s)) {
      walk(s.spanId, depth);
      continue;
    }
    const text = line(s);
    if (text) out.push('  '.repeat(depth) + text);
    walk(s.spanId, text ? depth + 1 : depth);
  }
};

console.log(root.name);
walk(root.spanId, 1);
console.log(out.join('\n'));
