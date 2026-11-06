import type pg from 'pg';
import type { Broker } from './broker';

// No business logic on purpose: each function is just a flow across the boundaries
export function ordersService(pool: pg.Pool, broker: Broker) {
  return {
    // db insert → publish order.created
    async create(item: string, quantity: number) {
      const { rows } = await pool.query('insert into orders (item, quantity) values ($1, $2) returning *', [item, quantity]);
      broker.publish('order.created', { orderId: rows[0].id, item, quantity });
      return rows[0];
    },

    // db select
    async get(id: number) {
      const { rows } = await pool.query('select * from orders where id = $1', [id]);
      return rows[0] ?? null;
    },

    // db update → db insert. Shared by the queue subscriber and the webhook.
    async markPaid(orderId: number, amount: number) {
      const { rowCount } = await pool.query("update orders set status = 'paid' where id = $1", [orderId]);
      if (!rowCount) return false;
      await pool.query('insert into payments (order_id, amount) values ($1, $2)', [orderId, amount]);
      return true;
    },
  };
}

export type Orders = ReturnType<typeof ordersService>;
