// The recording of one test: its spans and logs as the JSON the renderer reads.
//
// Each span gets:
//   order / endOrder   when it started and ended, on the processor's counter
//   flow.phase         'test' if the test body caused it, 'hook' if a beforeEach/afterEach
//                      did. The story hides hooks: they are setup, not behaviour.
//   logs               the logs written while it was the active span
//   flow.*.body        request/response bodies from the http seam
import { endOrder, recordedLogs, startOrder } from './processor.js';
import { bodyAttributes } from './seams/http-bodies.js';

/**
 * The test body ran between these two counter values (undefined: it never ran).
 * @typedef {{ from: number, to: number } | undefined} BodyWindow
 */

/** @param {import('@opentelemetry/sdk-trace').ReadableSpan[]} spans @param {BodyWindow} body */
export function recording(spans, body) {
  return withLogs(withPhases(spans.map(toJson), body), body);
}

const toJson = (s) => ({
  name: s.name,
  kind: s.kind,
  spanId: s.spanContext().spanId,
  traceId: s.spanContext().traceId,
  parentSpanId: s.parentSpanContext?.spanId,
  order: startOrder(s),
  endOrder: endOrder(s),
  startTime: s.startTime,
  endTime: s.endTime,
  attributes: {
    ...s.attributes,
    ...bodyAttributes(s.spanContext().spanId),
  },
  scope: s.instrumentationScope.name,
});

// The test's own span: the one flow-recording opened, with no parent in the recording
const rootOf = (spans, byId) => spans.find((s) => s.scope === 'flow-recording' && !byId.has(s.parentSpanId));

const inBody = (order, body) => !!body && order >= body.from && order < body.to;

// A span right under the test span is 'test' if it started while the body ran, else
// 'hook'. Deeper spans inherit from their parent, so work the body started in the
// background stays 'test'.
function withPhases(spans, body) {
  const byId = new Map(spans.map((s) => [s.spanId, s]));
  const root = rootOf(spans, byId);
  const phaseOf = (s) => {
    if (s === root) return 'test';
    const parent = byId.get(s.parentSpanId);
    if (parent && parent !== root) return phaseOf(parent);
    return inBody(s.order, body) ? 'test' : 'hook';
  };
  return spans.map((s) => ({ ...s, attributes: { ...s.attributes, 'flow.phase': phaseOf(s) } }));
}

// Each log goes on the span it was written in, with that span's phase. A log written
// straight under the test span is 'test' or 'hook' by when it was written, like a span.
function withLogs(spans, body) {
  const byId = new Map(spans.map((s) => [s.spanId, s]));
  const root = rootOf(spans, byId);
  const logs = new Map(); // span → its logs
  for (const log of recordedLogs()) {
    const span = byId.get(log.spanId) ?? root;
    if (!span) continue;
    const phase = span !== root ? String(span.attributes['flow.phase']) : inBody(log.order, body) ? 'test' : 'hook';
    logs.set(span, [...(logs.get(span) ?? []), { ...log, phase }]);
  }
  return spans.map((s) => (logs.has(s) ? { ...s, logs: logs.get(s) } : s));
}
