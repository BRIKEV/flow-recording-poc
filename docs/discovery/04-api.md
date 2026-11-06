# API and usage

Contract, not implementation. Works in Jest and Vitest with no custom runner. The default costs **two lines per repo and nothing per test**.

**Bring your own OTel.** The app's own instrumentation decides what is captured. We only collect what it already produces, per test, and render it. Working example: [`examples/nest-postgres-slack`](../../examples/nest-postgres-slack/).

## 1. Setup: two lines per repo

The app already has its OTel setup. Add our processor to it:

```diff
  // src/instrumentation.ts (the app's, already exists)
  const sdk = new NodeSDK({
    instrumentations: [getNodeAutoInstrumentations()],
    spanProcessors: [
      new BatchSpanProcessor(new OTLPTraceExporter()),
+     ...flowRecording.processors(),   // empty unless FLOW_RECORD=1
    ],
  });
```

And load that same file in the tests, before our runner integration:

```diff
  // vitest.config.ts (Jest: setupFiles in jest.config.js)
- setupFiles: ['./test/setup.ts'],
+ setupFiles: ['./src/instrumentation.ts', 'flow-recording/vitest', './test/setup.ts'],
```

- `flowRecording.processors()` returns an in-memory span processor (simple, not batched, so the spans are there when a test ends). It instruments nothing.
- `flow-recording/vitest` opens a root span per test (`describe › it`) through the app's tracer provider, adds the test-only `fetch` seam for msw, and writes one recording per test.
- Both do nothing unless `FLOW_RECORD=1`, so normal test runs pay nothing.

Why a line in the app's file and not zero: OTel SDK 2.x removed `addSpanProcessor`, so processors are passed when the provider is built. The zero-touch alternative is an in-process OTLP receiver behind the standard `OTEL_EXPORTER_OTLP_ENDPOINT`, at the cost of batching and an async flush. Still open.

**No OTel in the app?** `flow-recording/register` is a preset: the standard auto-instrumentations plus our processor, in one setupFile. It's the fallback, not the main path.

Optional `flow.config.ts`, only to make the picture read better:

```ts
export default defineFlowConfig({
  sut: 'apogee-bot',
  peers: { 'slack.com': 'slack' },   // name a lane; unnamed peers show as their host
  volatile: ['event_id', 'ts'],      // extra fields to normalise
});
```

## 2. In tests: nothing (the default)

The karma test as it is today. **Not touched.**

```ts
it('creates users from their Slack profile on first sight and links the transaction', async () => {
  journey.slack.addUser({ id: 'U1', name: 'kevin.martinez', display_name: 'Kevin', /* … */ });
  addUsers('U2');

  await journey.send({ text: '<@U2> +++', user: 'U1' });

  const users = await journey.rows('select * from "user" order by provider_id');
  expect(users).toHaveLength(2);
  /* … */
});
```

Recording:

```
karma journey › users › creates users from their Slack profile on first sight…
POST /slack/events                                         → 200
  → slack users.info U1                                    ok
  → db    select … from "user" where provider_id = $1      (read, collapsed)
  → slack users.info U2                                    ok
  → db    insert into "user" (provider_id, username, …)    ×2
  → db    insert into "transaction" (from_user, to_user, amount, total, …)
  → slack chat.postMessage "<@U2>'s apogee increased by 2…"
✔ 5 checks
```

## 3. In tests: optional chapters

```ts
import { flow } from 'flow-recording';

await flow.given(label, fn)   // setup; collapsed in the diagram
await flow.when(label, fn)    // the action under test
await flow.then(label, fn)    // the assertions
await flow.span(label, fn)    // anything else; nestable
```

- Each one opens a span, runs `fn` and returns what `fn` returns, so it never changes what the test does.
- The server, db and HTTP spans that happen inside it nest under it, and that turns the test's chapters into the diagram's chapters.
- The label is the author's words, and the content is facts. Deleting every chapter changes readability, never the facts.

Before → after (same test):

```ts
it('creates users from their Slack profile on first sight and links the transaction', async () => {
  await flow.given('U1 and U2 exist in Slack', () => {
    journey.slack.addUser({ id: 'U1', name: 'kevin.martinez', display_name: 'Kevin', /* … */ });
    addUsers('U2');
  });

  await flow.when('U1 gives U2 +++', () => journey.send({ text: '<@U2> +++', user: 'U1' }));

  await flow.then('both users are created and linked', async () => {
    const users = await journey.rows('select * from "user" order by provider_id');
    expect(users).toHaveLength(2);
    /* … */
  });
});
```

Recording:

```
given  U1 and U2 exist in Slack
when   U1 gives U2 +++
         POST /slack/events                                → 200
           → slack users.info U1  ok
           → db    insert into "user" … ×2
           → db    insert into "transaction" …
           → slack chat.postMessage "<@U2>'s apogee increased by 2…"
then   both users are created and linked                   ✔
         → db    select * from "user" …                    (read, collapsed)
```

## 4. Running it

```bash
FLOW_RECORD=1 npm test -- test/karma-journey   # local: writes .flow/report/ (index.html + OTLP JSON), gitignored
```

In CI it works like TWD recording: a PR label (`flow-recording`) triggers an action that runs the test files the PR added or modified with recording on, and posts the comment with their journeys.

## 5. Edge cases the contract states up front

- **Detached work** (a handler replies 202 and keeps going): async context keeps the post-response spans in the request's trace. The recording closes when the test ends **and** no span of its trace is still open. A span that ends after the test is shown as `⚠ after test end`, because it means the test is racy.
- **Invisible things**: in-memory fakes (an in-memory Redis mock, `jest.mock`'d modules) touch no instrumented library, so they produce no spans. Use a real service in a container, or wrap the call in `flow.span`.
