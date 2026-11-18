# Open questions

Each one has a recommendation. Move it to "Decided" once agreed. Numbers are IDs and are not reused.

8. **Name / relationship with TWD.** Deferred: no need to decide now.

9. **Behaviour diff against base: parked, not part of the MVP.** When it comes back: v1 stores nothing. The PR job records the merge-base with its own tests and then the head, and the two runs are diffed line by line. No committed snapshot files.

## To verify in the spike

Spike 1 (apogee-bot) results: [06-spike-apogee.md](06-spike-apogee.md).

- ✔ OTel patching works inside Vitest's transform (ESM MikroORM → CJS `pg`). Jest still to check.
- ✔ with a fix: msw-mocked `fetch` produces no spans until `fetch` is wrapped on top of msw.
- ✔ nock-mocked `http` calls (axios) are seen by the http instrumentation with no seam (`examples/express-bff-third-party`). Bodies come from our `http.ClientRequest` seam.
- ✔ RabbitMQ (`examples/express-rabbit-postgres`): publish → consume is one trace, because amqplib's instrumentation propagates context in the message headers. Message bodies and `pg` query values need options of the user's own instrumentation (`publishHook`/`consumeHook`, `enhancedDatabaseReporting`), only while recording. Open: ship those as a documented snippet, or accept them as the one place we touch the user's instrumentation config.
- ✔ coverage warning: a boundary library (db, queue, cache, http client) that was loaded but produced no spans is reported above the stories. Tried by disabling the pg instrumentation: every db line vanished and the warning said so. Limit: only CommonJS packages are seen; frameworks are not checked, because their spans are flattened anyway.
- ✔ parallel calls (`Promise.all`) are shown as parallel: the processor numbers span ends with the same counter as starts, so "B started before A ended" is exact and stable.
- ✔ two runs give byte-identical raw traces and stories. Span start times come from `Date.now()` (millisecond precision), so ordering by them made spans started in the same millisecond swap (`dns.lookup`/`tcp.connect`, even `commit`/`chat.postMessage`). Our processor now numbers spans in `onStart`, and siblings are ordered by that start order.
- ☐ detached work stays in the request's trace (a handler that replies 202 and keeps working).
- ✔ we join the app's own SDK: one line adds our processor to its `spanProcessors` (`examples/nest-postgres-slack`). Open: a zero-touch OTLP receiver instead, and `sdk.start()` re-running per test file under Vitest/Jest isolation.
- ☐ spans can be attributed to the test line that caused them. If not, the annotated test drops to given/when/then level, which span position already gives.

## Decided

1. **Main deliverable (MVP)**: the recording of the tests the PR added or modified, as a comment plus the player. No diff. Same as TWD: an extra pair of eyes on the journey, easy to explain. The diff is parked as Q9.
2. **Noise budget**: zero-touch by default, and `flow.given/when/then/span` are optional chapters. The facts come from OTel, so the recording is complete without them, and the tool doesn't depend on the dev's discipline.
3. **DB view**: statements from db spans, with writes highlighted and reads collapsed. A row-level diff per engine comes later. Reads stay visible (collapsed) because they explain why a branch was taken, for example the limit sum.
4. **Lanes**: one per peer, automatic from span attributes, and an unnamed peer shows as its host. An optional `peers` map names lanes. Zero setup by default, and better names for anyone who bothers.
5. **Reader**: the PR reviewer. Every output decision is judged by "does the reviewer get it in seconds". Docs and agents may reuse the report later, but they don't drive the design.
6. **Source of facts**: the app's own OpenTelemetry instrumentation (bring your own OTel), and we are the renderer for the reviewer. A preset with the standard auto-instrumentations covers teams without OTel. The OTel community already maintains per-library capture (pg, mongo, Kafka, Service Bus, …), and it is the standard. Per-library adapters, decorators and AST transforms were rejected.
7. **Detached work**: the recording waits until no span is left open, and spans that end after the test finishes are flagged `⚠ after test end`. Detached work isn't lost, and a racy test becomes visible.
10. **Player hosting**: comment first, player later. In the MVP the comment is complete on its own, and the player is the local `.flow/report/index.html` plus a CI artifact. A hosted page per PR comes later.
11. **Curation**: the story is curated in three layers, last wins, with no per-library code. (1) Our defaults, written against what every span has (kind, scope, semconv attributes): hide `dns`/`net`, db spans with no statement (connections) and transaction control; flatten the auto-instrumentations' internal spans (middlewares); merge the test client call into the server span it reached. (2) Spans started by hooks (`beforeEach`/`afterEach`) are hidden, decided by the runner, not by a filter. (3) The user's `flow.config` rules (`show` / `hide` / `flatten`, by matcher or function) override both. The raw recording stays complete. Semconv is the adapter, and the OTel community maintains it.
12. **No env var**: recording is on when `flow-recording/vitest` is loaded as a setupFile, and the processor is inert until then. The user opts in by adding the package; anything test-only in their own instrumentation uses their own convention (`NODE_ENV=test`, `.env.test`). One less thing to pass around, and production can never keep spans.
