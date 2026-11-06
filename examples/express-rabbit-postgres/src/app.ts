import express from 'express';
import type { Orders } from './orders';

export function createApp(orders: Orders) {
  const app = express();
  app.use(express.json());

  // endpoint → db insert → publish order.created
  app.post('/orders', async (req, res) => {
    const order = await orders.create(req.body.item, req.body.quantity);
    res.status(201).json(order);
  });

  // endpoint → db select
  app.get('/orders/:id', async (req, res) => {
    const order = await orders.get(Number(req.params.id));
    if (!order) return void res.status(404).json({ error: 'order not found' });
    res.json(order);
  });

  // webhook from the payment provider → the same function the queue subscriber calls
  app.post('/webhooks/payments', async (req, res) => {
    const paid = await orders.markPaid(req.body.orderId, req.body.amount);
    res.status(paid ? 204 : 404).end();
  });

  return app;
}
