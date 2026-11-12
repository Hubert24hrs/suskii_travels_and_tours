import { Module } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { BookingsModule } from '../bookings/bookings.module';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { REDIS } from '../infra/redis';

import { ActivityPartner, MockActivityPartner } from './activity-partner';
import { AdminPartnersController } from './admin-partners.controller';
import { AffiliateLinker, MockAffiliateLinker } from './affiliate-linker';
import { PartnerClicksService } from './partner-clicks.service';
import { PartnerConversionsService } from './partner-conversions.service';
import { PartnerLinks } from './partner-links';
import { PartnerOffersService } from './partner-offers.service';
import { PartnersController } from './partners.controller';
import { TravelpayoutsLinker, type LinkStore } from './travelpayouts/travelpayouts-linker';
import { ViatorActivityPartner } from './viator/viator-activity-partner';

/** The link cache and call budget for Travelpayouts, shared by every API instance. */
export function redisLinkStore(redis: Redis): LinkStore {
  return {
    get: (key) => redis.get(key),
    set: async (key, value, ttlSeconds) => {
      await redis.set(key, value, 'EX', ttlSeconds);
    },
    take: async (key, limit, windowSeconds) => {
      const [[, used] = [null, 0]] = (await redis
        .multi()
        .incr(key)
        .expire(key, windowSeconds)
        .exec()) as [Error | null, number][];
      return Number(used) <= limit;
    },
  };
}

/** Affiliate partner offers and tracking (ADR-069, ADR-070). */
@Module({
  imports: [BookingsModule],
  controllers: [PartnersController, AdminPartnersController],
  providers: [
    PartnerLinks,
    PartnerOffersService,
    PartnerClicksService,
    PartnerConversionsService,
    {
      provide: AffiliateLinker,
      inject: [APP_CONFIG, REDIS],
      // The env schema requires the token and marker for Travelpayouts and refuses the mock in
      // production while partner offers are on.
      useFactory: (config: AppConfig, redis: Redis): AffiliateLinker =>
        config.AFFILIATE_NETWORK === 'travelpayouts' &&
        config.TRAVELPAYOUTS_TOKEN &&
        config.TRAVELPAYOUTS_MARKER
          ? new TravelpayoutsLinker({
              baseUrl: config.TRAVELPAYOUTS_API_URL,
              token: config.TRAVELPAYOUTS_TOKEN,
              marker: config.TRAVELPAYOUTS_MARKER,
              trs: config.TRAVELPAYOUTS_TRS,
              timeoutMs: config.PARTNER_TIMEOUT_MS,
              store: redisLinkStore(redis),
            })
          : new MockAffiliateLinker(),
    },
    {
      provide: ActivityPartner,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): ActivityPartner =>
        config.ACTIVITY_PARTNER === 'viator' && config.VIATOR_API_KEY
          ? new ViatorActivityPartner({
              baseUrl: config.VIATOR_API_URL,
              apiKey: config.VIATOR_API_KEY,
              campaign: config.VIATOR_CAMPAIGN,
            })
          : new MockActivityPartner(),
    },
  ],
})
export class PartnersModule {}
