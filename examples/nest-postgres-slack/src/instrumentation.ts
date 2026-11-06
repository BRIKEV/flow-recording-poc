// The app's own OpenTelemetry setup, as a team would already have it.
// Loaded before the app: `tsx --import ./src/instrumentation.ts` in production,
// and as the first Vitest setupFile in tests.
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { flowRecording } from '../flow-recording';

const sdk = new NodeSDK({
  serviceName: 'notes',
  instrumentations: [getNodeAutoInstrumentations()],
  spanProcessors: [
    ...(process.env.OTEL_EXPORTER_OTLP_ENDPOINT ? [new BatchSpanProcessor(new OTLPTraceExporter())] : []),
    ...flowRecording.processors(), // the only line flow recording adds; empty unless FLOW_RECORD=1
  ],
});
sdk.start();
