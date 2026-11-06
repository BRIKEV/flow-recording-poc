// flow-recording: the entry point the app imports from its own OTel setup.
// It instruments nothing: it collects the spans the app's instrumentation already produces.
//
// PUBLIC API (what the user touches):
//   flowRecording.processors()   in the app's instrumentation file, inside spanProcessors
//   FLOW_RECORD=1                env var that turns recording on
// Everything else here is internal, shared with ./vitest.ts.
import type { Context } from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
  type Span,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace';

// Internal ----------------------------------------------------------------------------

export const enabled = process.env.FLOW_RECORD === '1';

// Shared through globalThis: the app's instrumentation file and the runner integration
// are separate setupFiles and must see the same state.
const key = Symbol.for('flow-recording.state');
const store = globalThis as typeof globalThis & {
  [key]?: { exporter: InMemorySpanExporter; order: WeakMap<object, number>; ended: WeakMap<object, number>; next: number };
};
const state = (store[key] ??= { exporter: new InMemorySpanExporter(), order: new WeakMap(), ended: new WeakMap(), next: 0 });
export const exporter = state.exporter;

// The order in which spans were started. Span start times come from Date.now(), so they
// only have millisecond precision and spans started in the same millisecond tie. The
// start order is exact and the same on every run.
export const startOrder = (span: ReadableSpan) => state.order.get(span) ?? Number.MAX_SAFE_INTEGER;
// Ends share the same counter, so "B started before A ended" (they ran in parallel) is
// exact too. Promise.all starts its calls before any I/O, so it is stable across runs.
export const endOrder = (span: ReadableSpan) => state.ended.get(span) ?? Number.MAX_SAFE_INTEGER;
export const nextStartOrder = () => state.next;

class RecordingProcessor implements SpanProcessor {
  private inner = new SimpleSpanProcessor({ exporter });
  onStart(span: Span, parentContext: Context) {
    state.order.set(span, state.next++);
    this.inner.onStart(span, parentContext);
  }
  onEnd(span: ReadableSpan) {
    state.ended.set(span, state.next++);
    this.inner.onEnd(span);
  }
  forceFlush() {
    return this.inner.forceFlush();
  }
  shutdown() {
    return this.inner.shutdown();
  }
}

// PUBLIC API ---------------------------------------------------------------------------

/**
 * Spread into the app's own `spanProcessors`:
 *
 *   new NodeSDK({ spanProcessors: [yourExporters, ...flowRecording.processors()] })
 *
 * Returns nothing unless FLOW_RECORD=1, so production and plain test runs are untouched.
 */
export const flowRecording = {
  // Simple (not batched), so the spans are there when a test ends.
  processors: (): SpanProcessor[] => (enabled ? [new RecordingProcessor()] : []),
};
