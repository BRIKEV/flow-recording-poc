export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://flow:flow@localhost:5441/flow_test',
  rabbitUrl: process.env.RABBIT_URL ?? 'amqp://flow:flow@localhost:5673',
};
