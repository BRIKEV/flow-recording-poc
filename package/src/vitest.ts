// flow-recording/vitest: the runner integration.
//
// PUBLIC API (what the user touches): only its name, as a Vitest setupFile, after the
// app's instrumentation file:
//
//   setupFiles: ['./src/instrumentation.ts', 'flow-recording/vitest', './test/setup.ts']
//
// It exports nothing. Everything below is internal: with FLOW_RECORD=1 it opens one span
// per test, adds the test-only fetch seam, marks which spans come from hooks and which
// from the test body, and writes one recording per test to .flow/recordings/<test>.json.
// Rendering is story.mjs's job.
import { mkdirSync, writeFileSync } from 'node:fs';
import { getFn, setFn } from '@vitest/runner';
import { join } from 'node:path';
import { context, trace, ROOT_CONTEXT, SpanKind } from '@opentelemetry/api';
import type { ReadableSpan } from '@opentelemetry/sdk-trace';
import { enabled, exporter, nextStartOrder, startOrder } from './index';

// Goes through the app's tracer provider: our spans live in the same trace as theirs
const tracer = trace.getTracer('flow-recording');
const outDir = join(process.cwd(), '.flow', 'recordings');
let testSpan: ReturnType<typeof tracer.startSpan> | undefined;
// Which spans the test body started (by start order), so hook spans can be told apart
let body: { from: number; to: number } | undefined;

// msw replaces globalThis.fetch, so the app's undici instrumentation never sees mocked
// requests. Wrap whatever fetch is installed (msw's, once the test file's beforeAll has
// called listen()) with a client span. A test-only seam: production fetch is untouched.
function wrapFetch() {
  const current = globalThis.fetch as typeof fetch & { __flowWrapped?: boolean };
  if (current.__flowWrapped) return;
  const wrapped = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const span = tracer.startSpan(`fetch ${request.method}`, {
      kind: SpanKind.CLIENT,
      attributes: {
        'url.full': request.url,
        'http.request.method': request.method,
        'flow.request.body': init?.body ? String(init.body).slice(0, 300) : undefined,
      },
    });
    try {
      const response = await context.with(trace.setSpan(context.active(), span), () => current(input, init));
      span.setAttribute('http.response.status_code', response.status);
      return response;
    } finally {
      span.end();
    }
  }) as typeof fetch & { __flowWrapped?: boolean };
  wrapped.__flowWrapped = true;
  globalThis.fetch = wrapped;
}

beforeEach((ctx) => {
  if (!enabled) return;
  exporter.reset();
  wrapFetch();
  // Make the test span the active context for the rest of the test, so every span nests under it
  testSpan = tracer.startSpan(ctx.task.name, {}, ROOT_CONTEXT);
  const manager = (context as unknown as { _getContextManager(): { _asyncLocalStorage?: { enterWith(c: unknown): void } } })._getContextManager();
  manager._asyncLocalStorage?.enterWith(trace.setSpan(ROOT_CONTEXT, testSpan));
  // The runner reads the test function after the beforeEach hooks, so wrapping it here
  // tells us exactly when the body starts and ends. aroundEach can't: it wraps the hooks too.
  body = undefined;
  const fn = getFn(ctx.task);
  setFn(ctx.task, async () => {
    const from = nextStartOrder();
    try {
      await fn();
    } finally {
      body = { from, to: nextStartOrder() };
      setFn(ctx.task, fn);
    }
  });
});

afterEach((ctx) => {
  if (!enabled) return;
  testSpan?.end();
  const spans = exporter.getFinishedSpans();
  mkdirSync(outDir, { recursive: true });
  const file = ctx.task.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 80);
  writeFileSync(join(outDir, `${file}.json`), JSON.stringify(withPhases(spans.map(toJson)), null, 2));
});

// flow.phase = 'test' | 'hook', decided for each span directly under the test span (by
// whether the body started it) and inherited by its descendants. Detached work started by the body
// stays 'test', because it descends from a body span.
function withPhases(spans: RecordedSpan[]): RecordedSpan[] {
  const byId = new Map(spans.map((s) => [s.spanId, s]));
  const root = spans.find((s) => s.scope === 'flow-recording' && !byId.has(s.parentSpanId!));
  const phaseOf = (s: RecordedSpan): string => {
    if (s === root) return 'test';
    const parent = byId.get(s.parentSpanId!);
    if (parent && parent !== root) return phaseOf(parent);
    return body && s.order >= body.from && s.order < body.to ? 'test' : 'hook';
  };
  return spans.map((s) => ({ ...s, attributes: { ...s.attributes, 'flow.phase': phaseOf(s) } }));
}

type RecordedSpan = ReturnType<typeof toJson>;

const toJson = (s: ReadableSpan) => ({
  name: s.name,
  kind: s.kind,
  spanId: s.spanContext().spanId,
  traceId: s.spanContext().traceId,
  parentSpanId: s.parentSpanContext?.spanId,
  order: startOrder(s),
  startTime: s.startTime,
  endTime: s.endTime,
  attributes: s.attributes as Record<string, unknown>,
  scope: s.instrumentationScope.name,
});
