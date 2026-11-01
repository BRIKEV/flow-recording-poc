# Backend flow recording — discovery

Status: discovery, session 2 (2026-10-20). Direction: a recording is the OpenTelemetry trace of a flow test, rendered for the PR reviewer. Spike 1 (apogee-bot) passed, see 06. Next: spike 2 (nock, detached work, Jest).

| File | What it holds |
|---|---|
| [01-why.md](01-why.md) | The problem, and why a video doesn't carry over to the backend |
| [02-what.md](02-what.md) | What a backend recording is: its vocabulary, principles and outputs |
| [03-open-questions.md](03-open-questions.md) | Open questions, what the spike must verify, and decisions |
| [04-api.md](04-api.md) | Setup, the optional test API, and how it runs, as before/after on the karma journey |
| [05-outputs.md](05-outputs.md) | What the reviewer sees: formats judged, mockups of the comment, a diagram and the player |
| [06-spike-apogee.md](06-spike-apogee.md) | Spike 1: OTel inside apogee-bot's Vitest e2e tests, what worked and what it changes |
| [07-pitch.md](07-pitch.md) | One-page pitch for an OTel expert: the idea, the POC result, and the questions for them |

Reference material:
- Frontend precedent: `twd/docs/recording.md`. A paced video of the flow test, attached to the PR when it carries a label.
- Backend flow tests that look like what we want: `~/orbitant/new-apogee/apogee-bot/backend/test/karma-journey.e2e-spec.ts` with its harness `test/support/journey.ts`.
- A noisier backend flow test (not public): Express, nock, a Redis mock, a logger spy, polling, and detached work after a 202.
