// The app's own OpenTelemetry setup, as a team would already have it.
// Loaded before the app: `tsx --import ./src/instrumentation.ts` in production,
// and as the first Vitest setupFile in tests.
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace';
import { flowRecording } from 'flow-recording'; // ← flow recording
import { register } from 'import-in-the-middle/register-hooks.mjs';

// OTel's ESM hook, the standard setup for an app that imports its dependencies as ESM:
// instrumentations that replace a module's export (pino's) need it. Only those modules.
register({ include: ['pino'] });

// ← flow recording: message bodies and query values aren't captured by default. These are
// options of the community instrumentations; the app turns them on in its tests with its
// own convention (Vitest sets NODE_ENV=test), not with anything of flow recording.
const testing = process.env.NODE_ENV === 'test';

const sdk = new NodeSDK({
  serviceName: 'orders',
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-amqplib': testing
        ? {
            publishHook: (span, { content }) => span.setAttribute('flow.request.body', content.toString()),
            consumeHook: (span, { msg }) => span.setAttribute('flow.request.body', msg.content.toString()),
          }
        : {},
      '@opentelemetry/instrumentation-pg': { enhancedDatabaseReporting: testing },
    }),
  ],
  spanProcessors: [
    ...(process.env.OTEL_EXPORTER_OTLP_ENDPOINT ? [new BatchSpanProcessor({ exporter: new OTLPTraceExporter() })] : []),
    ...flowRecording.processors(), // ← flow recording: inert outside its test setupFile
  ],
  // pino's logs, sent through OTel by its instrumentation (on by default)
  logRecordProcessors: [
    ...(process.env.OTEL_EXPORTER_OTLP_ENDPOINT ? [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() })] : []),
    ...flowRecording.logProcessors(), // ← flow recording: the logs each flow wrote
  ],
});
sdk.start();
