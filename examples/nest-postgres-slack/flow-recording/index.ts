// What would be the `flow-recording` package. It instruments nothing: it collects the
// spans the app's own OpenTelemetry setup already produces.
import { InMemorySpanExporter, SimpleSpanProcessor, type SpanProcessor } from '@opentelemetry/sdk-trace-base';

export const enabled = process.env.FLOW_RECORD === '1';

// Shared through globalThis: the app's instrumentation file and the runner integration
// are separate setupFiles and must see the same exporter.
const key = Symbol.for('flow-recording.exporter');
const store = globalThis as typeof globalThis & { [key]?: InMemorySpanExporter };
export const exporter = (store[key] ??= new InMemorySpanExporter());

export const flowRecording = {
  // Added to the app's spanProcessors. Simple (not batched), so spans are there when a test ends.
  processors: (): SpanProcessor[] => (enabled ? [new SimpleSpanProcessor(exporter)] : []),
};
