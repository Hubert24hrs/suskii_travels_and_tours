/**
 * Loads airline names and logos from Duffel's reference data into the `airlines` table (ADR-006).
 * Needs DATABASE_URL and DUFFEL_API_TOKEN.
 *
 *   pnpm --filter @suskii/api airlines:sync
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../src/generated/prisma/client';
import { syncDuffelAirlines } from '../src/suppliers/duffel/duffel-airlines';
import { DuffelClient } from '../src/suppliers/duffel/duffel.client';

async function main(): Promise<void> {
  const rootEnv = join(process.cwd(), '..', '..', '.env');
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
  const { DATABASE_URL, DUFFEL_API_TOKEN, DUFFEL_API_URL } = process.env;
  if (!DATABASE_URL || !DUFFEL_API_TOKEN)
    throw new Error('DATABASE_URL and DUFFEL_API_TOKEN are required');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });
  try {
    const client = new DuffelClient({
      baseUrl: DUFFEL_API_URL ?? 'https://api.duffel.com',
      token: DUFFEL_API_TOKEN,
    });
    const count = await syncDuffelAirlines(client, prisma);
    process.stdout.write(`airlines synced from Duffel: ${count}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`airline sync failed: ${(error as Error).message}\n`);
  process.exit(1);
});
