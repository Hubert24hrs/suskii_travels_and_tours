import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { z } from 'zod';

import { Public } from '../auth/decorators';
import { requestContext } from '../common/request-context';
import { Contract } from '../contract/contract';
import { NEWSLETTER_LIMITS, RateLimit } from '../rate-limit/rate-limit.decorator';

import {
  newsletterConfirmResponseSchema,
  newsletterTokenRequestSchema,
  newsletterUnsubscribeResponseSchema,
  subscribeRequestSchema,
  subscribeResponseSchema,
  type SubscribeRequest,
} from './newsletter.schemas';
import { NewsletterService } from './newsletter.service';

const TAGS = ['Newsletter'];

@Public()
@Controller('newsletter')
export class NewsletterController {
  constructor(private readonly newsletter: NewsletterService) {}

  @Post('subscriptions')
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit(NEWSLETTER_LIMITS.subscribeIp, NEWSLETTER_LIMITS.subscribeEmail)
  @Contract({
    operationId: 'subscribeNewsletter',
    summary: 'Sign up for deal alerts (double opt-in)',
    description:
      'Requires explicit consent and a Cloudflare Turnstile token. Always answers 202 with the same body; a confirmation email is sent to new or pending addresses.',
    tags: TAGS,
    body: subscribeRequestSchema,
    responses: { 202: subscribeResponseSchema },
  })
  async subscribe(
    @Body() body: SubscribeRequest,
    @Req() request: Request,
  ): Promise<z.infer<typeof subscribeResponseSchema>> {
    await this.newsletter.subscribe(body, requestContext(request).ip);
    return { status: 'pending_confirmation' };
  }

  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  @RateLimit(NEWSLETTER_LIMITS.tokenIp)
  @Contract({
    operationId: 'confirmNewsletter',
    summary: 'Confirm a deal-alert subscription from the email link',
    tags: TAGS,
    body: newsletterTokenRequestSchema,
    responses: { 200: newsletterConfirmResponseSchema },
  })
  async confirm(
    @Body() body: z.infer<typeof newsletterTokenRequestSchema>,
  ): Promise<z.infer<typeof newsletterConfirmResponseSchema>> {
    await this.newsletter.confirm(body.token);
    return { status: 'confirmed' };
  }

  @Post('unsubscribe')
  @HttpCode(HttpStatus.OK)
  @RateLimit(NEWSLETTER_LIMITS.tokenIp)
  @Contract({
    operationId: 'unsubscribeNewsletter',
    summary: 'Stop deal alerts from the email link',
    tags: TAGS,
    body: newsletterTokenRequestSchema,
    responses: { 200: newsletterUnsubscribeResponseSchema },
  })
  async unsubscribe(
    @Body() body: z.infer<typeof newsletterTokenRequestSchema>,
  ): Promise<z.infer<typeof newsletterUnsubscribeResponseSchema>> {
    await this.newsletter.unsubscribe(body.token);
    return { status: 'unsubscribed' };
  }
}
