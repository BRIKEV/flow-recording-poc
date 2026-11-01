import { MikroORM } from '@mikro-orm/postgresql';
import { configFromEnv } from '../../src/config';
import { ormOptions } from '../../src/orm.config';

// No migrations: recreate the schema from the entities once per run
export default async function setup(): Promise<void> {
  const orm = await MikroORM.init(ormOptions(configFromEnv().DATABASE_URL));
  await orm.schema.refresh();
  await orm.close();
}
