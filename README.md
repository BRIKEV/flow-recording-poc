# Flow recording POC

Turn the OpenTelemetry trace of a backend flow test into something a PR reviewer reads in seconds: the backend version of [TWD recording](https://twd.dev/recording).

```
✔ orders › rejects a payment webhook for an unknown order
  test → orders  POST /webhooks/payments {orderId: 99, amount: 25}
         orders → db      update orders {status: "paid"} where id = 99
         orders · warn    ⚠ payment for an unknown order {orderId: 99}
  test ← orders  404 ⚠
```

This repo is the package itself (`flow-recording`, in [`src/`](src/)) plus:
- **[examples/](examples/)**: small backends with no business logic. Each exists only to produce one kind of flow. They consume the package as a user would (`"flow-recording": "file:../.."`).
- **[docs/discovery/](docs/discovery/README.md)**: the why, the what, the decisions, and the [pitch](docs/discovery/07-pitch.md).

To understand the code: **[HOW-IT-WORKS.md](HOW-IT-WORKS.md)** follows one real test from `it()` to its story.

## Use it in a project

Requires Node 22+, Vitest 4, and an app that already sets up OpenTelemetry with `@opentelemetry/sdk-node` (SDK 3.x: `@opentelemetry/sdk-trace`, not `sdk-trace-base`).

```bash
npm i -D github:BRIKEV/flow-recording-poc
```

The repo is private: installing needs git access to it (SSH key, or `gh auth setup-git` for HTTPS).

**1. Add the processors to the app's own OTel setup.** They are inert outside the tests:

```ts
import { flowRecording } from 'flow-recording';

const sdk = new NodeSDK({
  instrumentations: [getNodeAutoInstrumentations()],
  spanProcessors: [...yourExporters, ...flowRecording.processors()],
  logRecordProcessors: [...flowRecording.logProcessors()], // optional: pino, winston, bunyan
});
```

**2. Load that file in the tests, then ours:**

```ts
// vitest.config.ts
setupFiles: ['./src/instrumentation.ts', 'flow-recording/vitest', ...yourSetupFiles],
```

**3. Run the tests, then render:**

```bash
npx vitest run                       # writes .flow/recordings/<test>.json
npx flow-recording .flow/recordings  # writes <test>.story.txt and prints the stories
npx flow-recording .flow/recordings --since main  # prints only the tests added or changed since main
```

`--since <ref>` keeps the tests a branch added or modified: a line changed since the merge-base with `<ref>` (committed or not, plus untracked files) falls inside the test's `it(…)` call. Changes outside every test (a helper, a hook) select none. It needs each test's line: set `includeTaskLocation: true` in the Vitest config; without it, any change to a spec file selects all its tests, and the CLI says so. What it prints is also written to `.flow/stories.txt`.

Add `.flow/` to `.gitignore`. There is no env var: loading `flow-recording/vitest` is what turns recording on.

**Optional: `flow.config.mjs`** in the project root, to make the stories read better:

```js
export default {
  sut: 'orders',                        // the app's name in the story (default: app)
  peers: { 'api.stripe.com': 'stripe' }, // name external hosts
  hide: [{ attributes: { 'db.query.text': /from pg_database/ } }],  // drop spans you don't care about
  logs: 'info',                         // or false, or { level, hide, show }
};
```

What it often needs from the app's instrumentation, only in tests, with the app's own convention (`NODE_ENV=test`):
- **Query values:** `enhancedDatabaseReporting: true` in `@opentelemetry/instrumentation-pg`.
- **Message bodies:** a `publishHook` / `consumeHook` in `@opentelemetry/instrumentation-amqplib`. See [the Rabbit example](examples/express-rabbit-postgres/src/instrumentation.ts).
- **pino logs, in an app that imports as ESM:** OTel's ESM hook, `register({ include: ['pino'] })` from `import-in-the-middle/register-hooks.mjs`.

If a library the app uses produced no spans, the CLI says so above the stories. Example: `⚠ pg was used but @opentelemetry/instrumentation-pg produced no spans`.

## The package

| Where | What |
|---|---|
| `src/index.js` (+ `index.d.ts`) | `flowRecording.processors()` / `logProcessors()`, the public API |
| `src/record/` | runs inside the tests: collects spans and logs, writes `.flow/recordings/` |
| `src/render/` | the CLI: turns recordings into stories |

Plain JavaScript, no build step: what is in `src/` is what gets installed. The user-facing parts are marked `PUBLIC API` in the code.

The package's own tests are in [`test/`](test/). `npm test` at the root runs them with Node's test runner, with no extra dependency and no Docker.

## Examples

| Example | Stack | Flows it records |
|---|---|---|
| [nest-postgres-slack](examples/nest-postgres-slack/) | NestJS 12, Express, MikroORM 7 → `pg`, Postgres, Slack API (`fetch`, mocked with msw), Vitest | `POST /notes` → Slack `users.info` → db insert → Slack `chat.postMessage` · `POST /notes` with an unknown user → Slack → 404, nothing stored · `GET /notes` → db select · CRUD on `/notes/:id`: get (or 404), update, delete |
| [express-rabbit-postgres](examples/express-rabbit-postgres/) | Express 5, `pg` (no ORM), Postgres, RabbitMQ (`amqplib`), pino, Vitest | `POST /orders` → db insert → publish `order.created` · `payment.received` consumed from a queue → db update + insert · the same work through a payment webhook · the logs each flow writes |
| [express-bff-third-party](examples/express-bff-third-party/) | Express 5, axios, two third-party APIs mocked with nock, Vitest | `GET /products/:id` → catalog + pricing in parallel → one view · catalog 404 · pricing down |

Each line an example adds for flow recording is marked `← flow recording`. Next candidates: Redis, detached work after a 202, Jest instead of Vitest.

Requires Node 24 and Docker:

```bash
npm install          # at the root: the package and every example (workspaces)
cd examples/nest-postgres-slack
npm run db:up        # Postgres on port 5440 (express-rabbit-postgres: npm run infra:up)
npm test             # runs the tests and writes .flow/recordings/<test>.json
npm run story        # writes <test>.raw.txt and <test>.story.txt, prints the stories
```
