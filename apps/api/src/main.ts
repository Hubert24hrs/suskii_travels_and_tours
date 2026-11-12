// Must stay first: loads the local .env, then OpenTelemetry patches modules as they load.
import './telemetry/register';

import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { APP_CONFIG, type AppConfig } from './config/config';
import { ErrorReporter } from './telemetry/error-reporter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(), {
    bufferLogs: true,
    // Payment webhooks verify signatures over the exact request bytes.
    rawBody: true,
  });
  app.useLogger(app.get(Logger));
  reportCrashes(app.get(Logger), app.get(ErrorReporter));
  const config = app.get<AppConfig>(APP_CONFIG);
  configureApp(app, config);
  await app.listen(config.API_PORT);
  app.get(Logger).log(`API listening on port ${config.API_PORT}`, 'Bootstrap');
}

/**
 * An exception nothing caught (including an unhandled rejection, which Node raises as one) is
 * logged and reported, then the process exits as it would have: the platform restarts it.
 */
function reportCrashes(logger: Logger, errors: ErrorReporter): void {
  process.once('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaught exception', 'Process');
    setTimeout(() => process.exit(1), 2000).unref();
    void errors.capture(error, { kind: 'uncaught' }).finally(() => process.exit(1));
  });
}

bootstrap().catch((error: unknown) => {
  // Logger may not exist yet (e.g. invalid config); write a single structured line.
  process.stderr.write(
    `${JSON.stringify({ level: 'fatal', msg: error instanceof Error ? error.message : 'Bootstrap failed' })}\n`,
  );
  process.exit(1);
});
