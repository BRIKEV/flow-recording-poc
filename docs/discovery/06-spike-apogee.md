# Spike 1: apogee-bot (2026-10-20)

Question: can OTel auto-instrumentation, loaded only in tests, give us the flow of a test, with no change to the test?

Setup: branch `spike/otel-flow-recording` in apogee-bot (local, not pushed). One setup file `backend/test/support/otel-spike.ts` (`FLOW_RECORD=1`), loaded first in the e2e `setupFiles`. Stack: Vitest 4, NestJS 12, Express 5, MikroORM 7 (ESM) → `pg` 8 (CJS), msw 2 mocking Slack's `fetch`. Tests not touched.

## Results

| Check | Result |
|---|---|
| OTel patching inside Vitest (ESM MikroORM → CJS `pg`) | ✔ works with a plain `registerInstrumentations` in a setupFile. No `--import` loader flag needed |
| Incoming request as trigger (http + express) | ✔ `POST /slack/events → 200` server span |
| DB statements | ✔ every query, nested under the request |
| One trace per test | ✔ a test span set with `enterWith` in `beforeEach` propagates into the test body, and through supertest → server → handler → DB |
| Outbound HTTP mocked by msw | ✘ no spans: msw replaces `globalThis.fetch`, so undici's instrumentation never fires. **Fixed** by wrapping `fetch` on top of msw (~20 lines, a platform API, no harness access) |
| Nest instrumentation | ✘ no spans (likely Nest 12 out of its supported range). Not needed, because Express covers it |
| Determinism | ✔ byte-identical over 2 full runs (20 tests) after normalizing the supertest ephemeral port |

## What it looks like

Raw: about 45 spans per test. Rendered by a 40-line filter (it drops pool connects, Express middleware, `BEGIN`/`COMMIT`, advisory locks, the ORM's `select 1 from pg_database`, and setup hooks):

```
rejects every positive transaction of a message that would exceed the giving limit
  db  insert into "transaction" …                       ← the seed: the test's "given", for free
  POST /slack/events → 200                              ← the trigger: "when"
    → slack auth.test 200
    db  (read) select … from "user" where provider_id = 'U1'
    → slack users.info 200
    db  insert into "user" …                            (×4, one per user)
    db  (read) select coalesce(sum(amount), 0) … amount > 0   ← the limit check, visible
    db  (read) select coalesce(sum(amount), 0) … amount < 0
    db  insert into "transaction" …                     ← only one insert: U4's negative
    → slack chat.postMessage 200                        ← limit warning
    → slack chat.postMessage 200                        ← U4's reply
  db  (read) select … from "transaction" …               ← the test's assertions: "then"
```

**given / when / then fall out of span position**: top-level spans before the trigger are the given, the trigger's subtree is the when, and top-level spans after it are the then. The optional `flow.given/when/then` API may matter less than we thought.

## What it changes in the notes

- **Principle refinement:** "we write no instrumentation" becomes **"we instrument platform and mock seams (fetch, and probably nock's `http`), never libraries."** msw is used in most Node test suites, so this seam is required.
- **The renderer is the real work.** Raw spans are about 3× noisier than the story. Filtering rules (pool, middleware, transactions, ORM housekeeping) are a product concern, and they have to be per *instrumentation* (pg, express), not per app.
- **Setup hooks pollute the test.** `setup.ts`'s `truncate` in `beforeEach` shows up in the test's trace. Hooks need to be separated from the test body.
- **SQL text, not params.** MikroORM inlines values, so `db.postgresql.values` is empty and the values are in the statement text. Long `INSERT` column lists need summarizing (table + key values).

## Follow-up: bring your own OTel (`examples/nest-postgres-slack`)

The spike created its own instrumentation. The example now uses the app's own setup instead: `src/instrumentation.ts` with `NodeSDK` + `getNodeAutoInstrumentations()`, loaded first in `setupFiles`. Flow recording only adds `...flowRecording.processors()` to its `spanProcessors`, plus `flow-recording/vitest` for the span per test and the `fetch` seam.

- ✔ Same story as with our own hand-picked instrumentations. The renderer didn't need a change.
- The full auto-instrumentations bring more noise: `dns.lookup`, `tcp.connect`, and the middleware spans now come from `instrumentation-router`. About 30 raw spans for a 4-line story.
- ✘ The raw trace is no longer deterministic: concurrent `dns.lookup` and `tcp.connect` swap order between runs. The story is stable because it doesn't show them.
- One line in the app's file is needed, because OTel SDK 2.x has no `addSpanProcessor`.

## Not verified yet

- nock, detached work after a 202, Jest instead of Vitest, an app that already starts its own OTel SDK, and attributing spans to a test line.
- Small detail: `it.each` names collided in the file slug (17 files for 20 tests).
