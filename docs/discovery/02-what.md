# What

**The product is a connector:** OpenTelemetry already captures what a backend does. We connect the trace of a flow test to the PR reviewer and render it so that it can be read in seconds. We own the rendering and the diff; we don't own capture.

## A recording

One recording per test (`it`). It is **the OpenTelemetry trace of that test, rendered for a reviewer**. We don't capture anything ourselves: the OTel auto-instrumentations do, and we turn their spans into a picture.

| Kind | Example | Source |
|---|---|---|
| **trigger** | `POST /slack/events` → `200` | server span (http / Express / Nest instrumentation) |
| **call** | `→ slack users.info U1` → `ok` | HTTP client span (http / undici) |
| **db** | `insert into "transaction" (…)` | db span (pg, mysql2, mongodb, ioredis, …) |
| **publish / consume** | `→ rabbit karma.given` | messaging span (amqplib, kafkajs, Azure SDK) |
| **chapter** | `when U1 gives U2 +++` | optional test span (`flow.given/when/then/span`) |
| **check** | `✔ 5 checks` | the runner's test result |

Lanes: **actor / SUT / one per peer**. A peer comes from span attributes (`server.address`, `db.system`, `messaging.system`), and an unnamed peer is shown as its host.

### Principles

1. **Facts are captured; words are optional.** Every fact comes from a span. The author's words exist only as optional chapters, and a chapter wraps code that actually runs.
2. **We are the connector, not the instrumenter. Bring your own OTel.** The app's own instrumentation decides what is captured; we add a span processor and a span per test. We write no per-library capture code; that is the OTel community's job. We only instrument **platform and mock seams** (`fetch` under msw, probably nock's `http`), never libraries. Spike 1 showed that msw-mocked calls are otherwise invisible.
3. **Built for review attention.** The reviewer decides in 5 seconds, reads in 30 seconds, and digs in only if something looks off. Every output serves one of those three levels (see [05-outputs.md](05-outputs.md)).
4. **Highlight writes, collapse reads.** v1 shows DB statements, with writes highlighted and reads collapsed. A row-level state diff (per DB engine, not per library) comes later.
5. **Deterministic, no AI.** Same code + same tests → the same comment, byte for byte. Everything is execution, normalization and plain diff/set algorithms.

### Determinism

The same code and the same test must give byte-identical recordings, or the diff is useless. So:
- trace/span ids and durations are dropped;
- events are ordered by causality (parent/child, then start order), not by wall clock;
- UUIDs become `<uuid#1>`, and timestamps are taken from the fake clock or become `<t+3ms>`;
- the author can mark extra fields as volatile.

## The outputs (the "video")

MVP: **record, don't diff.** As in TWD, the recording is an extra pair of eyes on the journey the PR's tests validate. Mockups are in [05-outputs.md](05-outputs.md).

1. **PR comment**: the journeys of the tests **added or modified in this PR** (the test files touched by the PR diff). For each test, a story view (one line per span) with a collapsed Mermaid diagram, plus a link to the player.
2. **Flow player**: `.flow/report/index.html`, the backend equivalent of the TWD video. In the MVP it is local plus a CI artifact; a hosted page per PR comes later. It steps through the spans (or plays them paced), shows payloads and SQL on click, and has an **annotated test** view: the test source with what each line caused under it.
3. **Raw OTLP JSON** in the same folder, so Jaeger or Grafana Tempo can open the same trace.

Same delivery as TWD: a PR label, then CI runs the tests with recording on, then the comment. The report is CI output (gitignored, like `.twd/report/`). Nothing is committed to the repo.

**What a team needs:** two lines. Our processor goes into the app's own OTel setup, and that setup is loaded in the tests too (see [04-api.md](04-api.md)). A team without OTel gets a preset with the standard auto-instrumentations.

**Later: the behaviour diff against base.** Record the merge-base too and diff the two runs line by line ("now also calls X, no longer writes Y"). It is powerful, but harder to explain, so it isn't in the MVP. The determinism rules above keep that door open.

How it's used, and the API: [04-api.md](04-api.md).

## Out of scope (for now)

- Replacing tests or generating assertions.
- Writing instrumentation. We consume OTel's.
- Being a production APM. We read the traces a test run produces, not production traffic.
- A custom runner.
