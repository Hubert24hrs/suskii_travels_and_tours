import type { PrismaService } from '../../infra/prisma.service';

import type { DuffelClient } from './duffel.client';
import { duffelAirlineSchema, duffelAirlinesPageSchema } from './duffel.schemas';

const PAGE_SIZE = 200;
const MAX_PAGES = 50;

/**
 * Upserts airlines from Duffel's reference data into `airlines` (ADR-006). Only airlines with an
 * IATA code are stored. Returns the number of airlines written.
 */
export async function syncDuffelAirlines(
  client: DuffelClient,
  prisma: Pick<PrismaService, 'airline'>,
  signal: AbortSignal = AbortSignal.timeout(120_000),
): Promise<number> {
  let after: string | null = null;
  let written = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = new URLSearchParams({ limit: String(PAGE_SIZE), ...(after ? { after } : {}) });
    const response = duffelAirlinesPageSchema.parse(
      await client.request('GET', `/air/airlines?${query.toString()}`, signal),
    );
    for (const raw of response.data) {
      const airline = duffelAirlineSchema.safeParse(raw);
      const code = airline.success ? airline.data.iata_code?.toUpperCase() : undefined;
      if (!airline.success || !code || !/^[A-Z0-9]{2,3}$/.test(code)) continue;
      await prisma.airline.upsert({
        where: { iataCode: code },
        create: {
          iataCode: code,
          name: airline.data.name,
          logoUrl: airline.data.logo_symbol_url ?? null,
          source: 'duffel',
        },
        update: {
          name: airline.data.name,
          logoUrl: airline.data.logo_symbol_url ?? null,
          source: 'duffel',
          active: true,
        },
      });
      written += 1;
    }
    after = response.meta?.after ?? null;
    if (!after) break;
  }
  return written;
}
