import { EventEmitter } from 'node:events';
import { EXCHANGE, type Broker } from './broker';
import type { Orders } from './orders';

export const PAYMENTS_QUEUE = 'orders.payments';

// payment.received → orders.markPaid. Emits 'handled' once a message is acked, so tests
// (and anything else) can wait for it instead of polling.
export async function startPaymentsSubscriber(broker: Broker, orders: Orders) {
  const events = new EventEmitter();
  await broker.channel.assertQueue(PAYMENTS_QUEUE, { durable: true });
  await broker.channel.bindQueue(PAYMENTS_QUEUE, EXCHANGE, 'payment.received');
  await broker.channel.consume(PAYMENTS_QUEUE, async (msg) => {
    if (!msg) return;
    const { orderId, amount } = JSON.parse(msg.content.toString());
    await orders.markPaid(orderId, amount);
    broker.channel.ack(msg);
    events.emit('handled', { orderId });
  });
  return events;
}
