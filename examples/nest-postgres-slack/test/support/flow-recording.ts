// POC recorder, taken from the apogee-bot spike. Off unless FLOW_RECORD=1.
// Writes one raw span tree (.txt) and the spans (.json) per test into .flow/recordings/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { context, trace, ROOT_CONTEXT, SpanKind } from '@opentelemetry/api';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { InMemorySpanExporter, SimpleSpanProcessor, type ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

const enabled = process.env.FLOW_RECORD === '1';
const exporter = new InMemorySpanExporter();

if (enabled) {
  const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  provider.register();
  registerInstrumentations({
    instrumentations: [
      new HttpInstrumentation(),
      new UndiciInstrumentation(),
      new PgInstrumentation({ enhancedDatabaseReporting: true }),
      new ExpressInstrumentation(),
    ],
  });
}

const tracer = trace.getTracer('flow-recording');
const outDir = join(process.cwd(), '.flow', 'recordings');
let testSpan: ReturnType<typeof tracer.startSpan> | undefined;

// msw replaces globalThis.fetch, so undici's diagnostics channel never fires for mocked
// requests. Wrap whatever fetch is installed (msw's, once the test file's beforeAll has
// called listen()) with a client span. A platform seam, not a library adapter.
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
});

afterEach((ctx) => {
  if (!enabled) return;
  testSpan?.end();
  const spans = exporter.getFinishedSpans();
  mkdirSync(outDir, { recursive: true });
  const file = ctx.task.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 80);
  writeFileSync(join(outDir, `${file}.txt`), `${ctx.task.name}\n${renderRaw(spans)}\n`);
  writeFileSync(join(outDir, `${file}.json`), JSON.stringify(spans.map(toJson), null, 2));
});

// The unfiltered tree: what OTel gives us before any curation
function renderRaw(spans: ReadableSpan[]): string {
  const ids = new Set(spans.map((s) => s.spanContext().spanId));
  const children = new Map<string | undefined, ReadableSpan[]>();
  for (const s of spans) {
    const parentId = s.parentSpanContext?.spanId;
    const key = parentId && ids.has(parentId) ? parentId : undefined;
    children.set(key, [...(children.get(key) ?? []), s]);
  }
  const lines: string[] = [];
  const walk = (parent: string | undefined, depth: number) => {
    const kids = (children.get(parent) ?? []).sort((a, b) => toNs(a.startTime) - toNs(b.startTime));
    for (const s of kids) {
      lines.push(`${'  '.repeat(depth)}${describe(s)}`);
      walk(s.spanContext().spanId, depth + 1);
    }
  };
  walk(undefined, 0);
  return lines.join('\n');
}

function describe(s: ReadableSpan): string {
  const a = s.attributes;
  const kind = ['internal', 'server', 'client', 'producer', 'consumer'][s.kind];
  const status = a['http.response.status_code'] ?? a['http.status_code'];
  const url = a['url.full'] ?? a['http.url'] ?? a['url.path'] ?? a['http.target'];
  const sql = a['db.query.text'] ?? a['db.statement'];
  const parts = [`[${kind}] ${s.name}`];
  if (url) parts.push(String(url));
  if (status) parts.push(`→ ${status}`);
  if (sql) parts.push(`| ${String(sql).replace(/\s+/g, ' ').slice(0, 140)}`);
  return parts.join(' ');
}

const toNs = (t: [number, number]) => t[0] * 1e9 + t[1];

const toJson = (s: ReadableSpan) => ({
  name: s.name,
  kind: s.kind,
  spanId: s.spanContext().spanId,
  traceId: s.spanContext().traceId,
  parentSpanId: s.parentSpanContext?.spanId,
  attributes: s.attributes,
  scope: s.instrumentationScope.name,
});
