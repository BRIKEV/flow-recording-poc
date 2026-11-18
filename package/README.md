# flow-recording (the package)

Everything here is ours: what we would publish. The examples consume it as `flow-recording` through npm workspaces, the same way a user would.

## What the user touches

| Where | What | Used in |
|---|---|---|
| The app's OTel setup | `...flowRecording.processors()` in `spanProcessors` | `src/index.ts` |
| The app's OTel setup (optional) | `...flowRecording.logProcessors()` in `logRecordProcessors`: logs from pino, winston, bunyan | `src/index.ts` |
| Vitest config | `'flow-recording/vitest'` in `setupFiles`, after the app's instrumentation | `src/vitest.ts` |
| CLI | `flow-recording <recordings dir or .json> [--config flow.config.mjs]` | `src/story.mjs` |
| `flow.config.mjs` (optional) | curation rules: `show` / `hide` / `flatten` matchers and a `rule` function; `logs`: which logs to show | `src/story.mjs` |

There is no env var. Loading `flow-recording/vitest` is what turns recording on; until then the processor is inert, so production never keeps a span.

In the code, the user-facing parts are marked `PUBLIC API`. Everything else is internal.

## Files

- `src/index.ts`: the span and log processors. Inert until activated. They number span starts, span ends and logs with one counter (start timestamps only have millisecond precision; ends tell parallel calls apart; a log lands between the calls around it), keep everything in memory and note which instrumentations produced something.
- `src/vitest.ts`: the runner integration. One span per test, hook vs body phase, test result and `describe` path, `.flow/recordings/<test>.json`, and `.flow/coverage/<file>.json`: boundary libraries (db, queues, caches, http clients) that were loaded and whether their instrumentation produced spans. The renderer warns about the ones that produced none. Two test-only seams, because OTel doesn't capture bodies: `fetch` under msw, and request/response bodies through `http.ClientRequest` (supertest, or the app's outbound calls), tied to their client span by the `traceparent` header. Each log goes on the span it was written in. Under Vitest, a package's main entry is resolved by its name, so OTel's ESM hook recognises it (Vitest imports dependencies by absolute path, and instrumentations that replace a package's export, like pino's, would skip it).
- `src/story.mjs`: the renderer. It writes `<test>.raw.txt` (every span) and `<test>.story.txt`: the trace, curated in three layers (our defaults, hooks hidden, the user's rules), read as messages between actors in the order they happened (`test → app`, `app → db`, `app ← slack`, `rabbitmq ⇢ app`). The line type comes from the OTel span kind (SERVER, CLIENT, PRODUCER, CONSUMER, db), so it is not specific to HTTP. It shows request and response payloads (at most 4 fields, then `… +N`), SQL as `insert / update / delete / select <table>` with its data (parsed from standard SQL), named peers, logs (`orders · warn  ⚠ …`; `logs` in `flow.config` picks which: off, a level, `hide` / `show` matchers) and ×N for repeated lines.

Peer dependencies: `@opentelemetry/api`, `@opentelemetry/sdk-trace` (3.x, which replaces `sdk-trace-base`), `vitest` 4, and optionally `@opentelemetry/sdk-logs` for logs. The app brings them.
