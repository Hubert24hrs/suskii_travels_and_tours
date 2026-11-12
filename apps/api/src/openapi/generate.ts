// Writes openapi.json from the compiled app: `pnpm --filter @suskii/api openapi`.
// Boots the real module graph with placeholder connection strings; nothing connects (lazy clients).
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { loadConfig } from '../config/config';

import { buildOpenApiDocument } from './openapi';

async function main(): Promise<void> {
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgresql://openapi@localhost:5432/openapi',
    REDIS_URL: 'redis://localhost:6379',
    EMAIL_PROVIDER: 'mock',
  });
  const app = await NestFactory.create(AppModule.forRoot(config), { logger: false });
  await app.init();
  const document = buildOpenApiDocument(app);
  const target = resolve(__dirname, '../../openapi.json');
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
  await app.close();
  process.stdout.write(`OpenAPI document written to ${target}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
