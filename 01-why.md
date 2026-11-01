# Why

## The bottleneck has moved

Writing code is no longer the slow part. **Understanding it in review** is. AI makes the diff bigger and faster, and the reviewer still has to work out the same thing by hand:

> "When this request comes in, what happens now that didn't happen before?"

On the backend the answer is spread out. One endpoint receives input, validates it, branches on business rules, reads and writes the database, calls two services and publishes to a queue. In the diff that is five files and three layers. The behaviour exists only in the reviewer's head, after they have rebuilt it.

## Prose doesn't fix it

An AI-written PR description is:
- **long.** It costs reading time, which is the scarce resource here;
- **unverifiable.** It describes what the author (or the model) *thinks* happens, not what ran;
- **non-deterministic.** Run it twice and you get two descriptions, so two PRs can't be compared.

What a reviewer can trust is evidence produced by **executing** the code.

## The frontend already solved it

TWD recording: label the PR, CI runs the flow test, a paced video is attached. The reviewer *watches* the journey. It works because:
1. it comes from the test, so it is factual;
2. it is the user's journey, not the code structure;
3. it takes seconds to consume;
4. it is opt-in per PR (a label) and costs the author nothing extra.

## Why a video doesn't carry over to the backend

A backend has no screen. Its "screen" is its **boundaries**: what comes in, what goes out to other systems, and what state changed. A backend recording is therefore not pixels. It is the **timeline of boundary crossings plus the state diff**, drawn so that a person can read it in a few seconds.

## What we already have

Our backend tests are already flow tests (apogee `karma-journey`, and the flow tests of a second, noisier Express service). They:
- start from a real entry point (HTTP, a signed Slack event);
- mock only the outside world (msw/nock for HTTP, the Slack mock);
- assert on externally visible effects (DB rows, posted messages, the response).

So **the journey is already written down.** It just isn't visible. A reviewer has to read the test code and mentally replay it, and that test code is full of setup noise (`nock.cleanAll`, logger spies, `waitUntil`).

## The value proposition, in one line

> Turn the flow tests you already have into a deterministic, diffable picture of *what the system does*, so that reviewing a backend PR means reading a diagram, not rebuilding a mental model.

Capture is already a solved, standard problem: OpenTelemetry. The missing piece is the connector that turns a test's trace into something a reviewer reads in seconds. That connector is what we build.

## Later: what backend can have that video can't, the diff

Not in the MVP. The MVP is the recording alone, as in TWD.

A video can't be diffed. A structured recording can. Record the same test on `main` and on the PR, compare the two, and you get:

> "`POST /slack/events` now **also calls** `chat.postEphemeral` and **no longer posts** the limit warning to the channel."

This is probably the killer feature. It is the backend equivalent of the screenshot diff, and it answers the reviewer's question directly.
