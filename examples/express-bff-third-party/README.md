# express-bff-third-party

A BFF: one endpoint for the frontend that calls two third-party APIs in parallel and shapes their answers. Express 5, axios (Node's `http` underneath), mocked with nock, Vitest. No database.

| Endpoint | Flow |
|---|---|
| `GET /products/:id` | catalog `GET /products/:id` and pricing `GET /prices/:id` in parallel → one view → 200 |
| `GET /products/:id` (catalog 404) | both calls → 404 |
| `GET /products/:id` (pricing 503) | both calls → 200 without a price |

What it checks: nock-mocked calls are still seen by the http instrumentation (unlike msw with `fetch`, no seam needed for the spans), and parallel calls (`Promise.all`) are shown as parallel.

```bash
npm install          # at the repo root (workspaces)
npm run record && npm run story
```

```
✔ products › combines the catalog product with its price
  test → bff      GET /products/42
         bff → catalog  GET /products/42  ┐ in parallel
         bff → pricing  GET /prices/42    ┘
         bff ← catalog  200 {id: 42, title: "Mechanical keyboard", stock: 3, weightGrams: 900, … +1}
         bff ← pricing  200 {productId: 42, amountInCents: 8999, currency: "EUR"}
  test ← bff      200 {id: 42, name: "Mechanical keyboard", price: "89.99 EUR", available: true}
```
