# nest-postgres-slack

The smallest backend with the three boundaries of the apogee-bot spike: an HTTP endpoint, a Postgres database through an ORM, and an external API.

| Endpoint | Flow |
|---|---|
| `POST /notes {user, text}` | Slack `users.info` → db insert into `note` → Slack `chat.postMessage` → 201 |
| `POST /notes` (unknown user) | Slack `users.info` → 404. Nothing is stored or posted |
| `GET /notes` | db select → 200 |

Why this stack: MikroORM 7 is ESM and loads `pg` (CJS), which was the riskiest case for OTel patching inside Vitest. The Slack client uses plain `fetch`, mocked with msw, which is the case that needs the `fetch` seam.

```bash
npm install
npm run db:up
npm run record
node ../../renderer/story.mjs .flow/recordings/creates-a-note-looks-up-the-author-in-slack-stores-it-and-announces-it.json
```

`npm start` runs the server against the same database. Slack calls then go to the real `SLACK_API_URL`, so set `SLACK_BOT_TOKEN` and `SLACK_CHANNEL` if you want to try it live.
