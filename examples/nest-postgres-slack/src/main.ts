import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { CONFIG, type Config } from './config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(app.get<Config>(CONFIG).PORT);
}
bootstrap();
