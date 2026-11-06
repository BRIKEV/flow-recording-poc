// What would be the `flow-recording` package. It instruments nothing: it collects the
// spans the app's own OpenTelemetry setup already produces.
import type { Context } from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
  type Span,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base';

export const enabled = process.env.FLOW_RECORD === '1';

// Shared through globalThis: the app's instrumentation file and the runner integration
// are separate setupFiles and must see the same state.
const key = Symbol.for('flow-recording.state');
const store = globalThis as typeof globalThis & {
  [key]?: { exporter: InMemorySpanExporter; order: WeakMap<object, number>; next: number };
};
const state = (store[key] ??= { exporter: new InMemorySpanExporter(), order: new WeakMap(), next: 0 });
export const exporter = state.exporter;

// The order in which spans were started. Span start times come from Date.now(), so they
// only have millisecond precision and spans started in the same millisecond tie. The
// start order is exact and the same on every run.
export const startOrder = (span: ReadableSpan) => state.order.get(span) ?? Number.MAX_SAFE_INTEGER;
export const nextStartOrder = () => state.next;

class RecordingProcessor implements SpanProcessor {
  private inner = new SimpleSpanProcessor(exporter);
  onStart(span: Span, parentContext: Context) {
    state.order.set(span, state.next++);
    this.inner.onStart(span, parentContext);
  }
  onEnd(span: ReadableSpan) {
    this.inner.onEnd(span);
  }
  forceFlush() {
    return this.inner.forceFlush();
  }
  shutdown() {
    return this.inner.shutdown();
  }
}

export const flowRecording = {
  // Added to the app's spanProcessors. Simple (not batched), so spans are there when a test ends.
  processors: (): SpanProcessor[] => (enabled ? [new RecordingProcessor()] : []),
};
