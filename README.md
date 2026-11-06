# Flow recording POC

Turn the OpenTelemetry trace of a backend flow test into something a PR reviewer reads in seconds: the backend version of [TWD recording](https://twd.dev/recording).

This repo holds:
- **[docs/discovery/](docs/discovery/README.md)**: the why, the what, the decisions, and the [pitch](docs/discovery/07-pitch.md).
- **[examples/](examples/)**: small backends with no business logic. Each exists only to produce one kind of flow, so we can work on instrumentation, curation and rendering against real traces.
- **[package/](package/)**: what we would publish as `flow-recording`: the span processor, the Vitest integration and the renderer. Only this is ours. The examples consume it through npm workspaces, as a user would.

## Examples

| Example | Stack | Flows it records |
|---|---|---|
| [nest-postgres-slack](examples/nest-postgres-slack/) | NestJS 12, Express, MikroORM 7 → `pg`, Postgres, Slack API (`fetch`, mocked with msw), Vitest | `POST /notes` → Slack `users.info` → db insert → Slack `chat.postMessage` · `POST /notes` with an unknown user → Slack → 404, nothing stored · `GET /notes` → db select · CRUD on `/notes/:id`: get (or 404), update, delete |
| [express-rabbit-postgres](examples/express-rabbit-postgres/) | Express 5, `pg` (no ORM), Postgres, RabbitMQ (`amqplib`), Vitest | `POST /orders` → db insert → publish `order.created` · `payment.received` consumed from a queue → db update + insert · the same work through a payment webhook |
| [express-bff-third-party](examples/express-bff-third-party/) | Express 5, axios, two third-party APIs mocked with nock, Vitest | `GET /products/:id` → catalog + pricing in parallel → one view · catalog 404 · pricing down |

Next candidates: Redis, detached work after a 202, Jest instead of Vitest.

## How it works

**Bring your own OTel.** Each example has its own `src/instrumentation.ts`, as a real app would. Flow recording instruments nothing. It only collects what the app's instrumentation produces.

What an example adds to use it, each marked `← flow recording` in the code:
- `src/instrumentation.ts`: `...flowRecording.processors()` in its own `spanProcessors`.
- `vitest.config.mts`: `'flow-recording/vitest'` in `setupFiles`, right after the instrumentation.
- `package.json`: `record` (`FLOW_RECORD=1 vitest run`) and `story` (`flow-recording .flow/recordings`).
- `flow.config.mjs` (optional): its own curation rules.

Everything else in an example is the app and its tests, which are not touched. What each part of the package does: [package/README.md](package/README.md).

## Run an example

Requires Node 24 and Docker.

```bash
npm install          # at the root: installs the package and every example (workspaces)
cd examples/nest-postgres-slack
npm run db:up        # Postgres on port 5440 (express-rabbit-postgres: npm run infra:up)
npm test             # plain test run, nothing recorded
npm run record       # same tests, writes .flow/recordings/<test>.json
npm run story        # writes <test>.raw.txt and <test>.story.txt, prints the stories
```
