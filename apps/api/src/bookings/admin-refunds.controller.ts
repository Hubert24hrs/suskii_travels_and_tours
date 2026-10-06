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

import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { AdminRoute, StepUp } from '../auth/decorators';
import { requestContext } from '../common/request-context';
import { Contract } from '../contract/contract';

import {
  adminRefundListSchema,
  adminRefundQuerySchema,
  adminRefundSchema,
  bookingIdParamsSchema,
  createRefundRequestSchema,
  refundIdParamsSchema,
  rejectRefundRequestSchema,
  resolveRefundRequestSchema,
  type CreateRefundRequest,
} from './bookings.schemas';
import { RefundsService, type StaffActor } from './refunds.service';

const TAGS = ['Admin'];

const staff = (auth: AuthContext, request: Request): StaffActor => ({
  userId: auth.userId,
  context: requestContext(request),
});

/**
 * Refunds for operations and finance (ADR-019): staff with `refunds:request` create them, a
 * different person with `refunds:approve` approves those above the threshold. Admin routes need a
 * staff role, an MFA session and an allowlisted IP. The console UI arrives in phase 10.
 */
@Controller('admin')
export class AdminRefundsController {
  constructor(private readonly refunds: RefundsService) {}

  @Get('refunds')
  @AdminRoute('refunds:request')
  @Contract({
    operationId: 'adminListRefunds',
    summary: 'List refunds',
    tags: TAGS,
    query: adminRefundQuerySchema,
    responses: { 200: adminRefundListSchema },
    errors: [403],
  })
  async list(
    @Query() query: z.infer<typeof adminRefundQuerySchema>,
  ): Promise<z.infer<typeof adminRefundListSchema>> {
    return { refunds: await this.refunds.adminList(query) };
  }

  @Get('refunds/:refundId')
  @AdminRoute('refunds:request')
  @Contract({
    operationId: 'adminGetRefund',
    summary: 'Get a refund',
    tags: TAGS,
    params: refundIdParamsSchema,
    responses: { 200: adminRefundSchema },
    errors: [403, 404],
  })
  get(@Param('refundId') refundId: string): Promise<z.infer<typeof adminRefundSchema>> {
    return this.refunds.adminGet(refundId);
  }

  @Post('bookings/:bookingId/refunds')
  @AdminRoute('refunds:request')
  @Contract({
    operationId: 'adminCreateRefund',
    audit: ['refund.created'],
    summary: 'Request a refund for a payment',
    description:
      'Above REFUND_APPROVAL_THRESHOLD_NGN (converted to NGN) the refund waits for a second approver; below it runs at once. The amount can never exceed what the payment can still return. `cancelBooking` applies to confirmed bookings (after the airline side is handled) and moves them to REFUND_PENDING.',
    tags: TAGS,
    params: bookingIdParamsSchema,
    body: createRefundRequestSchema,
    responses: { 201: adminRefundSchema },
    errors: [403, 404, 409, 422],
    idempotent: true,
  })
  create(
    @CurrentAuth() auth: AuthContext,
    @Param('bookingId') bookingId: string,
    @Body() body: CreateRefundRequest,
    @Req() request: Request,
  ): Promise<z.infer<typeof adminRefundSchema>> {
    return this.refunds.requestByStaff(bookingId, body, staff(auth, request));
  }

  @Post('refunds/:refundId/approve')
  @HttpCode(HttpStatus.OK)
  @AdminRoute('refunds:approve')
  @StepUp()
  @Contract({
    operationId: 'adminApproveRefund',
    audit: ['refund.approved'],
    summary: 'Approve a refund (maker-checker)',
    description: 'The person who requested a refund cannot approve it (403 `maker-checker`).',
    tags: TAGS,
    params: refundIdParamsSchema,
    responses: { 200: adminRefundSchema },
    errors: [403, 404, 409],
  })
  approve(
    @CurrentAuth() auth: AuthContext,
    @Param('refundId') refundId: string,
    @Req() request: Request,
  ): Promise<z.infer<typeof adminRefundSchema>> {
    return this.refunds.approve(refundId, staff(auth, request));
  }

  @Post('refunds/:refundId/reject')
  @HttpCode(HttpStatus.OK)
  @AdminRoute('refunds:approve')
  @Contract({
    operationId: 'adminRejectRefund',
    audit: ['refund.rejected'],
    summary: 'Reject a refund waiting for approval',
    tags: TAGS,
    params: refundIdParamsSchema,
    body: rejectRefundRequestSchema,
    responses: { 200: adminRefundSchema },
    errors: [403, 404, 409],
  })
  reject(
    @CurrentAuth() auth: AuthContext,
    @Param('refundId') refundId: string,
    @Body() body: z.infer<typeof rejectRefundRequestSchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof adminRefundSchema>> {
    return this.refunds.reject(refundId, staff(auth, request), body.reason);
  }

  @Post('refunds/:refundId/resolve')
  @HttpCode(HttpStatus.OK)
  @AdminRoute('refunds:approve')
  @StepUp()
  @Contract({
    operationId: 'adminResolveRefund',
    audit: ['refund.resolved'],
    summary: 'Settle a refund in review from the provider dashboard',
    description:
      'For refunds whose provider outcome is unknown (`needs_review`): record what the provider shows. `failed` returns the money to the booking in the ledger so it can be refunded again.',
    tags: TAGS,
    params: refundIdParamsSchema,
    body: resolveRefundRequestSchema,
    responses: { 200: adminRefundSchema },
    errors: [403, 404, 409],
  })
  resolve(
    @CurrentAuth() auth: AuthContext,
    @Param('refundId') refundId: string,
    @Body() body: z.infer<typeof resolveRefundRequestSchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof adminRefundSchema>> {
    return this.refunds.resolve(
      refundId,
      staff(auth, request),
      body.outcome,
      body.providerRefundId,
    );
  }
}
