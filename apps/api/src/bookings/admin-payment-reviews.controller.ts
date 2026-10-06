import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { z } from 'zod';

import { staffActor } from '../admin/admin-helpers';
import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { AdminRoute, StepUp } from '../auth/decorators';
import { Contract } from '../contract/contract';

import {
  adminPaymentReviewPageSchema,
  adminPaymentReviewQuerySchema,
  adminPaymentReviewSchema,
  paymentReviewParamsSchema,
  rejectPaymentReviewSchema,
} from './payment-reviews.schemas';
import { PaymentReviewsService } from './payment-reviews.service';

const TAGS = ['Admin'];
type Review = z.infer<typeof adminPaymentReviewSchema>;

/** Payments held by the risk score, for finance (ADR-040). */
@Controller('admin/payment-reviews')
export class AdminPaymentReviewsController {
  constructor(private readonly reviews: PaymentReviewsService) {}

  @Get()
  @AdminRoute('payments:review')
  @Contract({
    operationId: 'adminListPaymentReviews',
    summary: 'Payments held for a risk review (open first by default, newest first)',
    tags: TAGS,
    query: adminPaymentReviewQuerySchema,
    responses: { 200: adminPaymentReviewPageSchema },
    errors: [403],
  })
  list(
    @Query() query: z.infer<typeof adminPaymentReviewQuerySchema>,
  ): Promise<z.infer<typeof adminPaymentReviewPageSchema>> {
    return this.reviews.list(query);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @AdminRoute('payments:review')
  @StepUp()
  @Contract({
    operationId: 'adminApprovePaymentReview',
    summary: 'Release a held booking to fulfilment',
    tags: TAGS,
    params: paymentReviewParamsSchema,
    responses: { 200: adminPaymentReviewSchema },
    errors: [403, 404, 409],
    audit: ['payment_risk.approved'],
  })
  approve(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Req() request: Request,
  ): Promise<Review> {
    return this.reviews.approve(id, staffActor(auth, request));
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @AdminRoute('payments:review')
  @StepUp()
  @Contract({
    operationId: 'adminRejectPaymentReview',
    summary: 'Refund a held booking in full and move it to REFUND_PENDING',
    tags: TAGS,
    params: paymentReviewParamsSchema,
    body: rejectPaymentReviewSchema,
    responses: { 200: adminPaymentReviewSchema },
    errors: [403, 404, 409],
    audit: ['payment_risk.rejected'],
  })
  reject(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: z.infer<typeof rejectPaymentReviewSchema>,
    @Req() request: Request,
  ): Promise<Review> {
    return this.reviews.reject(id, body.reason, staffActor(auth, request));
  }
}
