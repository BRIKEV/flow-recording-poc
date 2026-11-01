import { MikroOrmModule } from '@mikro-orm/nestjs';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { Global, Module } from '@nestjs/common';
import { CONFIG, configFromEnv, type Config } from './config';
import { NotesController } from './notes.controller';
import { ormOptions } from './orm.config';
import { SlackClient } from './slack.client';

@Global()
@Module({
  providers: [{ provide: CONFIG, useFactory: () => configFromEnv() }],
  exports: [CONFIG],
})
export class ConfigModule {}

@Module({
  imports: [
    ConfigModule,
    MikroOrmModule.forRootAsync({
      driver: PostgreSqlDriver,
      inject: [CONFIG],
      useFactory: (config: Config) => ormOptions(config.DATABASE_URL),
    }),
  ],
  controllers: [NotesController],
  providers: [SlackClient],
})
export class AppModule {}
