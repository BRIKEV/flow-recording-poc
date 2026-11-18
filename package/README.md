# flow-recording (the package)

Everything here is ours: what we would publish. The examples consume it as `flow-recording` through npm workspaces, the same way a user would.

## What the user touches

| Where | What | Used in |
|---|---|---|
| The app's OTel setup | `...flowRecording.processors()` in `spanProcessors` | `src/index.ts` |
| Vitest config | `'flow-recording/vitest'` in `setupFiles`, after the app's instrumentation | `src/vitest.ts` |
| CLI | `flow-recording <recordings dir or .json> [--config flow.config.mjs]` | `src/story.mjs` |
| `flow.config.mjs` (optional) | curation rules: `show` / `hide` / `flatten` matchers and a `rule` function | `src/story.mjs` |

There is no env var. Loading `flow-recording/vitest` is what turns recording on; until then the processor is inert, so production never keeps a span.

In the code, the user-facing parts are marked `PUBLIC API`. Everything else is internal.

## Files

- `src/index.ts`: the span processor. Inert until activated. It numbers span starts and ends with one counter (start timestamps only have millisecond precision; ends tell parallel calls apart), keeps spans in memory and notes which instrumentations produced spans.
- `src/vitest.ts`: the runner integration. One span per test, hook vs body phase, test result and `describe` path, `.flow/recordings/<test>.json`, and `.flow/coverage/<file>.json`: boundary libraries (db, queues, caches, http clients) that were loaded and whether their instrumentation produced spans. The renderer warns about the ones that produced none. Two test-only seams, because OTel doesn't capture bodies: `fetch` under msw, and request/response bodies through `http.ClientRequest` (supertest, or the app's outbound calls), tied to their client span by the `traceparent` header.
- `src/story.mjs`: the renderer. It writes `<test>.raw.txt` (every span) and `<test>.story.txt`: the trace, curated in three layers (our defaults, hooks hidden, the user's rules), read as messages between actors in the order they happened (`test → app`, `app → db`, `app ← slack`, `rabbitmq ⇢ app`). The line type comes from the OTel span kind (SERVER, CLIENT, PRODUCER, CONSUMER, db), so it is not specific to HTTP. It shows request and response payloads (at most 4 fields, then `… +N`), SQL as `insert / update / delete / select <table>` with its data (parsed from standard SQL), named peers and ×N for repeated lines.

Peer dependencies: `@opentelemetry/api`, `@opentelemetry/sdk-trace` (3.x, which replaces `sdk-trace-base`) and `vitest` 4. The app brings them.
