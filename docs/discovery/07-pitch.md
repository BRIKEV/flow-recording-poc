# Flow recording: OTel traces of our tests, rendered for PR review

> AI writes backend code faster than we can review it. What if every backend PR came with a picture of what the system **actually did** when its tests ran, built from OpenTelemetry?

## The problem

Writing code is no longer the bottleneck. Review is. For a backend PR, the reviewer has to rebuild by hand "when this request comes in, what happens now?": an endpoint, three layers, DB writes, two external calls. An AI-written PR description doesn't help: it's long, nobody can verify it, and it describes what the model *thinks* happens.

On the frontend we already solved this with TWD recording: label the PR, CI runs the flow test, and a video of the journey gets attached. The reviewer watches it in seconds. It's factual, because it comes from the test.

**A backend has no screen. Its "screen" is its boundaries**: what comes in, what goes out to other services, and what it writes. That's exactly what a trace is.

## The idea

**A recording is the OTel trace of a flow test, rendered for a reviewer.**

- Capture is a solved, standard problem: the OTel auto-instrumentations (pg, mongo, redis, kafka, amqp, http, express…), maintained by the community. We build **no adapters**.
- What's missing is the **connector**: test trace → something a human reads in 10 seconds in the PR.
- **Bring your own OTel.** We use the app's own instrumentation, so the recording shows exactly what the app emits, including its custom spans. We only add a span processor and a span per test. Teams without OTel get a preset.
- Deterministic, no AI: same code + same tests → the same recording.

What a team does: two lines.

```diff
  // src/instrumentation.ts (the app's)
  spanProcessors: [
    new BatchSpanProcessor(new OTLPTraceExporter()),
+   ...flowRecording.processors(),      // empty unless FLOW_RECORD=1
  ],

  // vitest.config.ts
- setupFiles: ['./test/setup.ts'],
+ setupFiles: ['./src/instrumentation.ts', 'flow-recording/vitest', './test/setup.ts'],
```

The tests stay **untouched**. Working example: `examples/nest-postgres-slack`.

## The POC: it works

Spike on a real service (apogee-bot: NestJS 12, Express 5, MikroORM 7 → `pg`, msw mocking Slack, Vitest 4). 20 existing e2e tests, **zero changes to the tests**:

| Check | Result |
|---|---|
| Instrumentation patches modules inside Vitest (ESM MikroORM → CJS `pg`) | ✔ a plain setupFile is enough, with no `--import` loader |
| One trace per test (test span → supertest → server → handler → DB) | ✔ |
| Every SQL statement, nested under the request that caused it | ✔ |
| Outbound calls mocked by msw | ✔ after a fix: msw replaces `fetch`, so undici never sees the call, and wrapping `fetch` on top of msw solves it |
| Deterministic | ✔ byte-identical over 2 full runs (after normalizing ephemeral ports) |

This is a real test from the suite, unchanged, rendered from its spans by a 40-line filter:

```
rejects every positive transaction of a message that would exceed the giving limit
  db  insert into "transaction" …                      ← given (the seed)
  POST /slack/events → 200                             ← when (the trigger)
    → slack users.info 200                             (×4, each followed by insert "user")
    db  (read) select coalesce(sum(amount), 0) … > 0   ← the limit check
    db  insert into "transaction" …                    ← only one: U4's negative
    → slack chat.postMessage 200                       ← limit warning
    → slack chat.postMessage 200                       ← U4's reply
  db  (read) select … from "transaction"               ← then (the assertions)
```

A reviewer gets the behaviour without reading the code. **given / when / then fall out of span position**, with no annotations.

## What it would look like in a PR

Label the PR, and CI records the tests the PR added or modified, then posts one comment: a story view per flow, a Mermaid sequence diagram (rendered natively by GitHub) collapsed under it, and a link to a step-by-step player. Mockups are in [05-outputs.md](05-outputs.md).

Later, and this is the part no video can do: record `main` too and **diff the behaviour**. "`POST /slack/events` now also calls `chat.postEphemeral` and no longer posts the limit warning to the channel."

## Where you come in: the OTel questions I can't answer well

1. **Joining the app's SDK.** Today it takes one line in the app's `instrumentation.ts`, because SDK 2.x has no `addSpanProcessor`. Is an in-process OTLP receiver (zero touch, via `OTEL_EXPORTER_OTLP_ENDPOINT`) worth the batching and flush cost? And what about Vitest/Jest isolation re-running `sdk.start()` per test file?
2. **Mock seams.** I wrapped `fetch` to see msw calls. Is there a cleaner OTel-native route (undici diagnostics channel, a span processor, msw/interceptors events)? And nock, which patches `http`, against the http instrumentation?
3. **"When is the trace done?"** Detached work after a 202 should stay in the recording. Tracking open spans in a SpanProcessor? Context propagation through queues and timers?
4. **Noise vs signal.** About 30 spans per test → 5 lines in the story. Curation is written against semconv, not libraries (defaults + hook phase + user rules: `show`/`hide`/`flatten`), so semconv is effectively our adapter. Which attributes can we rely on across instrumentation versions (`db.query.text` vs `db.statement`, the stable-semconv migration)? Are scope name and span kind a sound axis?
5. **Gaps.** The Nest instrumentation emitted nothing on Nest 12. Jest's module registry is untested. What breaks first?
6. **Determinism.** Span start times come from `Date.now()` (ms) while end times use `performance.now()`, so siblings started in the same millisecond tie and swap between runs. I number spans in our processor's `onStart` and order by that. Is there a cleaner way, or something else in the SDK that fights us?
7. **Linking spans to test lines**, for a view that annotates the test source with what each line caused.

## Where I come in: testing and devexp

- _TODO: flow-test design (what makes a test recordable), harness patterns, TWD's label → PR artifact loop._
- _TODO: devexp budget: one line per repo, zero per test, opt-in per PR, degrades gracefully._
- _TODO: the reviewer's side: what's readable in 10 seconds, and when the comment is enough versus when to open the player._

## Next

1. Spike 2 on a noisier service: Express + nock + detached work after a 202 + Jest. Is the idea still real there?
2. Prototype the renderer: story view + Mermaid + PR comment, on the apogee recordings.
3. Decide together how we join the app's SDK: one line in its file, or an OTLP receiver.

The full notes are in this folder: [01-why](01-why.md) · [02-what](02-what.md) · [03-open-questions](03-open-questions.md) · [04-api](04-api.md) · [05-outputs](05-outputs.md) · [06-spike-apogee](06-spike-apogee.md).
