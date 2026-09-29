import { Injectable } from '@nestjs/common';

import { BackgroundTasks } from '../common/background-tasks';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { searches } from '../telemetry/metrics';

import type { SearchVertical, SupplierOutcome } from './search-store';

export interface SearchLogEntry {
  vertical: SearchVertical;
  origin: string | null;
  destination: string | null;
  departureDate: string | null;
  returnDate: string | null;
  sliceCount: number | null;
  travellers: number;
  cabinClass: Prisma.SearchLogCreateInput['cabinClass'];
  channel: Prisma.SearchLogCreateInput['channel'];
  cacheHit: boolean;
  partial: boolean;
  resultCount: number;
  durationMs: number;
  supplierOutcomes: SupplierOutcome[];
}

/**
 * Anonymised search analytics (no user, session or IP: PROJECT_SPEC.json#/security), written
 * after the response so logging never slows a search.
 */
@Injectable()
export class SearchLogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly background: BackgroundTasks,
  ) {}

  record(entry: SearchLogEntry): void {
    searches.add(1, {
      vertical: entry.vertical,
      cache_hit: entry.cacheHit,
      partial: entry.partial,
    });
    this.background.run('search-log', () =>
      this.prisma.searchLog.create({
        data: {
          vertical: entry.vertical,
          origin: entry.origin,
          destination: entry.destination,
          departureDate: entry.departureDate ? new Date(`${entry.departureDate}T00:00:00Z`) : null,
          returnDate: entry.returnDate ? new Date(`${entry.returnDate}T00:00:00Z`) : null,
          sliceCount: entry.sliceCount,
          travellers: entry.travellers,
          cabinClass: entry.cabinClass ?? null,
          channel: entry.channel ?? null,
          cacheHit: entry.cacheHit,
          partial: entry.partial,
          resultCount: entry.resultCount,
          durationMs: Math.round(entry.durationMs),
          supplierOutcomes: entry.supplierOutcomes as unknown as Prisma.InputJsonValue,
        },
      }),
    );
  }
}
