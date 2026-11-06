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

// ---------- one line per span ----------

const shortSql = (q) =>
  q
    .replace(/ values \(.*/i, ' values (…)')
    .replace(/^select (.{0,40}?)[, ].* from/i, 'select $1… from')
    .slice(0, 90);

function line(s) {
  const a = s.attributes;
  const status = a['http.response.status_code'] ?? a['http.status_code'];
  const method = a['http.request.method'] ?? a['http.method'];
  if (isDb(s) && sql(s)) {
    const write = /^(insert|update|delete|merge|upsert|replace)\b/i.test(sql(s));
    return `db  ${write ? '' : '(read) '}${shortSql(sql(s))}`;
  }
  if (s.kind === SERVER && method) return `${method} ${a['http.route'] ?? a['url.path'] ?? a['http.target']} → ${status}`;
  if (s.kind === CLIENT && method) {
    const url = new URL(a['url.full'] ?? a['http.url'] ?? `http://${a['server.address']}`);
    return `→ ${url.host} ${method} ${url.pathname} → ${status}`;
  }
  if (s.kind === PRODUCER || s.kind === CONSUMER) {
    const dest = a['messaging.destination.name'] ?? s.name;
    return `${s.kind === PRODUCER ? '⇢ publish' : '⇠ consume'} ${a['messaging.system'] ?? ''} ${dest}`.replace(/\s+/g, ' ');
  }
  return s.name;
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

function story(spans, config) {
  const { root, kids } = tree(spans);
  const out = [root.name];
  const walk = (s, depth) => {
    for (const k of kids(s)) {
      const action = decide(k, kids(k), config);
      if (action === 'hide') continue;
      if (action === 'show') out.push('  '.repeat(depth) + line(k));
      walk(k, action === 'show' ? depth + 1 : depth);
    }
  };
  walk(root, 1);
  return out.join('\n');
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
