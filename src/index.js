// flow-recording: what the app imports in its own OTel setup.
// It instruments nothing: it collects what the app's instrumentation already produces.
//
// PUBLIC API (what the user touches):
//   flowRecording.processors()      in the app's instrumentation file, inside spanProcessors
//   flowRecording.logProcessors()   optional, inside logRecordProcessors: the logs the app's
//                                   logger sends through OTel (pino, winston, bunyan)
// Types: index.d.ts.
//
// No env var: both stay inert until the runner integration (flow-recording/vitest) loads.
// In production nothing loads it, so they never keep anything.
//
// How it fits together:
//   record/   runs inside the tests: collects spans and logs, writes .flow/recordings/
//   render/   runs after, as the CLI: turns recordings into stories
// The walk from a test to its story: ../HOW-IT-WORKS.md
import { LogProcessor, RecordingProcessor } from './record/processor.js';

export const flowRecording = {
  // Spread into the app's own spanProcessors:
  //   new NodeSDK({ spanProcessors: [yourExporters, ...flowRecording.processors()] })
  processors: () => [new RecordingProcessor()],
  // Spread into the app's own logRecordProcessors, to see the logs each flow wrote, in
  // place. Any logger that sends its logs through OTel works.
  logProcessors: () => [new LogProcessor()],
};
