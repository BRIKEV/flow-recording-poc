// What every OTel span gives us, whatever library produced it: its kind, its db statement,
// whether it is a db call, log severities, and the spans as a tree in a stable order.
// The other render files build on these.

export const KIND = ['internal', 'server', 'client', 'producer', 'consumer'];
export const [SERVER, CLIENT, PRODUCER, CONSUMER] = [1, 2, 3, 4];

export const sql = (s) => String(s.attributes['db.query.text'] ?? s.attributes['db.statement'] ?? '').replace(/\s+/g, ' ').trim();

// Siblings in the order the code started them (recorded by our span processor). Start
// timestamps can't be used: they have millisecond precision, so spans tie and swap.
const ordered = (siblings) => [...siblings].sort((a, b) => a.order - b.order);

export function tree(spans) {
  const ids = new Set(spans.map((s) => s.spanId));
  const root = spans.find((s) => s.scope === 'flow-recording' && !ids.has(s.parentSpanId));
  const children = new Map();
  for (const s of spans) if (s !== root) children.set(s.parentSpanId, [...(children.get(s.parentSpanId) ?? []), s]);
  return { root, kids: (s) => ordered(children.get(s.spanId) ?? []) };
}

export const isDb = (s) => s.attributes['db.system.name'] !== undefined || s.attributes['db.system'] !== undefined;

// OTel severity numbers: 1 trace, 5 debug, 9 info, 13 warn, 17 error, 21 fatal.
export const SEVERITY = { trace: 1, debug: 5, info: 9, warn: 13, error: 17, fatal: 21 };
