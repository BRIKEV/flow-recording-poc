// Curation: which spans and logs make it into the story. It knows no library: it works on
// what every OTel span has (kind, name, instrumentation scope, semconv attributes).
// Three layers, last wins:
//   1. our defaults (below), 2. the hook phase, 3. the user's flow.config rules.
// Each rule answers with one action:
//   show     print the line
//   hide     drop the span and everything under it
//   flatten  drop the line, keep its children one level up
import { CLIENT, KIND, SERVER, SEVERITY, isDb, sql } from './spans.mjs';

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
//     logs: {                   // or false, for no logs; or just a level: logs: 'warn'
//       level: 'info',          //   lowest level shown (default info; 'debug', 'warn'…)
//       hide: [logMatcher, …],  //   drop these logs
//       show: [logMatcher, …],  //   keep these, even below the level
//     },
//   }
// A logMatcher: { body?, level?, scope?, attributes?: { key: value } }, each a string or a RegExp.

export function decide(s, kids, config) {
  let action = 'show';
  for (const rule of DEFAULTS) action = rule(s) || action;
  if (clientOfServer(s, kids)) action = 'flatten';
  // Layer 2: spans from beforeEach/afterEach are setup, not behaviour
  if (s.attributes['flow.phase'] === 'hook') action = 'hide';
  // Layer 3: the user's rules win
  for (const a of ['show', 'hide', 'flatten']) if ((config[a] ?? []).some((m) => matches(m, s))) action = a;
  return config.rule?.(s) ?? action;
}

// Logs: the ones the app sent through OTel. `logs` in flow.config picks which are shown.
const logConfig = (logs) => (logs === false ? false : typeof logs === 'string' ? { level: logs } : logs ?? {});
const matchesLog = (m, log) =>
  (m.body === undefined || test(m.body, typeof log.body === 'string' ? log.body : JSON.stringify(log.body))) &&
  (m.level === undefined || test(m.level, String(log.level ?? '').toLowerCase())) &&
  (m.scope === undefined || test(m.scope, log.scope)) &&
  Object.entries(m.attributes ?? {}).every(([k, v]) => test(v, log.attributes[k]));
export function shownLog(log, config) {
  const c = logConfig(config.logs);
  if (!c || log.phase === 'hook') return false;
  if ((c.show ?? []).some((m) => matchesLog(m, log))) return true;
  if ((c.hide ?? []).some((m) => matchesLog(m, log))) return false;
  return (log.severity ?? SEVERITY.info) >= SEVERITY[c.level ?? 'info'];
}
