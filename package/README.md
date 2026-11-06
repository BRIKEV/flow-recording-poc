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
- `src/vitest.ts`: the runner integration. One span per test, hook vs body phase, test result and `describe` path, and `.flow/recordings/<test>.json`. Two test-only seams, because OTel doesn't see them: `fetch` under msw, and request bodies written through `http.ClientRequest` (supertest, or the app's outbound calls), tied to their client span by the `traceparent` header.
- `src/story.mjs`: the renderer. It writes `<test>.raw.txt` (every span) and `<test>.story.txt`: the trace, curated in three layers (our defaults, hooks hidden, the user's rules) and kept nested as in the trace, with request payloads, writes as data (`+ note {…}`, `~ t {…} where …`, `- t where …`, parsed from standard SQL), reads as `read <table> where …`, named peers and ×N for repeated lines.

Peer dependencies: `@opentelemetry/api`, `@opentelemetry/sdk-trace` (3.x, which replaces `sdk-trace-base`) and `vitest` 4. The app brings them.
