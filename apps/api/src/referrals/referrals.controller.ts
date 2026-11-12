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
import { AdminRoute } from '../auth/decorators';
import { requestContext } from '../common/request-context';
import { Contract } from '../contract/contract';
import { InternalRoute } from '../internal/internal-route';

import {
  adminReferralListSchema,
  adminReferralQuerySchema,
  myReferralsSchema,
  referralDecisionSchema,
  referralIdParamsSchema,
  referralRunSchema,
} from './referrals.schemas';
import { ReferralsService } from './referrals.service';

/** The signed-in traveller's referral code and results (ADR-031). */
@Controller('me/referrals')
export class ReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get()
  @Contract({
    operationId: 'getMyReferrals',
    summary: 'My referral code, link and results',
    description:
      'The code is created on first request. A friend enters it when signing up; the referral counts once their first trip is complete.',
    tags: ['Account'],
    responses: { 200: myReferralsSchema },
  })
  mine(@CurrentAuth() auth: AuthContext): Promise<z.infer<typeof myReferralsSchema>> {
    return this.referrals.summary(auth.userId);
  }
}

/** Staff review of flagged referrals (`referrals:review`, audited). */
@Controller('admin/referrals')
export class AdminReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get()
  @AdminRoute('referrals:review')
  @Contract({
    operationId: 'adminListReferrals',
    summary: 'Referrals by status (default: waiting for review)',
    tags: ['Admin'],
    query: adminReferralQuerySchema,
    responses: { 200: adminReferralListSchema },
    errors: [403],
  })
  async list(
    @Query() query: z.output<typeof adminReferralQuerySchema>,
  ): Promise<z.infer<typeof adminReferralListSchema>> {
    return { referrals: await this.referrals.listForReview(query.status) };
  }

  @Post(':id/decision')
  @AdminRoute('referrals:review')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Contract({
    operationId: 'adminDecideReferral',
    audit: ['referral.reviewed'],
    summary: 'Approve or reject a referral in review',
    description: 'Approved referrals qualify (or wait for their trip) and are paid by the sweep.',
    tags: ['Admin'],
    params: referralIdParamsSchema,
    body: referralDecisionSchema,
    responses: { 204: null },
    errors: [403, 404, 409],
  })
  async decide(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: z.infer<typeof referralDecisionSchema>,
    @Req() request: Request,
  ): Promise<void> {
    await this.referrals.review(id, body.decision, {
      userId: auth.userId,
      context: requestContext(request),
    });
  }
}

/** Worker-only: qualification and rewards (ADR-031). */
@InternalRoute()
@Controller('internal/referrals')
export class InternalReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @Post('run')
  @HttpCode(HttpStatus.OK)
  @Contract({
    operationId: 'runReferrals',
    summary: 'Qualify referrals on completed trips and pay rewards',
    tags: ['Internal'],
    responses: { 200: referralRunSchema },
    errors: [401, 404],
  })
  run(): Promise<z.infer<typeof referralRunSchema>> {
    return this.referrals.sweep();
  }
}
