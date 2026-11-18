// The span and log processors: the "clock" of a recording.
//
// They keep, in memory, every span and log the app's own instrumentation produces, and
// number each span start, span end and log with one counter. That number is the exact
// order things happened in: span timestamps only have millisecond precision, so spans
// started in the same millisecond would tie and swap between runs.
//
// Inert until the runner integration calls activate(), so in production they keep nothing.
import type { Context } from '@opentelemetry/api';
import type { LogRecordProcessor, ReadWriteLogRecord } from '@opentelemetry/sdk-logs';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
  type Span,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace';

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

// One state for the whole process, kept on globalThis: the app's instrumentation file
// (which creates the processors) and the runner integration (which reads them) are
// separate setupFiles, and each could get its own copy of this module.
const key = Symbol.for('flow-recording.state');
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

// --- read and reset by the runner integration

export const activate = () => {
  state.active = true;
};
export const exporter = state.exporter;
export const recordedLogs = () => state.logs;
export const resetLogs = () => {
  state.logs = [];
};
export const seenScopes = () => state.scopes;
export const logsWanted = () => state.logsWanted;

// When a span started and ended, on the shared counter. "B started before A ended" means
// they ran in parallel, exactly (Promise.all starts its calls before any I/O, so this is
// stable across runs).
export const startOrder = (span: ReadableSpan) => state.order.get(span) ?? Number.MAX_SAFE_INTEGER;
export const endOrder = (span: ReadableSpan) => state.ended.get(span) ?? Number.MAX_SAFE_INTEGER;
export const nextOrder = () => state.next;

// --- the processors

export class RecordingProcessor implements SpanProcessor {
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

// Logs take a number from the same counter, so a log lands exactly between the calls around it
export class LogProcessor implements LogRecordProcessor {
  constructor() {
    state.logsWanted = true;
  }
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
