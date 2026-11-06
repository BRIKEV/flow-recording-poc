# flow-recording (the package)

Everything here is ours: what we would publish. The examples consume it as `flow-recording` through npm workspaces, the same way a user would.

## What the user touches

| Where | What | Used in |
|---|---|---|
| The app's OTel setup | `...flowRecording.processors()` in `spanProcessors` | `src/index.ts` |
| Vitest config | `'flow-recording/vitest'` in `setupFiles`, after the app's instrumentation | `src/vitest.ts` |
| Env var | `FLOW_RECORD=1` turns recording on. Without it, nothing runs | both |
| CLI | `flow-recording <recordings dir or .json> [--config flow.config.mjs]` | `src/story.mjs` |
| `flow.config.mjs` (optional) | curation rules: `show` / `hide` / `flatten` matchers and a `rule` function | `src/story.mjs` |

In the code, the user-facing parts are marked `PUBLIC API`. Everything else is internal.

## Files

- `src/index.ts`: the span processor. It numbers spans in start order (start timestamps only have millisecond precision) and keeps them in memory.
- `src/vitest.ts`: the runner integration. One span per test, hook vs body phase, test result and `describe` path, and `.flow/recordings/<test>.json`. Two test-only seams, because OTel doesn't capture bodies: `fetch` under msw, and request/response bodies through `http.ClientRequest` (supertest, or the app's outbound calls), tied to their client span by the `traceparent` header.
- `src/story.mjs`: the renderer. It writes `<test>.raw.txt` (every span) and `<test>.story.txt`: the trace, curated in three layers (our defaults, hooks hidden, the user's rules), read as messages between actors in the order they happened (`test → app`, `app → db`, `app ← slack`, `rabbitmq ⇢ app`). The line type comes from the OTel span kind (SERVER, CLIENT, PRODUCER, CONSUMER, db), so it is not specific to HTTP. It shows request and response payloads (at most 4 fields, then `… +N`), SQL as `insert / update / delete / select <table>` with its data (parsed from standard SQL), named peers and ×N for repeated lines.

Peer dependencies: `@opentelemetry/api`, `@opentelemetry/sdk-trace` (3.x, which replaces `sdk-trace-base`) and `vitest` 4. The app brings them.
