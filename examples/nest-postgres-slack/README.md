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
- `flow-recording/`: what would become the package. It collects spans and writes recordings; it instruments nothing.
- `flow.config.mjs`: the app's own curation rule (hide MikroORM's `pg_database` check), on top of the renderer's defaults.

Why this stack: MikroORM 7 is ESM and loads `pg` (CJS), which was the riskiest case for OTel patching inside Vitest. The Slack client uses plain `fetch`, mocked with msw, which is the case that needs the `fetch` seam.

```bash
npm install
npm run db:up
npm run record   # .flow/recordings/<test>.json
npm run story    # <test>.raw.txt + <test>.story.txt
```

```
creates a note: looks up the author in Slack, stores it and announces it
  POST /notes → 201
    → slack.com POST /api/users.info → 200
    db  insert into "note" ("author", "text") values (…)
    → slack.com POST /api/chat.postMessage → 200
  db  (read) select "n0".* from "note" as "n0" order by "n0"."id" asc
```

`npm start` runs the server against the same database. Slack calls then go to the real `SLACK_API_URL`, so set `SLACK_BOT_TOKEN` and `SLACK_CHANNEL` if you want to try it live.
