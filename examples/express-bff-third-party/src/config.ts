export const config = {
  port: Number(process.env.PORT ?? 3000),
  catalogUrl: process.env.CATALOG_URL ?? 'https://catalog.example.com',
  pricingUrl: process.env.PRICING_URL ?? 'https://pricing.example.com',
};
