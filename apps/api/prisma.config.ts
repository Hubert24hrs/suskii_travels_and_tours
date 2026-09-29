import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { defineConfig } from 'prisma/config';

// Prisma 7 no longer reads .env files. Load the repository's root .env for local commands; CI
// and production pass DATABASE_URL in the environment.
// Prisma commands run from apps/api (pnpm --filter @suskii/api ...).
const rootEnv = join(process.cwd(), '..', '..', '.env');
if (!process.env.DATABASE_URL && existsSync(rootEnv)) process.loadEnvFile(rootEnv);

// DATABASE_URL is only needed by migrate/seed commands; `prisma generate` runs without it.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://placeholder@localhost:5432/placeholder',
  },
});
