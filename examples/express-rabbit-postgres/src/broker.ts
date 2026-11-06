import amqp from 'amqplib';

// One topic exchange: the app publishes order events to it and consumes payments from it
export const EXCHANGE = 'shop';

export async function connectBroker(url: string) {
  const connection = await amqp.connect(url);
  const channel = await connection.createChannel();
  await channel.assertExchange(EXCHANGE, 'topic', { durable: false });
  const publish = (routingKey: string, payload: unknown) =>
    channel.publish(EXCHANGE, routingKey, Buffer.from(JSON.stringify(payload)), { contentType: 'application/json' });
  return { connection, channel, publish };
}

export type Broker = Awaited<ReturnType<typeof connectBroker>>;
