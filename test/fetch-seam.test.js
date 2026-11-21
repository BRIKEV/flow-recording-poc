// The fetch seam must only watch the app's call. Whatever the app passes to fetch has to
// reach the network exactly as it would without flow recording.
//
// Real fetch against a real local server, and a real tracer: nothing is mocked.
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, afterEach, before, test } from 'node:test';
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace';
import { wrapFetch } from '../src/record/seams/fetch.js';

const exporter = new InMemorySpanExporter();
const tracer = new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter })] }).getTracer('test');
const realFetch = globalThis.fetch;

// Answers with what it received, so a test can tell whether the body arrived
let server;
let origin;
before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ method: req.method, path: req.url, body }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

// The seam replaces globalThis.fetch: give every test the real one to wrap
afterEach(() => {
  globalThis.fetch = realFetch;
  exporter.reset();
});

// The one span the seam wrote for the call
const recorded = () => {
  const [span, ...others] = exporter.getFinishedSpans();
  assert.equal(others.length, 0, 'one span per call');
  return span.attributes;
};

test('a Request with a body reaches the server untouched', async () => {
  wrapFetch(tracer);

  const response = await fetch(new Request(`${origin}/things`, { method: 'POST', body: '{"a":1}' }));

  assert.deepEqual(await response.json(), { method: 'POST', path: '/things', body: '{"a":1}' });
  assert.equal(recorded()['url.full'], `${origin}/things`);
  assert.equal(recorded()['http.request.method'], 'POST');
  assert.equal(recorded()['http.response.status_code'], 200);
});

test('a body given as a stream reaches the server untouched', async () => {
  wrapFetch(tracer);
  const body = new Blob(['{"a":1}']).stream();

  const response = await fetch(`${origin}/things`, { method: 'POST', body, duplex: 'half' });

  assert.equal((await response.json()).body, '{"a":1}');
});

test('a url and its options are recorded as before', async () => {
  wrapFetch(tracer);

  const response = await fetch(`${origin}/things?page=2`, { method: 'post', body: '{"a":1}' });

  assert.equal((await response.json()).body, '{"a":1}');
  assert.deepEqual(
    { ...recorded() },
    {
      'url.full': `${origin}/things?page=2`,
      'http.request.method': 'POST',
      'flow.request.body': '{"a":1}',
      'http.response.status_code': 200,
      'flow.response.body': `{"method":"POST","path":"/things?page=2","body":"{\\"a\\":1}"}`,
    },
  );
});

test('a URL object is recorded by its address', async () => {
  wrapFetch(tracer);

  await fetch(new URL('/things', origin));

  assert.equal(recorded()['url.full'], `${origin}/things`);
  assert.equal(recorded()['http.request.method'], 'GET');
});

test('options given next to a Request win over it', async () => {
  wrapFetch(tracer);

  const response = await fetch(new Request(`${origin}/things`), { method: 'DELETE' });

  assert.equal((await response.json()).method, 'DELETE');
  assert.equal(recorded()['http.request.method'], 'DELETE');
});

test('a call that fetch rejects is rejected the same way', async () => {
  wrapFetch(tracer);

  await assert.rejects(fetch('not a url'), TypeError);
});
