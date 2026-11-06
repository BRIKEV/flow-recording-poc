import { createApp } from './app';
import { connectBroker } from './broker';
import { config } from './config';
import { createPool, schema } from './db';
import { ordersService } from './orders';
import { startPaymentsSubscriber } from './subscriber';

async function main() {
  const pool = createPool(config.databaseUrl);
  await pool.query(schema);
  const broker = await connectBroker(config.rabbitUrl);
  const orders = ordersService(pool, broker);
  await startPaymentsSubscriber(broker, orders);
  createApp(orders).listen(config.port, () => console.log(`orders on :${config.port}`));
}

void main();
