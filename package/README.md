# flow-recording (the package)

Everything here is ours: what we would publish. The examples consume it as `flow-recording` through npm workspaces, the same way a user would.

**To understand the code, start with [HOW-IT-WORKS.md](HOW-IT-WORKS.md)**: one real test followed from `it()` to its story, with the file that acts at each step.

## What the user touches

| Where | What | File |
|---|---|---|
| The app's OTel setup | `...flowRecording.processors()` in `spanProcessors` | `src/index.ts` |
| The app's OTel setup (optional) | `...flowRecording.logProcessors()` in `logRecordProcessors`: logs from pino, winston, bunyan | `src/index.ts` |
| Vitest config | `'flow-recording/vitest'` in `setupFiles`, after the app's instrumentation | `src/record/vitest.ts` |
| CLI | `flow-recording <recordings dir or .json> [--config flow.config.mjs]` | `src/render/cli.mjs` |
| `flow.config.mjs` (optional) | curation: `show` / `hide` / `flatten` matchers, a `rule` function, `logs` | `src/render/curate.mjs` |

There is no env var. Loading `flow-recording/vitest` is what turns recording on; until then the processors are inert, so production never keeps a span.

In the code, the user-facing parts are marked `PUBLIC API`. Everything else is internal.

## Files

Two halves that never run together. Between them sits `.flow/recordings/<test>.json`, a readable JSON.

```
src/
  index.ts              the public API: flowRecording.processors() / logProcessors()
  record/               runs inside the tests
    processor.ts          keeps spans and logs, numbers them with one counter (the exact order)
    vitest.ts             the test lifecycle: beforeEach / afterEach / afterAll, calls the rest
    recording.ts          one test's spans and logs as JSON: order, hook or test, logs, bodies
    coverage.ts           which loaded libraries produced nothing
    esm-entry.ts          fix: Vitest imports by path, so OTel's ESM hook would miss pino
    seams/                what OTel doesn't capture (test only)
      http-bodies.ts        request and response bodies of any http client
      fetch.ts              fetch calls mocked with msw
  render/               runs after, as the CLI
    cli.mjs               reads recordings, writes .story.txt and .raw.txt
    spans.mjs             what every span gives us, and the spans as a tree
    curate.mjs            which spans and logs make it into the story
    describe.mjs          what each one says (span kind → message)
    payload.mjs           JSON bodies, short
    sql.mjs               SQL as data
    layout.mjs            the story: actors, arrows, indentation, parallel, ×N
    raw.mjs               the uncurated tree
    coverage.mjs          the warning about libraries that produced nothing
```

Peer dependencies: `@opentelemetry/api`, `@opentelemetry/sdk-trace` (3.x, which replaces `sdk-trace-base`), `vitest` 4, and optionally `@opentelemetry/sdk-logs` for logs. The app brings them.
