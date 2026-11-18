# express-rabbit-postgres

Messaging flows: what the app publishes, and what it does with what it consumes, and the logs each flow writes. Express 5, `pg` without an ORM (parameterized queries), RabbitMQ through `amqplib`, pino, Vitest.

| Entry | Flow |
|---|---|
| `POST /orders {item, quantity}` | db insert → publish `order.created` → 201 |
| message `payment.received` on the `orders.payments` queue | consume → db update order → db insert payment |
| `POST /webhooks/payments {orderId, amount}` | the same function as the subscriber → 204, or 404 and a `warn` log for an unknown order |

The queue test is real end to end: the test publishes to RabbitMQ, the app's subscriber consumes it, and the test waits for the subscriber's `handled` event (no polling). The webhook test calls the same function through HTTP, so the two stories show the same work entering in two ways.

What is what:
- `src/`: the app. `src/instrumentation.ts` is its own OTel setup. Every line it adds for flow recording is marked `← flow recording`.
- `test/`: its tests. They know nothing about recording.
- `flow.config.mjs`: names the app `orders` in the story.

**What this example needed from the user's instrumentation.** OTel doesn't capture message bodies or query values by default, so `src/instrumentation.ts` turns on two options of the community instrumentations, only in tests (`NODE_ENV=test`, the app's own convention):
- `instrumentation-amqplib`: `publishHook` and `consumeHook` put the message body on the span.
- `instrumentation-pg`: `enhancedDatabaseReporting` records the values of `$1, $2…`.

**Logs.** The app logs with pino. pino's instrumentation sends each log through OTel, so `src/instrumentation.ts` adds `...flowRecording.logProcessors()` to its `logRecordProcessors`, next to its own exporter. It also registers OTel's ESM hook for pino (`register({ include: ['pino'] })`): pino's instrumentation replaces the package's export, which an app importing as ESM only sees with that hook.

```bash
npm install          # at the repo root (workspaces)
npm run infra:up     # Postgres on 5441, RabbitMQ on 5673
npm test && npm run story
```

```
✔ orders › marks the order paid when a payment arrives on the queue
  test → db        insert orders {item: "book", quantity: 2}
  test ⇢ rabbitmq  publish payment.received to shop {orderId: 1, amount: 25}
         rabbitmq ⇢ orders    consume payment.received {orderId: 1, amount: 25}
                    orders → db        update orders {status: "paid"} where id = 1
                    orders → db        insert payments {order_id: 1, amount: 25}
                    orders · info      order paid {orderId: 1, amount: 25}
  test → db        select orders where id = 1

✔ orders › rejects a payment webhook for an unknown order
  test → orders  POST /webhooks/payments {orderId: 99, amount: 25}
         orders → db      update orders {status: "paid"} where id = 99
         orders · warn    ⚠ payment for an unknown order {orderId: 99}
  test ← orders  404 ⚠
```
