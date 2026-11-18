import { once } from 'node:events';
import type { EventEmitter } from 'node:events';
import type pg from 'pg';
import request from 'supertest';
import { createApp } from '../src/app';
import { connectBroker, EXCHANGE, type Broker } from '../src/broker';
import { config } from '../src/config';
import { createPool } from '../src/db';
import { ordersService } from '../src/orders';
import { startPaymentsSubscriber } from '../src/subscriber';

// A queue the test reads to see what the app published
const PROBE = 'test.order-created';

describe('orders', () => {
  let pool: pg.Pool;
  let broker: Broker;
  let app: ReturnType<typeof createApp>;
  let payments: EventEmitter;

  beforeAll(async () => {
    pool = createPool(config.databaseUrl);
    broker = await connectBroker(config.rabbitUrl);
    const orders = ordersService(pool, broker);
    app = createApp(orders);
    payments = await startPaymentsSubscriber(broker, orders);
    await broker.channel.assertQueue(PROBE, { durable: true });
    await broker.channel.bindQueue(PROBE, EXCHANGE, 'order.created');
  });

  beforeEach(async () => {
    await pool.query('truncate orders, payments restart identity cascade');
    await broker.channel.purgeQueue(PROBE);
  });

  afterAll(async () => {
    await broker.connection.close();
    await pool.end();
  });

  // The next message on the probe queue (basic.get, polled: no consumer in the test)
  const published = async () => {
    for (let i = 0; i < 40; i++) {
      const msg = await broker.channel.get(PROBE, { noAck: true });
      if (msg) return JSON.parse(msg.content.toString());
      await new Promise((r) => setTimeout(r, 25));
    }
    return null;
  };

  const order = async (id: number) => (await pool.query('select * from orders where id = $1', [id])).rows[0];

  it('creates an order and publishes order.created', async () => {
    const response = await request(app).post('/orders').send({ item: 'book', quantity: 2 });

    expect(response.status).toBe(201);
    expect(await published()).toEqual({ orderId: 1, item: 'book', quantity: 2 });
  });

  it('marks the order paid when a payment arrives on the queue', async () => {
    await pool.query("insert into orders (item, quantity) values ('book', 2)");

    const handled = once(payments, 'handled');
    broker.publish('payment.received', { orderId: 1, amount: 25 });
    await handled;

    expect(await order(1)).toMatchObject({ status: 'paid' });
  });

  it('marks the order paid when the payment webhook arrives', async () => {
    await pool.query("insert into orders (item, quantity) values ('book', 2)");

    const response = await request(app).post('/webhooks/payments').send({ orderId: 1, amount: 25 });

    expect(response.status).toBe(204);
    expect(await order(1)).toMatchObject({ status: 'paid' });
  });

  it('rejects a payment webhook for an unknown order', async () => {
    const response = await request(app).post('/webhooks/payments').send({ orderId: 99, amount: 25 });

    expect(response.status).toBe(404);
  });
});
