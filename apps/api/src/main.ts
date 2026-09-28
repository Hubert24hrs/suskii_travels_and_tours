// Must stay first: OpenTelemetry patches modules as they load.
import './telemetry/register';

import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { APP_CONFIG, loadDevelopmentEnvFile, type AppConfig } from './config/config';

async function bootstrap(): Promise<void> {
  loadDevelopmentEnvFile();
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(), {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  const config = app.get<AppConfig>(APP_CONFIG);
  configureApp(app, config);
  await app.listen(config.API_PORT);
  app.get(Logger).log(`API listening on port ${config.API_PORT}`, 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  // Logger may not exist yet (e.g. invalid config); write a single structured line.
  process.stderr.write(
    `${JSON.stringify({ level: 'fatal', msg: error instanceof Error ? error.message : 'Bootstrap failed' })}\n`,
  );
  process.exit(1);
});
