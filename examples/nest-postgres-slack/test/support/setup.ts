import 'reflect-metadata';
import { MikroORM } from '@mikro-orm/postgresql';
import { configFromEnv } from '../../src/config';
import { ormOptions } from '../../src/orm.config';

let orm: MikroORM;

beforeAll(async () => {
  orm = await MikroORM.init(ormOptions(configFromEnv().DATABASE_URL));
});

beforeEach(async () => {
  await orm.schema.clear();
});

afterAll(async () => {
  await orm.close();
});
