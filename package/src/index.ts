// flow-recording: the entry point the app imports from its own OTel setup.
// It instruments nothing: it collects the spans the app's instrumentation already produces.
//
// PUBLIC API (what the user touches):
//   flowRecording.processors()      in the app's instrumentation file, inside spanProcessors
//   flowRecording.logProcessors()   the same, inside logRecordProcessors (optional: the logs
//                                   the app's logger sends through OTel, e.g. pino or winston)
// No env var: the processor stays inert until the runner integration (flow-recording/vitest)
// activates it. In production nothing activates it, so it never keeps a span.
// Everything else here is internal, shared with ./vitest.ts.
import type { Context } from '@opentelemetry/api';
import type { LogRecordProcessor, ReadWriteLogRecord } from '@opentelemetry/sdk-logs';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
  type Span,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace';

// Internal ----------------------------------------------------------------------------

// Shared through globalThis: the app's instrumentation file and the runner integration
// are separate setupFiles and must see the same state.
const key = Symbol.for('flow-recording.state');
type State = {
  active: boolean;
  exporter: InMemorySpanExporter;
  order: WeakMap<object, number>;
  ended: WeakMap<object, number>;
  next: number;
  // Instrumentation scopes that produced at least one span or log in this run (coverage check)
  scopes: Set<string>;
  logs: RecordedLog[];
  // Whether the app added logProcessors(): only then is a silent logger a gap
  logsWanted: boolean;
};
// A log as the renderer needs it, copied when it is emitted
export type RecordedLog = {
  order: number;
  spanId?: string;
  level?: string;
  severity?: number;
  body: unknown;
  attributes: Record<string, unknown>;
  scope: string;
};
const store = globalThis as typeof globalThis & { [key]?: State };
const state = (store[key] ??= {
  active: false,
  exporter: new InMemorySpanExporter(),
  order: new WeakMap(),
  ended: new WeakMap(),
  next: 0,
  scopes: new Set(),
  logs: [],
  logsWanted: false,
});
export const exporter = state.exporter;
export const seenScopes = () => state.scopes;
export const recordedLogs = () => state.logs;
export const logsWanted = () => state.logsWanted;
export const resetLogs = () => {
  state.logs = [];
};

// Called by the runner integration when it loads
export const activate = () => {
  state.active = true;
};

// The order in which spans were started. Span start times come from Date.now(), so they
// only have millisecond precision and spans started in the same millisecond tie. The
// start order is exact and the same on every run.
export const startOrder = (span: ReadableSpan) => state.order.get(span) ?? Number.MAX_SAFE_INTEGER;
// Ends share the same counter, so "B started before A ended" (they ran in parallel) is
// exact too. Promise.all starts its calls before any I/O, so it is stable across runs.
export const endOrder = (span: ReadableSpan) => state.ended.get(span) ?? Number.MAX_SAFE_INTEGER;
export const nextStartOrder = () => state.next;

class RecordingProcessor implements SpanProcessor {
  // Simple (not batched), so the spans are there when a test ends
  private inner = new SimpleSpanProcessor({ exporter });
  onStart(span: Span, parentContext: Context) {
    if (!state.active) return;
    state.order.set(span, state.next++);
    this.inner.onStart(span, parentContext);
  }
  onEnd(span: ReadableSpan) {
    if (!state.active) return;
    state.ended.set(span, state.next++);
    state.scopes.add(span.instrumentationScope.name);
    this.inner.onEnd(span);
  }
  forceFlush() {
    return this.inner.forceFlush();
  }
  shutdown() {
    return this.inner.shutdown();
  }
}

// Logs share the span counter, so a log lands exactly between the calls around it
class LogProcessor implements LogRecordProcessor {
  onEmit(log: ReadWriteLogRecord) {
    if (!state.active) return;
    state.scopes.add(log.instrumentationScope.name);
    state.logs.push({
      order: state.next++,
      spanId: log.spanContext?.spanId,
      level: log.severityText,
      severity: log.severityNumber,
      body: log.body,
      attributes: { ...(log.attributes as Record<string, unknown>) },
      scope: log.instrumentationScope.name,
    });
  }
  async forceFlush() {}
  async shutdown() {}
}

// PUBLIC API ---------------------------------------------------------------------------

/**
 * Spread into the app's own `spanProcessors`:
 *
 *   new NodeSDK({ spanProcessors: [yourExporters, ...flowRecording.processors()] })
 *
 * Inert until `flow-recording/vitest` is loaded as a setupFile, so production is untouched.
 */
export const flowRecording = {
  processors: (): SpanProcessor[] => [new RecordingProcessor()],
  /**
   * Spread into the app's own `logRecordProcessors`, to see the logs each flow wrote, in
   * place. Any logger that sends its logs through OTel works (pino, winston, bunyan with
   * their instrumentations). Inert outside tests, like `processors()`.
   */
  logProcessors: (): LogRecordProcessor[] => {
    state.logsWanted = true;
    return [new LogProcessor()];
  },
};
