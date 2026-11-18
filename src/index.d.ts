import type { LogRecordProcessor } from '@opentelemetry/sdk-logs';
import type { SpanProcessor } from '@opentelemetry/sdk-trace';

export declare const flowRecording: {
  /**
   * Spread into the app's own `spanProcessors`:
   *
   *   new NodeSDK({ spanProcessors: [yourExporters, ...flowRecording.processors()] })
   *
   * Inert until `flow-recording/vitest` is loaded as a setupFile, so production is untouched.
   */
  processors(): SpanProcessor[];
  /**
   * Spread into the app's own `logRecordProcessors`, to see the logs each flow wrote, in
   * place. Any logger that sends its logs through OTel works (pino, winston, bunyan).
   */
  logProcessors(): LogRecordProcessor[];
};
