# Flow recording POC

Turn the OpenTelemetry trace of a backend flow test into something a PR reviewer reads in seconds: the backend version of [TWD recording](https://twd.dev/recording).

This repo holds:
- **[docs/discovery/](docs/discovery/README.md)**: the why, the what, the decisions, and the [pitch](docs/discovery/07-pitch.md).
- **[examples/](examples/)**: small backends with no business logic. Each exists only to produce one kind of flow, so we can work on instrumentation, curation and rendering against real traces.
- **[renderer/](renderer/)**: the POC renderer that turns a recording into a story view.

## Examples

| Example | Stack | Flows it records |
|---|---|---|
| [nest-postgres-slack](examples/nest-postgres-slack/) | NestJS 12, Express, MikroORM 7 → `pg`, Postgres, Slack API (`fetch`, mocked with msw), Vitest | `POST /notes` → Slack `users.info` → db insert → Slack `chat.postMessage` · `POST /notes` with an unknown user → Slack → 404, nothing stored · `GET /notes` → db select |

Next candidates: a queue (RabbitMQ), Redis, nock instead of msw, detached work after a 202, Jest instead of Vitest.

## How it works

Each example loads `test/support/flow-recording.ts` as its first Vitest setupFile. With `FLOW_RECORD=1` it:
1. starts an OTel tracer provider with an in-memory exporter, plus the auto-instrumentations (http, undici, pg, express);
2. opens one span per test and makes it the active context, so every span of the test nests under it;
3. wraps `fetch` on top of msw, because msw-mocked calls are otherwise invisible to OTel;
4. writes `.flow/recordings/<test>.txt` (raw span tree) and `<test>.json` (spans) after each test.

The tests themselves are not touched.

## Run an example

Requires Node 24 and Docker.

```bash
cd examples/nest-postgres-slack
npm install
npm run db:up        # Postgres on port 5440
npm test             # plain test run, nothing recorded
npm run record       # same tests, writes .flow/recordings/
node ../../renderer/story.mjs .flow/recordings/<test>.json
```
