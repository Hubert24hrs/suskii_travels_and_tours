import { defineConfig } from 'prisma/config';

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
