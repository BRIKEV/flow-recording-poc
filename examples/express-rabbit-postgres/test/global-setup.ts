import { config } from '../src/config';
import { createPool, schema } from '../src/db';

// No migrations: create the schema once per run
export default async function setup(): Promise<void> {
  const pool = createPool(config.databaseUrl);
  await pool.query(schema);
  await pool.end();
}
