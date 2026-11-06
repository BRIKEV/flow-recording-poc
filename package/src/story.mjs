#!/usr/bin/env node
// flow-recording's renderer: turns recordings (.json spans) into what a reviewer reads.
//
// PUBLIC API (what the user touches):
//   CLI              flow-recording <recording.json | recordings dir> [--config flow.config.mjs]
//   flow.config.mjs  optional, in the app's root: curation rules (show / hide / flatten / rule),
//                    see "layer 3" below. Everything else in this file is internal.
//
// For each recording it writes <name>.raw.txt (every span, stable order) and
// <name>.story.txt (curated), and prints the stories. Without --config it loads
// ./flow.config.mjs when there is one.
//
// Curation knows no library. It works on what every OTel span has: kind, name,
// instrumentation scope and semantic-convention attributes. Three layers, last wins:
//   1. our defaults (below), 2. the hook phase, 3. the user's flow.config rules.
// Each rule answers with one action:
//   show     print the line
//   hide     drop the span and everything under it
//   flatten  drop the line, keep its children one level up
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const KIND = ['internal', 'server', 'client', 'producer', 'consumer'];
const [SERVER, CLIENT, PRODUCER, CONSUMER] = [1, 2, 3, 4];

// ---------- spans as a tree, in a stable order ----------

const sql = (s) => String(s.attributes['db.query.text'] ?? s.attributes['db.statement'] ?? '').replace(/\s+/g, ' ').trim();

// Siblings in the order the code started them (recorded by our span processor). Start
// timestamps can't be used: they have millisecond precision, so spans tie and swap.
const ordered = (siblings) => [...siblings].sort((a, b) => a.order - b.order);

function tree(spans) {
  const ids = new Set(spans.map((s) => s.spanId));
  const root = spans.find((s) => s.scope === 'flow-recording' && !ids.has(s.parentSpanId));
  const children = new Map();
  for (const s of spans) if (s !== root) children.set(s.parentSpanId, [...(children.get(s.parentSpanId) ?? []), s]);
  return { root, kids: (s) => ordered(children.get(s.spanId) ?? []) };
}

// ---------- matching ----------

// A matcher: { name?, kind?, scope?, attributes?: { key: value } }. Values are a
// string (exact) or a RegExp. `kind` is 'server' | 'client' | 'internal' | ….
const test = (expected, actual) =>
  expected instanceof RegExp ? actual !== undefined && expected.test(String(actual)) : expected === actual;
const matches = (m, s) =>
  (m.name === undefined || test(m.name, s.name)) &&
  (m.kind === undefined || test(m.kind, KIND[s.kind])) &&
  (m.scope === undefined || test(m.scope, s.scope)) &&
  Object.entries(m.attributes ?? {}).every(([k, v]) => test(v, s.attributes[k]));

// ---------- layer 1: our defaults ----------

const isDb = (s) => s.attributes['db.system.name'] !== undefined || s.attributes['db.system'] !== undefined;

const DEFAULTS = [
  // Plumbing: name resolution and sockets, under every connection
  (s) => /instrumentation-(dns|net)$/.test(s.scope) && 'hide',
  // A db span with no statement is a connection or pool checkout, not something the code asked for
  (s) => isDb(s) && !sql(s) && 'hide',
  // Transaction control is the same in every SQL engine
  (s) => isDb(s) && /^(begin|commit|rollback|start transaction|savepoint|release savepoint)\b/i.test(sql(s)) && 'hide',
  // Framework layers (middlewares, route handlers…) from the auto-instrumentations: keep what
  // happens inside them. The app's own internal spans are not touched.
  (s) => s.kind === 0 && s.scope.startsWith('@opentelemetry/instrumentation-') && 'flatten',
];

// A client call that reached a server span of ours (supertest → the app) is one step:
// show the server side.
const clientOfServer = (s, kids) => s.kind === CLIENT && kids.some((k) => k.kind === SERVER);

// ---------- layers 2 and 3 ----------
// Layer 3 is the user's flow.config.mjs (PUBLIC API):
//   export default {
//     show:    [matcher, …],   // force a line
//     hide:    [matcher, …],   // drop the span and everything under it
//     flatten: [matcher, …],   // drop the line, keep its children
//     rule:    (span) => 'show' | 'hide' | 'flatten' | undefined,   // escape hatch, wins
//   }

function decide(s, kids, config) {
  let action = 'show';
  for (const rule of DEFAULTS) action = rule(s) || action;
  if (clientOfServer(s, kids)) action = 'flatten';
  // Layer 2: spans from beforeEach/afterEach are setup, not behaviour
  if (s.attributes['flow.phase'] === 'hook') action = 'hide';
  // Layer 3: the user's rules win
  for (const a of ['show', 'hide', 'flatten']) if ((config[a] ?? []).some((m) => matches(m, s))) action = a;
  return config.rule?.(s) ?? action;
}

// ---------- what each span says ----------
// Each kept span becomes a message between two actors, decided by its OTel span kind,
// so it reads the same for HTTP, queues, gRPC or a db:
//   SERVER    caller → app     METHOD /path {body}      … then  caller ← app  status {body}
//   CONSUMER  broker ⇢ app     consume destination
//   CLIENT    actor → peer     METHOD /path {body}      … then  actor ← peer  status {body}
//   db        actor → db       insert / update / delete / select, as data
//   PRODUCER  actor ⇢ broker   publish destination
//   INTERNAL  the app's own spans: a step of the app
// The actor is `test` until something enters the app (a SERVER or CONSUMER span, or an
// app span called straight from the test); inside, it is the app (config.sut).

const cut = (str, n) => (str.length > n ? str.slice(0, n - 1) + '…' : str);

// Raw SQL tokens ($1, now(), default) shown verbatim
class Verbatim {
  constructor(text) { this.text = text; }
}

// Payloads as a reviewer reads them, kept short: at most 4 fields at the top, 3 one level
// down, {…} below that; strings cut at 30; arrays show their first item and how many more.
const FIELDS = [4, 3];
function value(v, depth = 0) {
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

function payload(body) {
  if (body === undefined || body === '') return '';
  try {
    return value(JSON.parse(body));
  } catch {
    if (/^[\w.%-]+=[^&]*(&[\w.%-]+=[^&]*)*$/.test(body)) return value(Object.fromEntries(new URLSearchParams(body)));
    return JSON.stringify(cut(body, 60));
  }
}

// --- SQL, read as data. Standard SQL only, no ORM knowledge; anything else is shown as is.

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
// Drop table aliases ("n0".id → id) and quotes
const expr = (x) => x.replace(/"\w+"\./g, '').replace(/\b\w+\d\./g, '').replace(/"/g, '');

function sqlText(q) {
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
  if ((m = q.match(/^select\b.*?\bfrom\s+("?[\w.]+"?)(.*)$/is))) {
    const where = m[2].match(/\bwhere\s+(.*?)(\s+(order by|group by|limit|offset|for update)\b.*)?$/is);
    return `select ${ident(m[1])}${where ? ` where ${expr(where[1])}` : ''}`;
  }
  return q;
}

// What a span says: { type, peer, text, result }. `inherited` carries the bodies of a
// flattened test client call to the server span it reached.
function describeSpan(s, inherited = {}) {
  const a = s.attributes;
  const status = a['http.response.status_code'] ?? a['http.status_code'] ?? a['rpc.grpc.status_code'];
  const response = payload(a['flow.response.body'] ?? inherited.response);
  const result = status !== undefined ? `${status}${status >= 400 ? ' ⚠' : ''}${response ? ` ${response}` : ''}` : '';
  const method = a['http.request.method'] ?? a['http.method'];
  const body = payload(a['flow.request.body'] ?? inherited.request);
  const withBody = (t) => `${t}${body ? ` ${body}` : ''}`;
  if (isDb(s) && sql(s)) return { type: 'call', peer: 'db', text: cut(sqlText(sql(s)), 120), result: '' };
  if (s.kind === SERVER) {
    const route = a['http.route'] ?? a['url.path'] ?? a['http.target'];
    return { type: 'enter', text: withBody(method ? `${method} ${route}` : s.name), result };
  }
  if (s.kind === CONSUMER) {
    return { type: 'consume', peer: a['messaging.system'] ?? 'queue', text: withBody(`consume ${a['messaging.destination.name'] ?? s.name}`), result: '' };
  }
  if (s.kind === PRODUCER) {
    return { type: 'publish', peer: a['messaging.system'] ?? 'queue', text: withBody(`publish ${a['messaging.destination.name'] ?? s.name}`), result: '' };
  }
  if (s.kind === CLIENT) {
    const url = a['url.full'] ?? a['http.url'];
    const peer = url ? new URL(url).host : a['server.address'] ?? a['rpc.service'] ?? s.name;
    const text = method && url ? `${method} ${new URL(url).pathname}` : s.name;
    return { type: 'call', peer, text: withBody(text), result };
  }
  return { type: 'step', text: s.name, result: '' };
}

// ---------- outputs ----------

function raw(spans) {
  const { root, kids } = tree(spans);
  const out = [];
  const walk = (s, depth) => {
    const a = s.attributes;
    const parts = [`[${KIND[s.kind]}] ${s.name}`];
    const url = a['url.full'] ?? a['url.path'];
    if (url) parts.push(String(url).replace(/:\d{4,5}\//, ':<port>/'));
    const status = a['http.response.status_code'];
    if (status) parts.push(`→ ${status}`);
    if (sql(s)) parts.push(`| ${sql(s).slice(0, 140)}`);
    if (a['flow.phase'] === 'hook') parts.push('(hook)');
    out.push('  '.repeat(depth) + parts.join(' '));
    for (const k of kids(s)) walk(k, depth + 1);
  };
  walk(root, 0);
  return out.join('\n');
}

// The story: the trace as a sequence of messages between actors, in the order they
// happened. Whatever happens inside the app is indented under the message that entered
// it, and the answer comes back on its own line after it. Identical consecutive lines
// fold into ×N.
function story(spans, config) {
  const { root, kids } = tree(spans);
  const sut = config.sut ?? 'app';
  const name = (peer) => config.peers?.[peer] ?? peer;
  const lines = []; // { indent, head, text }
  const say = (indent, from, arrow, to, text) => lines.push({ indent, head: [from, arrow, to], text });

  const walk = (s, actor, indent, inherited) => {
    for (const k of kids(s)) {
      const action = decide(k, kids(k), config);
      if (action === 'hide') continue;
      if (action === 'flatten') {
        // A flattened test client call hands its bodies to the server span it reached
        const bodies = { request: k.attributes['flow.request.body'], response: k.attributes['flow.response.body'] };
        walk(k, actor, indent, k.kind === CLIENT ? bodies : undefined);
        continue;
      }
      const d = describeSpan(k, inherited);
      // Lines inside start under the receiving actor's name
      const inner = indent + actor.length + 3;
      if (d.type === 'enter' || (d.type === 'step' && actor !== sut)) {
        say(indent, actor, '→', sut, d.text);
        walk(k, sut, inner, undefined);
        if (d.result) say(indent, actor, '←', sut, d.result);
      } else if (d.type === 'consume') {
        say(indent, name(d.peer), '⇢', sut, d.text);
        walk(k, sut, indent + name(d.peer).length + 3, undefined);
      } else if (d.type === 'publish') {
        say(indent, actor, '⇢', name(d.peer), d.text);
        walk(k, actor, inner, undefined);
      } else if (d.type === 'call') {
        say(indent, actor, '→', name(d.peer), d.text);
        walk(k, actor, inner, undefined);
        if (d.result) say(indent, actor, '←', name(d.peer), d.result);
      } else {
        say(indent, actor, '', '', d.text); // a step of the app
        walk(k, actor, inner, undefined);
      }
    }
  };
  walk(root, 'test', 2, undefined);

  // Line up the text after "from → to" across the story
  const width = Math.max(0, ...lines.map((l) => l.head[2].length));
  const rendered = lines.map(({ indent, head: [from, arrow, to], text }) => {
    const head = arrow ? `${from} ${arrow} ${to.padEnd(width)}` : `${from} ${''.padEnd(width + 2)}`;
    return `${' '.repeat(indent)}${head}  ${text}`;
  });
  const folded = [];
  for (const r of rendered) {
    const prev = folded.at(-1);
    if (prev && prev.text === r) prev.times++;
    else folded.push({ text: r, times: 1 });
  }

  const state = root.attributes['flow.test.state'];
  const suite = root.attributes['flow.test.suite'];
  const header = `${state === 'pass' ? '✔' : state === 'fail' ? '✘' : '·'} ${suite ? `${suite} › ` : ''}${root.name}`;
  return [header, ...folded.map((f) => (f.times > 1 ? `${f.text} ×${f.times}` : f.text))].join('\n');
}

// ---------- cli ----------

const args = process.argv.slice(2);
const configFlag = args.indexOf('--config');
const configPath = configFlag >= 0 ? args.splice(configFlag, 2)[1] : 'flow.config.mjs';
const config = existsSync(configPath) ? (await import(pathToFileURL(resolve(configPath)).href)).default : {};

const target = args[0];
const files = statSync(target).isDirectory()
  ? readdirSync(target).filter((f) => f.endsWith('.json')).sort().map((f) => join(target, f))
  : [target];

for (const file of files) {
  const spans = JSON.parse(readFileSync(file, 'utf8'));
  const base = file.replace(/\.json$/, '');
  writeFileSync(`${base}.raw.txt`, raw(spans) + '\n');
  const text = story(spans, config);
  writeFileSync(`${base}.story.txt`, text + '\n');
  console.log(text + '\n');
}
