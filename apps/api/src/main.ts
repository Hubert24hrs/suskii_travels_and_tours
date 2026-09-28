import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { configureApp } from './app.setup';

const DEFAULT_PORT = 4000;

async function bootstrap(): Promise<void> {
  const app = configureApp(await NestFactory.create(AppModule));
  app.enableShutdownHooks();

  const port = Number.parseInt(process.env.API_PORT ?? `${DEFAULT_PORT}`, 10);
  await app.listen(port);
  Logger.log(`API listening on port ${port}`, 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  Logger.error(error instanceof Error ? error.message : 'Unknown bootstrap failure', 'Bootstrap');
  process.exit(1);
});
