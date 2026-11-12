import { Injectable, Logger } from '@nestjs/common';
import type { z } from 'zod';

import { PrismaService } from '../infra/prisma.service';
import { hotelNameKey, metresBetween, SAME_HOTEL_METRES } from '../search/results';

import type { reviewSummarySchema } from './reviews.schemas';
import { presentSummary } from './review-summary';

type Summary = z.infer<typeof reviewSummarySchema>;

/**
 * Verified scores for hotel search results (ADR-077): one indexed query per page, matching
 * hotels by normalised name within 250 m like the review subjects themselves. Only needs the
 * database, so search can use it without depending on bookings.
 */
@Injectable()
export class HotelReviewLookup {
  private readonly logger = new Logger(HotelReviewLookup.name);

  constructor(private readonly prisma: PrismaService) {}

  /** One summary (or null) per hotel, in order. A failed lookup never fails the search. */
  async forHotels(
    hotels: readonly { name: string; latitude: number; longitude: number }[],
  ): Promise<(Summary | null)[]> {
    const keys = hotels.map((hotel) => hotelNameKey(hotel.name));
    const wanted = [...new Set(keys.filter((key) => key.length > 0))];
    if (wanted.length === 0) return hotels.map(() => null);
    try {
      const subjects = await this.prisma.reviewSubject.findMany({
        where: { kind: 'hotel', nameKey: { in: wanted }, ratingCount: { gt: 0 } },
        select: {
          id: true,
          nameKey: true,
          latitude: true,
          longitude: true,
          ratingSum: true,
          ratingCount: true,
        },
      });
      return hotels.map((hotel, index) => {
        const match = subjects.find(
          (subject) =>
            subject.nameKey === keys[index] &&
            subject.latitude !== null &&
            subject.longitude !== null &&
            metresBetween({ latitude: subject.latitude, longitude: subject.longitude }, hotel) <=
              SAME_HOTEL_METRES,
        );
        return match ? presentSummary(match) : null;
      });
    } catch (error) {
      this.logger.warn({ reason: (error as Error).name }, 'hotel review lookup failed');
      return hotels.map(() => null);
    }
  }
}
