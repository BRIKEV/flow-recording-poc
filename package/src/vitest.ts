// flow-recording/vitest: the runner integration.
//
// PUBLIC API (what the user touches): only its name, as a Vitest setupFile, after the
// app's instrumentation file:
//
//   setupFiles: ['./src/instrumentation.ts', 'flow-recording/vitest', './test/setup.ts']
//
// It exports nothing, and needs no env var: loading it is what turns recording on.
// Everything below is internal: it opens one span per test, adds the test-only seams
// (fetch under msw, request and response bodies), marks which spans come from hooks and
// which from the test body, writes one recording per test to .flow/recordings/<test>.json,
// and a coverage report per test file to .flow/coverage/. Rendering is story.mjs's job.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import http from 'node:http';
import { getFn, setFn } from '@vitest/runner';
import { basename, join } from 'node:path';
import { context, trace, ROOT_CONTEXT, SpanKind } from '@opentelemetry/api';
import type { ReadableSpan } from '@opentelemetry/sdk-trace';
import { activate, endOrder, exporter, nextStartOrder, seenScopes, startOrder } from './index';

activate();

// Goes through the app's tracer provider: our spans live in the same trace as theirs
const tracer = trace.getTracer('flow-recording');
const outDir = join(process.cwd(), '.flow', 'recordings');
const coverageDir = join(process.cwd(), '.flow', 'coverage');
let testFile: string | undefined;
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
      if (isText(response.headers.get('content-type'))) {
        span.setAttribute('flow.response.body', (await response.clone().text()).slice(0, 2000));
      }
      return response;
    } finally {
      span.end();
    }
  }) as typeof fetch & { __flowWrapped?: boolean };
  wrapped.__flowWrapped = true;
  globalThis.fetch = wrapped;
}

// Only bodies a reviewer can read: JSON, text, forms
const isText = (contentType: string | null | undefined) => /json|text|x-www-form-urlencoded/.test(contentType ?? '');

// OTel doesn't capture bodies, and they are what a reviewer wants to see
// (`POST /notes {user: "U1"} → 201 {id: 1, …}`). Collect what any http client writes and
// reads (supertest, or the app's own outbound calls) and tie it to its client span
// through the traceparent header the http instrumentation already injects. A test-only
// seam, like fetch.
const bodies = new Map<string, { request?: string; response?: string }>();
type BodyRequest = http.ClientRequest & { __flowBody?: string };
function captureBodies() {
  const proto = http.ClientRequest.prototype as BodyRequest & { __flowWrapped?: boolean };
  if (proto.__flowWrapped) return;
  proto.__flowWrapped = true;
  const collect = (req: BodyRequest, chunk: unknown) => {
    if (typeof chunk === 'string' || chunk instanceof Uint8Array) req.__flowBody = (req.__flowBody ?? '') + Buffer.from(chunk).toString();
  };
  const { write, end } = proto;
  proto.write = function (this: BodyRequest, chunk: unknown, ...rest: unknown[]) {
    collect(this, chunk);
    return (write as (...a: unknown[]) => boolean).call(this, chunk, ...rest);
  } as typeof proto.write;
  proto.end = function (this: BodyRequest, chunk?: unknown, ...rest: unknown[]) {
    collect(this, chunk);
    const spanId = String(this.getHeader('traceparent') ?? '').split('-')[2];
    if (spanId) {
      const entry = { request: this.__flowBody?.slice(0, 2000) } as { request?: string; response?: string };
      bodies.set(spanId, entry);
      this.once('response', (res: http.IncomingMessage) => {
        if (!isText(res.headers['content-type'])) return;
        let text = '';
        res.on('data', (c: Buffer | string) => (text += c.toString()));
        res.on('end', () => (entry.response = text.slice(0, 2000)));
      });
    }
    return (end as (...a: unknown[]) => BodyRequest).call(this, chunk, ...rest);
  } as typeof proto.end;
}

beforeEach((ctx) => {
  testFile = ctx.task.file?.filepath;
  exporter.reset();
  bodies.clear();
  wrapFetch();
  captureBodies();
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
  // For the header: describe path and result
  const suites: string[] = [];
  for (let s = ctx.task.suite; s && !('filepath' in s); s = s.suite) suites.unshift(s.name);
  testSpan?.setAttribute('flow.test.suite', suites.join(' › '));
  testSpan?.setAttribute('flow.test.state', ctx.task.result?.state ?? 'unknown');
  testSpan?.end();
  const spans = exporter.getFinishedSpans();
  mkdirSync(outDir, { recursive: true });
  const file = ctx.task.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 80);
  writeFileSync(join(outDir, `${file}.json`), JSON.stringify(withPhases(spans.map(toJson)), null, 2));
});

// Coverage: boundary libraries (databases, queues, caches, http clients) the app loaded,
// and whether their OTel instrumentation produced any span in this file's run. One that
// was loaded but produced nothing is a silent gap in the stories (instrumentation
// disabled, unsupported version), so the renderer warns about it. Only boundaries: a
// framework's spans (express, nest, graphql) are flattened by the story anyway, and a
// library can be loaded without being used (msw loads graphql). The instrumentation is
// found by OTel's naming convention: pg → @opentelemetry/instrumentation-pg.
// Limit: only CommonJS packages are seen (require.cache).
const BOUNDARIES = new Set([
  'pg', 'mysql', 'mysql2', 'mongodb', 'mongoose', 'tedious', 'oracledb', 'cassandra-driver', 'knex',
  'ioredis', 'redis', 'memcached',
  'amqplib', 'kafkajs',
  'undici', 'socket.io', 'openai',
]);

afterAll(() => {
  const require = createRequire(join(process.cwd(), 'noop.js'));
  const packages = new Set<string>();
  for (const file of Object.keys(require.cache)) {
    const m = file.match(/.*node_modules\/((?:@[^/]+\/)?[^/]+)\//);
    if (m) packages.add(m[1]);
  }
  const report = [...packages].sort().flatMap((pkg) => {
    if (!BOUNDARIES.has(pkg)) return [];
    const instrumentation = `@opentelemetry/instrumentation-${pkg.replace(/^@/, '').replace('/', '-')}`;
    try {
      require.resolve(instrumentation);
    } catch {
      return [];
    }
    return [{ package: pkg, instrumentation, spans: seenScopes().has(instrumentation) }];
  });
  mkdirSync(coverageDir, { recursive: true });
  writeFileSync(join(coverageDir, `${basename(testFile ?? 'unknown')}.json`), JSON.stringify(report, null, 2));
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

const bodyAttributes = (b?: { request?: string; response?: string }) => ({
  ...(b?.request ? { 'flow.request.body': b.request } : {}),
  ...(b?.response ? { 'flow.response.body': b.response } : {}),
});

const toJson = (s: ReadableSpan) => ({
  name: s.name,
  kind: s.kind,
  spanId: s.spanContext().spanId,
  traceId: s.spanContext().traceId,
  parentSpanId: s.parentSpanContext?.spanId,
  order: startOrder(s),
  endOrder: endOrder(s),
  startTime: s.startTime,
  endTime: s.endTime,
  attributes: {
    ...(s.attributes as Record<string, unknown>),
    ...bodyAttributes(bodies.get(s.spanContext().spanId)),
  },
  scope: s.instrumentationScope.name,
});
