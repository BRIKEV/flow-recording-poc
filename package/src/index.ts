// flow-recording: the entry point the app imports from its own OTel setup.
// It instruments nothing: it collects the spans the app's instrumentation already produces.
//
// PUBLIC API (what the user touches):
//   flowRecording.processors()   in the app's instrumentation file, inside spanProcessors
// No env var: the processor stays inert until the runner integration (flow-recording/vitest)
// activates it. In production nothing activates it, so it never keeps a span.
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

// Shared through globalThis: the app's instrumentation file and the runner integration
// are separate setupFiles and must see the same state.
const key = Symbol.for('flow-recording.state');
type State = {
  active: boolean;
  exporter: InMemorySpanExporter;
  order: WeakMap<object, number>;
  ended: WeakMap<object, number>;
  next: number;
  // Instrumentation scopes that produced at least one span in this run (coverage check)
  scopes: Set<string>;
};
const store = globalThis as typeof globalThis & { [key]?: State };
const state = (store[key] ??= {
  active: false,
  exporter: new InMemorySpanExporter(),
  order: new WeakMap(),
  ended: new WeakMap(),
  next: 0,
  scopes: new Set(),
});
export const exporter = state.exporter;
export const seenScopes = () => state.scopes;

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
};
