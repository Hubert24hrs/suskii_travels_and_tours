import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';

declare global {
  var __E2E_CONTAINERS__: (StartedPostgreSqlContainer | StartedRedisContainer)[] | undefined;
}

/**
 * Starts throwaway Postgres 16 and Redis 7.4 containers (the docker-compose versions) and applies
 * the migrations. Set E2E_DATABASE_URL / E2E_REDIS_URL to reuse running services instead (the
 * database is truncated between test files, so never point these at data you care about).
 */
export default async function globalSetup(): Promise<void> {
  const containers: (StartedPostgreSqlContainer | StartedRedisContainer)[] = [];
  if (!process.env.E2E_DATABASE_URL) {
    const postgres = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('suskii_e2e')
      .withUsername('suskii')
      .withPassword('suskii_e2e')
      .start();
    containers.push(postgres);
    process.env.E2E_DATABASE_URL = postgres.getConnectionUri();
  }
  if (!process.env.E2E_REDIS_URL) {
    const redis = await new RedisContainer('redis:7.4-alpine').start();
    containers.push(redis);
    process.env.E2E_REDIS_URL = redis.getConnectionUrl();
  }
  globalThis.__E2E_CONTAINERS__ = containers;

  // Cross-platform: run the Prisma CLI with the current Node binary.
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd: join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL },
    stdio: 'pipe',
  });
}
