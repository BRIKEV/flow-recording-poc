// What each kept span or log says: one message between two actors. The kind of message
// comes from the OTel span kind, so it reads the same for HTTP, queues, gRPC or a db:
//   SERVER    caller → app     METHOD /path {body}      … then  caller ← app  status {body}
//   CONSUMER  broker ⇢ app     consume destination
//   CLIENT    actor → peer     METHOD /path {body}      … then  actor ← peer  status {body}
//   db        actor → db       insert / update / delete / select, as data
//   PRODUCER  actor ⇢ broker   publish destination
//   INTERNAL  the app's own spans: a step of the app
//   log       actor · level    message {fields}, where it was written (⚠ from warn up)
// The actor is `test` until something enters the app (a SERVER or CONSUMER span, or an
// app span called straight from the test); inside, it is the app (config.sut).
import { CLIENT, CONSUMER, PRODUCER, SERVER, SEVERITY, isDb, sql } from './spans.mjs';
import { cut, payload, value } from './payload.mjs';
import { sqlText, withValues } from './sql.mjs';

// What a message is about: the destination, and for RabbitMQ the routing key (usually
// the event name). Old and stable semconv names.
function message(a, fallback) {
  const destination = a['messaging.destination.name'] ?? a['messaging.destination'];
  const key = a['messaging.rabbitmq.destination.routing_key'] ?? a['messaging.rabbitmq.routing_key'];
  if (key && destination) return { key, destination };
  return { key: destination ?? fallback };
}

// What a span says: { type, peer, text, result }. `inherited` carries the bodies of a
// flattened test client call to the server span it reached.
export function describeSpan(s, inherited = {}) {
  const a = s.attributes;
  const status = a['http.response.status_code'] ?? a['http.status_code'] ?? a['rpc.grpc.status_code'];
  const response = payload(a['flow.response.body'] ?? inherited.response);
  const result = status !== undefined ? `${status}${status >= 400 ? ' ⚠' : ''}${response ? ` ${response}` : ''}` : '';
  const method = a['http.request.method'] ?? a['http.method'];
  const body = payload(a['flow.request.body'] ?? inherited.request);
  const withBody = (t) => `${t}${body ? ` ${body}` : ''}`;
  if (isDb(s) && sql(s)) return { type: 'call', peer: 'db', text: cut(sqlText(withValues(sql(s), a)), 120), result: '' };
  if (s.kind === SERVER) {
    const route = a['http.route'] ?? a['url.path'] ?? a['http.target'];
    return { type: 'enter', text: withBody(method ? `${method} ${route}` : s.name), result };
  }
  if (s.kind === CONSUMER) {
    const m = message(a, s.name);
    return { type: 'consume', peer: a['messaging.system'] ?? 'queue', text: withBody(`consume ${m.key}`), result: '' };
  }
  if (s.kind === PRODUCER) {
    const m = message(a, s.name);
    return { type: 'publish', peer: a['messaging.system'] ?? 'queue', text: withBody(`publish ${m.key}${m.destination ? ` to ${m.destination}` : ''}`), result: '' };
  }
  if (s.kind === CLIENT) {
    const url = a['url.full'] ?? a['http.url'];
    const peer = url ? new URL(url).host : a['server.address'] ?? a['rpc.service'] ?? s.name;
    const text = method && url ? `${method} ${new URL(url).pathname}` : s.name;
    return { type: 'call', peer, text: withBody(text), result };
  }
  return { type: 'step', text: s.name, result: '' };
}

export function describeLog(log) {
  const fields = Object.keys(log.attributes).length ? ` ${value(log.attributes)}` : '';
  const message = typeof log.body === 'string' ? cut(log.body, 80) : value(log.body);
  return { type: 'log', level: String(log.level ?? 'log').toLowerCase(), text: `${(log.severity ?? 0) >= SEVERITY.warn ? '⚠ ' : ''}${message}${fields}` };
}
