# nest-postgres-slack

The smallest backend with the three boundaries of the apogee-bot spike: an HTTP endpoint, a Postgres database through an ORM, and an external API.

| Endpoint | Flow |
|---|---|
| `POST /notes {user, text}` | Slack `users.info` → db insert into `note` → Slack `chat.postMessage` → 201 |
| `POST /notes` (unknown user) | Slack `users.info` → 404. Nothing is stored or posted |
| `GET /notes` | db select → 200 |

What is what:
- `src/`: the app. `src/instrumentation.ts` is its own OTel setup (NodeSDK + auto-instrumentations), with one line for flow recording.
- `test/`: its tests and test support. They know nothing about recording.
- `flow.config.mjs`: the app's own curation rule (hide MikroORM's `pg_database` check), on top of the renderer's defaults.

Flow recording itself lives in [`package/`](../../package/) and is imported as `flow-recording`. Every line this example adds for it is marked `← flow recording`.

Why this stack: MikroORM 7 is ESM and loads `pg` (CJS), which was the riskiest case for OTel patching inside Vitest. The Slack client uses plain `fetch`, mocked with msw, which is the case that needs the `fetch` seam.

```bash
npm install      # at the repo root (workspaces)
npm run db:up
npm run record   # .flow/recordings/<test>.json
npm run story    # <test>.raw.txt + <test>.story.txt
```

```
✔ notes › creates a note: looks up the author in Slack, stores it and announces it
  POST /notes {user: "U1", text: "hello"}                                                → 201
    → slack  POST /api/users.info {user: "U1"}                                           → 200
    db  + note {author: "kevin", text: "hello"}
    → slack  POST /api/chat.postMessage {channel: "CNOTES", text: "kevin wrote: hello"}  → 200
  db  read note
```

`npm start` runs the server against the same database. Slack calls then go to the real `SLACK_API_URL`, so set `SLACK_BOT_TOKEN` and `SLACK_CHANNEL` if you want to try it live.
