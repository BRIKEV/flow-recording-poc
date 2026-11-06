import axios from 'axios';
import express from 'express';
import { config } from './config';

// Two third-party APIs, called with axios (Node's http module underneath)
const catalog = axios.create({ baseURL: config.catalogUrl });
const pricing = axios.create({ baseURL: config.pricingUrl });

export function createApp() {
  const app = express();

  // endpoint → catalog + pricing in parallel → one view for the frontend.
  // Pricing is optional: if it fails, the product is shown without a price.
  app.get('/products/:id', async (req, res) => {
    const id = req.params.id;
    const [product, price] = await Promise.all([
      catalog.get(`/products/${id}`).then((r) => r.data).catch((e) => (e.response?.status === 404 ? null : Promise.reject(e))),
      pricing.get(`/prices/${id}`).then((r) => r.data).catch(() => null),
    ]);
    if (!product) return void res.status(404).json({ error: 'product not found' });

    res.json({
      id: product.id,
      name: product.title,
      price: price ? `${(price.amountInCents / 100).toFixed(2)} ${price.currency}` : null,
      available: product.stock > 0,
    });
  });

  return app;
}
