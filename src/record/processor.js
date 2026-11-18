// The span and log processors: the "clock" of a recording.
//
// They keep, in memory, every span and log the app's own instrumentation produces, and
// number each span start, span end and log with one counter. That number is the exact
// order things happened in: span timestamps only have millisecond precision, so spans
// started in the same millisecond would tie and swap between runs.
//
// Inert until the runner integration calls activate(), so in production they keep nothing.
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace';

/**
 * A log as the renderer needs it, copied when it is emitted.
 * @typedef {{ order: number, spanId?: string, level?: string, severity?: number,
 *   body: unknown, attributes: Record<string, unknown>, scope: string }} RecordedLog
 */

// One state for the whole process, kept on globalThis: the app's instrumentation file
// (which creates the processors) and the runner integration (which reads them) are
// separate setupFiles, and each could get its own copy of this module.
const key = Symbol.for('flow-recording.state');
const state = (globalThis[key] ??= {
  active: false,
  exporter: new InMemorySpanExporter(),
  order: new WeakMap(), // span → start number
  ended: new WeakMap(), // span → end number
  next: 0,
  // Instrumentation scopes that produced at least one span or log in this run (coverage check)
  scopes: new Set(),
  /** @type {RecordedLog[]} */
  logs: [],
  // Whether the app added logProcessors(): only then is a silent logger a gap
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
export const startOrder = (span) => state.order.get(span) ?? Number.MAX_SAFE_INTEGER;
export const endOrder = (span) => state.ended.get(span) ?? Number.MAX_SAFE_INTEGER;
export const nextOrder = () => state.next;

// --- the processors

/** @implements {import('@opentelemetry/sdk-trace').SpanProcessor} */
export class RecordingProcessor {
  // Simple (not batched), so the spans are there when a test ends
  inner = new SimpleSpanProcessor({ exporter: state.exporter });
  onStart(span, parentContext) {
    if (!state.active) return;
    state.order.set(span, state.next++);
    this.inner.onStart(span, parentContext);
  }
  onEnd(span) {
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
/** @implements {import('@opentelemetry/sdk-logs').LogRecordProcessor} */
export class LogProcessor {
  constructor() {
    state.logsWanted = true;
  }
  onEmit(log) {
    if (!state.active) return;
    state.scopes.add(log.instrumentationScope.name);
    state.logs.push({
      order: state.next++,
      spanId: log.spanContext?.spanId,
      level: log.severityText,
      severity: log.severityNumber,
      body: log.body,
      attributes: { ...log.attributes },
      scope: log.instrumentationScope.name,
    });
  }
  async forceFlush() {}
  async shutdown() {}
}
