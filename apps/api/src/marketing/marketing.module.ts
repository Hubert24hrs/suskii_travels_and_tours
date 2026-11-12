import { Controller, HttpCode, HttpStatus, Module, Post } from '@nestjs/common';
import type { z } from 'zod';

import { BookingsModule } from '../bookings/bookings.module';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { Contract } from '../contract/contract';
import { InternalRoute } from '../internal/internal-route';

import { MockAdConversions, type AdConversionsProvider } from './ad-conversions.provider';
import { AD_CONVERSIONS_PROVIDERS, AdConversionsService } from './ad-conversions.service';
import { adConversionRunSchema } from './marketing.schemas';
import { MetaConversions } from './meta/meta-conversions';
import { TikTokEvents } from './tiktok/tiktok-events';

/** One adapter per configured network; the env schema requires each network's id and token. */
export function adConversionsProviders(config: AppConfig): AdConversionsProvider[] {
  return config.AD_CONVERSIONS.flatMap((network): AdConversionsProvider[] => {
    if (network === 'mock') return [new MockAdConversions()];
    if (network === 'meta' && config.META_PIXEL_ID && config.META_CAPI_ACCESS_TOKEN) {
      return [
        new MetaConversions({
          baseUrl: config.META_GRAPH_API_URL,
          pixelId: config.META_PIXEL_ID,
          accessToken: config.META_CAPI_ACCESS_TOKEN,
          testEventCode: config.META_TEST_EVENT_CODE,
        }),
      ];
    }
    if (network === 'tiktok' && config.TIKTOK_PIXEL_ID && config.TIKTOK_EVENTS_ACCESS_TOKEN) {
      return [
        new TikTokEvents({
          baseUrl: config.TIKTOK_EVENTS_API_URL,
          pixelId: config.TIKTOK_PIXEL_ID,
          accessToken: config.TIKTOK_EVENTS_ACCESS_TOKEN,
          testEventCode: config.TIKTOK_TEST_EVENT_CODE,
        }),
      ];
    }
    return [];
  });
}

/** Worker-only: server-side ad conversions (ADR-079). */
@InternalRoute()
@Controller('internal/ad-conversions')
export class InternalAdConversionsController {
  constructor(private readonly conversions: AdConversionsService) {}

  @Post('run')
  @HttpCode(HttpStatus.OK)
  @Contract({
    operationId: 'runAdConversions',
    summary: "Send paid bookings' Purchase events to the configured ad networks",
    tags: ['Internal'],
    responses: { 200: adConversionRunSchema },
    errors: [401, 404],
  })
  run(): Promise<z.infer<typeof adConversionRunSchema>> {
    return this.conversions.run();
  }
}

/** Ads with consent: attribution kept at booking time and the sweep that sends it (ADR-079). */
@Module({
  imports: [BookingsModule],
  controllers: [InternalAdConversionsController],
  providers: [
    AdConversionsService,
    {
      provide: AD_CONVERSIONS_PROVIDERS,
      inject: [APP_CONFIG],
      useFactory: adConversionsProviders,
    },
  ],
  exports: [AdConversionsService],
})
export class MarketingModule {}
