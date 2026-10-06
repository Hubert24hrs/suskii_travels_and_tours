import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { z } from 'zod';

import { Public } from '../auth/decorators';
import { Contract } from '../contract/contract';
import { PrismaService } from '../infra/prisma.service';
import { PRIVACY_LIMITS, RateLimit } from '../rate-limit/rate-limit.decorator';

import { cookieConsentBodySchema, cookieConsentRecordedSchema } from './privacy.schemas';

/**
 * Records a visitor's cookie choice before the website applies it (ADR-042). Each save appends a
 * row, so the history of choices for a consent id stays provable. Nothing links the row to an
 * account, IP address or browser.
 */
@Public()
@Controller('privacy')
export class CookieConsentController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('cookie-consents')
  @HttpCode(HttpStatus.CREATED)
  @RateLimit(PRIVACY_LIMITS.cookieConsentIp)
  @Contract({
    operationId: 'recordCookieConsent',
    summary: 'Record a cookie choice',
    description:
      'The website calls this before it enables any optional cookie category, and only sets its consent cookie once the choice is recorded.',
    tags: ['Privacy'],
    body: cookieConsentBodySchema,
    responses: { 201: cookieConsentRecordedSchema },
  })
  async record(
    @Body() body: z.infer<typeof cookieConsentBodySchema>,
  ): Promise<z.infer<typeof cookieConsentRecordedSchema>> {
    const row = await this.prisma.cookieConsent.create({
      data: {
        consentId: body.consentId,
        policyVersion: body.policyVersion,
        analytics: body.choices.analytics,
        marketing: body.choices.marketing,
      },
    });
    return {
      consentId: row.consentId,
      policyVersion: row.policyVersion,
      choices: { analytics: row.analytics, marketing: row.marketing },
      recordedAt: row.createdAt.toISOString(),
    };
  }
}
