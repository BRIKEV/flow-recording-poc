// The recording of one test: its spans and logs as the JSON the renderer reads.
//
// Each span gets:
//   order / endOrder   when it started and ended, on the processor's counter
//   flow.phase         'test' if the test body caused it, 'hook' if a beforeEach/afterEach
//                      did. The story hides hooks: they are setup, not behaviour.
//   logs               the logs written while it was the active span
//   flow.*.body        request/response bodies from the http seam
import type { ReadableSpan } from '@opentelemetry/sdk-trace';
import { endOrder, recordedLogs, startOrder, type RecordedLog } from './processor';
import { bodyAttributes } from './seams/http-bodies';

// The test body ran between these two counter values (null: it never ran)
export type BodyWindow = { from: number; to: number } | undefined;

export function recording(spans: ReadableSpan[], body: BodyWindow) {
  return withLogs(withPhases(spans.map(toJson), body), body);
}

const toJson = (s: ReadableSpan) => ({
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
    ...(s.attributes as Record<string, unknown>),
    ...bodyAttributes(s.spanContext().spanId),
  },
  scope: s.instrumentationScope.name,
});

type RecordedSpan = ReturnType<typeof toJson> & { logs?: unknown[] };

// The test's own span: the one flow-recording opened, with no parent in the recording
const rootOf = (spans: RecordedSpan[], byId: Map<string, RecordedSpan>) =>
  spans.find((s) => s.scope === 'flow-recording' && !byId.has(s.parentSpanId!));

const inBody = (order: number, body: BodyWindow) => !!body && order >= body.from && order < body.to;

// A span right under the test span is 'test' if it started while the body ran, else
// 'hook'. Deeper spans inherit from their parent, so work the body started in the
// background stays 'test'.
function withPhases(spans: RecordedSpan[], body: BodyWindow): RecordedSpan[] {
  const byId = new Map(spans.map((s) => [s.spanId, s]));
  const root = rootOf(spans, byId);
  const phaseOf = (s: RecordedSpan): string => {
    if (s === root) return 'test';
    const parent = byId.get(s.parentSpanId!);
    if (parent && parent !== root) return phaseOf(parent);
    return inBody(s.order, body) ? 'test' : 'hook';
  };
  return spans.map((s) => ({ ...s, attributes: { ...s.attributes, 'flow.phase': phaseOf(s) } }));
}

// Each log goes on the span it was written in, with that span's phase. A log written
// straight under the test span is 'test' or 'hook' by when it was written, like a span.
function withLogs(spans: RecordedSpan[], body: BodyWindow): RecordedSpan[] {
  const byId = new Map(spans.map((s) => [s.spanId, s]));
  const root = rootOf(spans, byId);
  const logs = new Map<RecordedSpan, (RecordedLog & { phase: string })[]>();
  for (const log of recordedLogs()) {
    const span = byId.get(log.spanId!) ?? root;
    if (!span) continue;
    const phase = span !== root ? String(span.attributes['flow.phase']) : inBody(log.order, body) ? 'test' : 'hook';
    logs.set(span, [...(logs.get(span) ?? []), { ...log, phase }]);
  }
  return spans.map((s) => (logs.has(s) ? { ...s, logs: logs.get(s) } : s));
}
