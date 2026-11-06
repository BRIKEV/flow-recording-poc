// The app's own OpenTelemetry setup, as a team would already have it.
// Loaded before the app: `tsx --import ./src/instrumentation.ts` in production,
// and as the first Vitest setupFile in tests.
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace';
import { flowRecording } from 'flow-recording'; // ← flow recording

// ← flow recording: message bodies and query values aren't captured by default. These are
// options of the community instrumentations, turned on only while recording.
const recording = process.env.FLOW_RECORD === '1';

const sdk = new NodeSDK({
  serviceName: 'orders',
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-amqplib': recording
        ? {
            publishHook: (span, { content }) => span.setAttribute('flow.request.body', content.toString()),
            consumeHook: (span, { msg }) => span.setAttribute('flow.request.body', msg.content.toString()),
          }
        : {},
      '@opentelemetry/instrumentation-pg': { enhancedDatabaseReporting: recording },
    }),
  ],
  spanProcessors: [
    ...(process.env.OTEL_EXPORTER_OTLP_ENDPOINT ? [new BatchSpanProcessor({ exporter: new OTLPTraceExporter() })] : []),
    ...flowRecording.processors(), // ← flow recording: empty unless FLOW_RECORD=1
  ],
});
sdk.start();
