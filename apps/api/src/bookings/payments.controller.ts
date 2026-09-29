import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import type { z } from 'zod';

import { Public } from '../auth/decorators';
import { Contract } from '../contract/contract';
import { BOOKING_LIMITS, RateLimit, SkipRateLimit } from '../rate-limit/rate-limit.decorator';

import {
  mockPaymentCompleteRequestSchema,
  mockPaymentResultSchema,
  mockPaymentSchema,
  paymentReferenceParamsSchema,
  webhookParamsSchema,
  webhookReceiptSchema,
} from './bookings.schemas';
import { PaymentEventsService } from './payment-events.service';

const TAGS = ['Payments'];

/** Provider webhooks and the mock provider's hosted checkout (ADR-014). */
@Public()
@Controller('payments')
export class PaymentsController {
  constructor(private readonly events: PaymentEventsService) {}

  @Post('webhooks/:provider')
  @HttpCode(HttpStatus.OK)
  // Providers retry in bursts from shared IPs; the signature is the control here.
  @SkipRateLimit()
  @Contract({
    operationId: 'receivePaymentWebhook',
    summary: 'Payment provider webhook',
    description:
      'The provider-signed JSON event is verified over the raw body; duplicates are acknowledged without effect. Called by payment providers only.',
    tags: TAGS,
    params: webhookParamsSchema,
    responses: { 200: webhookReceiptSchema },
    errors: [404],
  })
  async webhook(
    @Param('provider') provider: string,
    @Req() request: RawBodyRequest<Request>,
  ): Promise<z.infer<typeof webhookReceiptSchema>> {
    await this.events.receive(provider, request.rawBody, request.headers);
    return { received: true };
  }

  @Get('mock/:reference')
  @RateLimit(BOOKING_LIMITS.mockPaymentIp)
  @Contract({
    operationId: 'getMockPayment',
    summary: 'Mock hosted checkout: the payment to show',
    description: 'Exists only while the API uses the mock payment provider (never in production).',
    tags: TAGS,
    params: paymentReferenceParamsSchema,
    responses: { 200: mockPaymentSchema },
    errors: [404],
  })
  mockPayment(@Param('reference') reference: string): Promise<z.infer<typeof mockPaymentSchema>> {
    return this.events.mockPayment(reference);
  }

  @Post('mock/:reference/complete')
  @HttpCode(HttpStatus.OK)
  @RateLimit(BOOKING_LIMITS.mockPaymentIp)
  @Contract({
    operationId: 'completeMockPayment',
    summary: 'Mock hosted checkout: pay or decline',
    description:
      'Sends a signed mock webhook through the normal webhook pipeline, then returns where to send the traveller.',
    tags: TAGS,
    params: paymentReferenceParamsSchema,
    body: mockPaymentCompleteRequestSchema,
    responses: { 200: mockPaymentResultSchema },
    errors: [404, 409],
  })
  completeMockPayment(
    @Param('reference') reference: string,
    @Body() body: z.infer<typeof mockPaymentCompleteRequestSchema>,
  ): Promise<z.infer<typeof mockPaymentResultSchema>> {
    return this.events.completeMock(reference, body.outcome);
  }
}
