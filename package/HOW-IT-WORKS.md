# How a test becomes a story

One real test, followed from `it()` to the last line of its story. The test is from [`examples/express-rabbit-postgres`](../examples/express-rabbit-postgres/test/orders.e2e-spec.ts):

```ts
it('rejects a payment webhook for an unknown order', async () => {
  const response = await request(app).post('/webhooks/payments').send({ orderId: 99, amount: 25 });
  expect(response.status).toBe(404);
});
```

It ends as:

```
✔ orders › rejects a payment webhook for an unknown order
  test → orders  POST /webhooks/payments {orderId: 99, amount: 25}
         orders → db      update orders {status: "paid"} where id = 99
         orders · warn    ⚠ payment for an unknown order {orderId: 99}
  test ← orders  404 ⚠
```

The package has two halves that never run together:

| | When | Where | Output |
|---|---|---|---|
| **record** | while the tests run | `src/index.ts`, `src/record/` | `.flow/recordings/<test>.json` |
| **render** | after, as a CLI | `src/render/` | `<test>.story.txt` and `<test>.raw.txt` |

The JSON in between is the contract between the two halves. You can open it and read it.

## 1. Before any test: two processors join the app's OTel

The app's own `src/instrumentation.ts` already sets up OpenTelemetry. It adds ours:

```ts
spanProcessors: [...yours, ...flowRecording.processors()],
logRecordProcessors: [...yours, ...flowRecording.logProcessors()],
```

From then on, every span and log the app's instrumentation produces also reaches our processors (`record/processor.ts`). They do nothing yet: they are inert.

Next comes the setupFile `flow-recording/vitest` (`record/vitest.ts`). Loading it:
- calls `activate()`, so the processors start keeping things;
- applies the Vitest + ESM fix (`record/esm-entry.ts`), so pino gets instrumented.

**The counter.** The processors give a number to every span start, span end and log, all from one counter. OTel timestamps only have millisecond precision, so two spans started in the same millisecond tie. With timestamps the order would change between runs; the counter is exact.

## 2. `beforeEach`: prepare the test

`record/vitest.ts`, in order:
1. Forget the previous test (spans, logs, bodies).
2. Install the seams (`record/seams/`). They capture what OTel doesn't record:
   - `http-bodies.ts`: request and response bodies, for any http client.
   - `fetch.ts`: fetch calls mocked with msw, which OTel never sees.
3. Open the test's own span (`rejects a payment webhook…`) and make it the parent of everything that happens next.
4. Wrap the test function, to note the counter value when the body starts and when it ends.

## 3. The test runs: spans and logs get their numbers

Everything the instrumentation produces, in counter order:

| start | end | span (or log) | produced by | started by |
|---|---|---|---|---|
| 97 | 119 | `rejects a payment webhook…` | flow-recording | the test |
| 98 | 99 | `pg-pool.connect` | instrumentation-pg | `beforeEach` (truncate) |
| 100 | 101 | `pg.query: truncate orders, payments…` | instrumentation-pg | `beforeEach` |
| 102 | 103 | `dns.lookup` | instrumentation-dns | body |
| 104 | 118 | `POST http://127.0.0.1/webhooks/payments` (client, supertest) | instrumentation-http | body |
| 105 | 106 | `tcp.connect` | instrumentation-net | body |
| 107 | 116 | `POST /webhooks/payments` (server, the app) | instrumentation-http | body |
| 108 | 109 | `middleware - jsonParser` | instrumentation-router | body |
| 110 | 117 | `request handler - /webhooks/payments` | instrumentation-router | body |
| 111 | 112 | `pg-pool.connect` | instrumentation-pg | body |
| 113 | 114 | `pg.query: update orders set status = 'paid' where id = $1` | instrumentation-pg | body |
| 115 | | log `warn payment for an unknown order` | instrumentation-pino | body |

The test body ran between 102 and 119. That window is how hook spans are told apart from body spans.

Meanwhile, the http seam saw supertest write `{"orderId":99,"amount":25}`. It read the span id from the `traceparent` header and tied the body to span 104.

## 4. `afterEach`: write the recording

`record/recording.ts` turns the spans into JSON and adds four things to each one:
- `order` / `endOrder`: the counter values from the table.
- `flow.phase`:
  - A span right under the test span is `test` if it started inside the body window, and `hook` otherwise. So 98 and 100 are `hook`.
  - Deeper spans inherit their parent's phase.
- `logs`: the warn (115) goes on span 110. It is the span that was active when the app wrote the log.
- `flow.request.body` / `flow.response.body`: the bodies the seam tied to this span.

`afterAll` also writes `.flow/coverage/<file>.json` (`record/coverage.ts`): the libraries that were loaded and whether their instrumentation produced anything.

## 5. The CLI: from JSON to story

`npm run story` runs `render/cli.mjs`. For each recording:

**`spans.mjs`**: builds the spans into a tree, siblings sorted by start order. Printed as-is, that tree is the `.raw.txt`.

**`curate.mjs`**: for each span, decides whether to `show` it, `hide` it (with everything under it) or `flatten` it (drop its line, keep its children):

| span | decision | why |
|---|---|---|
| `pg-pool.connect` (98), `truncate` (100) | hide | phase `hook`: setup, not behaviour |
| `dns.lookup`, `tcp.connect` | hide | default: network plumbing |
| client `POST` (104) | flatten | default: a call that reaches our own server is one step. Its bodies go to the server span |
| server `POST` (107) | show | |
| `middleware`, `request handler` | flatten | default: framework layers. What happens inside them stays |
| `pg-pool.connect` (111) | hide | default: a db span with no statement is a connection, not a query |
| `update orders…` (113) | show | |
| log `warn` | show | `info` and up by default |

Then the app's `flow.config.mjs` can override any of these defaults.

**`describe.mjs`**: what each kept span says, chosen by its OTel span kind, not by library:
- **server span:** `POST /webhooks/payments`, with the request body via `payload.mjs`.
- **db span:** the SQL with its values put in, read as data by `sql.mjs`: `update orders {status: "paid"} where id = 99`.
- **log:** level and message. `warn` and up get ⚠.

**`layout.mjs`**: puts it on the page:
- **actors:** `test` until a server span enters the app, then `orders` (`sut` in `flow.config`). So `test → orders`, then `orders → db`.
- **indentation:** what happens inside the app goes under the line that entered it.
- **answers:** the response goes on its own line at the end (`test ← orders  404 ⚠`).
- **parallel calls:** calls that overlapped (by the counter) get a bracket.
- **×N:** repeated lines fold.

The result is the story at the top.

## The fragile parts

These depend on things OTel or Vitest don't promise. They are the first suspects when something breaks after an upgrade.

| What | Where | Why it is fragile |
|---|---|---|
| `enterWith` to make the test span the parent of everything | `record/vitest.ts` | not public OTel API |
| `getFn` / `setFn` to wrap the test body | `record/vitest.ts` | `@vitest/runner` internals |
| wrapping `http.ClientRequest.prototype` | `record/seams/http-bodies.ts` | monkey-patches Node's http client |
| resolving package entries by name | `record/esm-entry.ts` | works around how Vitest imports dependencies |

## Where to change what

| I want to… | File |
|---|---|
| hide or show a kind of span by default | `render/curate.mjs` (`DEFAULTS`) |
| change how a span kind reads (`→`, `⇢`, the text) | `render/describe.mjs` |
| change how payloads are cut | `render/payload.mjs` (`FIELDS`, string length) |
| read more SQL shapes | `render/sql.mjs` |
| change indentation, alignment, the parallel bracket | `render/layout.mjs` |
| capture something OTel doesn't | a new file in `record/seams/` |
| support another test runner | a sibling of `record/vitest.ts` |
