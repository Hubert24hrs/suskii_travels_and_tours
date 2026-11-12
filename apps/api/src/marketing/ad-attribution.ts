import { Inject, Injectable, Logger } from '@nestjs/common';

import { COOKIE_POLICY_VERSION, type MarketingAttribution } from '@suskii/shared';

import { APP_CONFIG, type AppConfig } from '../config/config';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';

/** Whether the latest recorded choice for a consent id, under the current policy, allows marketing. */
export async function marketingAllowed(prisma: PrismaService, consentId: string): Promise<boolean> {
  const latest = await prisma.cookieConsent.findFirst({
    where: { consentId },
    orderBy: { createdAt: 'desc' },
    select: { policyVersion: true, marketing: true },
  });
  return latest?.policyVersion === COOKIE_POLICY_VERSION && latest.marketing;
}

/**
 * Booking time (ADR-079): keeps the website's ad attribution only when the recorded cookie
 * consent allows marketing; the browser's flag alone is never enough. Provided by BookingsModule
 * (no module cycle); the sweep that sends it lives in MarketingModule.
 */
@Injectable()
export class AdAttribution {
  private readonly logger = new Logger(AdAttribution.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Never fails the booking: a problem here only means no server-side event. */
  async keep(bookingId: string, attribution: MarketingAttribution | undefined): Promise<boolean> {
    if (!attribution || this.config.AD_CONVERSIONS.length === 0) return false;
    try {
      if (!(await marketingAllowed(this.prisma, attribution.consentId))) return false;
      const { consentId, ...clickIds } = attribution;
      await this.prisma.adConversion.create({
        data: {
          bookingId,
          consentId,
          clickIds: Object.keys(clickIds).length > 0 ? clickIds : Prisma.JsonNull,
        },
      });
      return true;
    } catch (error) {
      // Ids and reasons only: the click ids are personal data.
      this.logger.warn(
        { bookingId, reason: error instanceof Error ? error.name : 'unknown' },
        'Ad attribution not kept',
      );
      return false;
    }
  }
}
