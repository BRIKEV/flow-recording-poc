// Seam (test only): request and response bodies of http calls.
//
// OTel doesn't record bodies, and they are what a reviewer wants to see
// (`POST /orders {item: "book"} → 201 {id: 1, …}`). This collects what any http client
// writes and reads (supertest, or the app's own outbound calls) and ties it to the
// client span that made the call, through the `traceparent` header the http
// instrumentation already puts on every request: its third part is the span id.
//
// How: it wraps write() and end() of Node's http.ClientRequest, the object every http
// client in Node ends up using.
import http from 'node:http';

const LIMIT = 2000;

// Only bodies a reviewer can read: JSON, text, forms
export const isText = (contentType: string | null | undefined) => /json|text|x-www-form-urlencoded/.test(contentType ?? '');

type Bodies = { request?: string; response?: string };
const bodies = new Map<string, Bodies>(); // by span id

export const clearBodies = () => bodies.clear();

// The bodies of a span, as the attributes the renderer reads
export const bodyAttributes = (spanId: string) => {
  const b = bodies.get(spanId);
  return {
    ...(b?.request ? { 'flow.request.body': b.request } : {}),
    ...(b?.response ? { 'flow.response.body': b.response } : {}),
  };
};

type BodyRequest = http.ClientRequest & { __flowBody?: string };

export function captureHttpBodies() {
  const proto = http.ClientRequest.prototype as BodyRequest & { __flowWrapped?: boolean };
  if (proto.__flowWrapped) return;
  proto.__flowWrapped = true;

  const collect = (req: BodyRequest, chunk: unknown) => {
    if (typeof chunk === 'string' || chunk instanceof Uint8Array) req.__flowBody = (req.__flowBody ?? '') + Buffer.from(chunk).toString();
  };
  const { write, end } = proto;

  // The request body can be written in several chunks
  proto.write = function (this: BodyRequest, chunk: unknown, ...rest: unknown[]) {
    collect(this, chunk);
    return (write as (...a: unknown[]) => boolean).call(this, chunk, ...rest);
  } as typeof proto.write;

  // end() is the last chunk: keep the request body, and listen for the response
  proto.end = function (this: BodyRequest, chunk?: unknown, ...rest: unknown[]) {
    collect(this, chunk);
    const spanId = String(this.getHeader('traceparent') ?? '').split('-')[2];
    if (spanId) {
      const entry: Bodies = { request: this.__flowBody?.slice(0, LIMIT) };
      bodies.set(spanId, entry);
      this.once('response', (res: http.IncomingMessage) => {
        if (!isText(res.headers['content-type'])) return;
        let text = '';
        res.on('data', (c: Buffer | string) => (text += c.toString()));
        res.on('end', () => (entry.response = text.slice(0, LIMIT)));
      });
    }
    return (end as (...a: unknown[]) => BodyRequest).call(this, chunk, ...rest);
  } as typeof proto.end;
}
