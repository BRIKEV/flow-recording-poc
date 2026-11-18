// Seam (test only): fetch calls mocked with msw.
//
// msw replaces globalThis.fetch, so the app's OTel instrumentation (undici) never sees a
// mocked request, and the call would be missing from the story. This wraps whatever fetch
// is installed (msw's, once the test file has called listen()) with a client span that
// has the url, method, status and both bodies. Production fetch is never touched.
import { context, SpanKind, trace } from '@opentelemetry/api';
import { isText } from './http-bodies.js';

export function wrapFetch(tracer) {
  const current = globalThis.fetch;
  if (current.__flowWrapped) return;
  const wrapped = async (input, init) => {
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
        // clone(): reading the body here must not consume it for the app
        span.setAttribute('flow.response.body', (await response.clone().text()).slice(0, 2000));
      }
      return response;
    } finally {
      span.end();
    }
  };
  wrapped.__flowWrapped = true;
  globalThis.fetch = wrapped;
}
