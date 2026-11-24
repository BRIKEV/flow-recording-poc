// flow-recording/vitest: the runner integration.
//
// PUBLIC API (what the user touches): only its name, as a Vitest setupFile, after the
// app's instrumentation file:
//
//   setupFiles: ['./src/instrumentation.ts', 'flow-recording/vitest', './test/setup.ts']
//
// It exports nothing, and needs no env var: loading it is what turns recording on.
//
// What it does, per test:
//   beforeEach  clear the last test, install the seams, open the test's own span and make
//               it the parent of everything, note when the test body starts and ends
//   afterEach   close the test span, write .flow/recordings/<test>.json
//   afterAll    write .flow/coverage/<file>.json
// Each piece lives in its own file next to this one.
import { basename, join, relative } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { context, ROOT_CONTEXT, trace } from '@opentelemetry/api';
import { getFn, setFn } from '@vitest/runner';
import { afterAll, afterEach, beforeEach } from 'vitest';
import { writeCoverage } from './coverage.js';
import { resolvePackageEntriesByName } from './esm-entry.js';
import { activate, exporter, nextOrder, resetLogs } from './processor.js';
import { recording } from './recording.js';
import { wrapFetch } from './seams/fetch.js';
import { captureHttpBodies, clearBodies } from './seams/http-bodies.js';

activate();
resolvePackageEntriesByName();

// Goes through the app's tracer provider: our spans live in the same trace as theirs
const tracer = trace.getTracer('flow-recording');
const recordingsDir = join(process.cwd(), '.flow', 'recordings');
const coverageDir = join(process.cwd(), '.flow', 'coverage');

let testFile;
let testSpan;
/** @type {import('./recording.js').BodyWindow} */
let body;

beforeEach((ctx) => {
  testFile = ctx.task.file?.filepath;
  exporter.reset();
  resetLogs();
  clearBodies();
  wrapFetch(tracer);
  captureHttpBodies();

  // The test's own span, made the active context for the rest of the test, so every span
  // the app starts nests under it. FRAGILE: enterWith is not public OTel API; it is how
  // the context manager (AsyncLocalStorage) can be set for "from here on" instead of
  // inside a callback, which a beforeEach can't wrap the test in.
  testSpan = tracer.startSpan(ctx.task.name, {}, ROOT_CONTEXT);
  const manager = context._getContextManager();
  manager._asyncLocalStorage?.enterWith(trace.setSpan(ROOT_CONTEXT, testSpan));

  // When the test body starts and ends, on the processor's counter, to tell hook spans
  // from body spans. The runner reads the test function after the beforeEach hooks, so
  // swapping it here wraps exactly the body (aroundEach would wrap the hooks too).
  body = undefined;
  const fn = getFn(ctx.task);
  setFn(ctx.task, async () => {
    const from = nextOrder();
    try {
      await fn();
    } finally {
      body = { from, to: nextOrder() };
      setFn(ctx.task, fn);
    }
  });
});

afterEach((ctx) => {
  // For the story's header: describe path and result
  const suites = [];
  for (let s = ctx.task.suite; s && !('filepath' in s); s = s.suite) suites.unshift(s.name);
  testSpan?.setAttribute('flow.test.suite', suites.join(' › '));
  testSpan?.setAttribute('flow.test.state', ctx.task.result?.state ?? 'unknown');
  // Where the test is, to tell which tests a change touched. The line needs Vitest's
  // `includeTaskLocation: true`; without it, only the file is recorded.
  const filepath = ctx.task.file?.filepath;
  if (filepath) testSpan?.setAttribute('flow.test.file', relative(process.cwd(), filepath));
  if (ctx.task.location) testSpan?.setAttribute('flow.test.line', ctx.task.location.line);
  testSpan?.end();

  mkdirSync(recordingsDir, { recursive: true });
  writeFileSync(join(recordingsDir, `${recordingName(ctx.task)}.json`), JSON.stringify(recording(exporter.getFinishedSpans(), body), null, 2));
});

// <spec file>--<test name>, one per test. Names can still collide inside a file (it.each
// cases that differ only in punctuation, the same name in two describes): later ones get
// -2, -3…, in the file's test order, so the name is stable between runs.
const slug = (s) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
const taken = new Set();
function recordingName(task) {
  const spec = slug(basename(task.file?.filepath ?? 'test').replace(/\.[cm]?[jt]sx?$/, ''));
  const base = `${spec}--${slug(task.name).slice(0, 80)}`;
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
  taken.add(name);
  return name;
}

afterAll(() => writeCoverage(coverageDir, testFile));
