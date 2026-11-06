import nock from 'nock';
import request from 'supertest';
import { createApp } from '../src/app';

describe('products', () => {
  const app = createApp();
  const catalog = () => nock('https://catalog.example.com');
  const pricing = () => nock('https://pricing.example.com');

  beforeAll(() => nock.disableNetConnect());
  beforeAll(() => nock.enableNetConnect('127.0.0.1'));
  afterEach(() => nock.cleanAll());
  afterAll(() => nock.enableNetConnect());

  it('combines the catalog product with its price', async () => {
    catalog().get('/products/42').reply(200, { id: 42, title: 'Mechanical keyboard', stock: 3, weightGrams: 900, supplier: 'acme' });
    pricing().get('/prices/42').reply(200, { productId: 42, amountInCents: 8999, currency: 'EUR' });

    const response = await request(app).get('/products/42');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: 42, name: 'Mechanical keyboard', price: '89.99 EUR', available: true });
  });

  it('returns 404 when the catalog does not know the product', async () => {
    catalog().get('/products/404').reply(404, { message: 'not found' });
    pricing().get('/prices/404').reply(404, { message: 'not found' });

    const response = await request(app).get('/products/404');

    expect(response.status).toBe(404);
  });

  it('shows the product without a price when pricing is down', async () => {
    catalog().get('/products/42').reply(200, { id: 42, title: 'Mechanical keyboard', stock: 0, weightGrams: 900, supplier: 'acme' });
    pricing().get('/prices/42').reply(503, { message: 'unavailable' });

    const response = await request(app).get('/products/42');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: 42, name: 'Mechanical keyboard', price: null, available: false });
  });
});
