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
import { AdminRoute } from '../auth/decorators';
import { Contract } from '../contract/contract';

import { ReviewModerationService } from './review-moderation.service';
import {
  adminReviewPageSchema,
  adminReviewParamsSchema,
  adminReviewQuerySchema,
  adminReviewSchema,
  rejectReviewSchema,
} from './reviews.schemas';

const TAGS = ['Admin'];
type AdminReview = z.infer<typeof adminReviewSchema>;

/** The review moderation queue (ADR-077). */
@Controller('admin/reviews')
export class AdminReviewsController {
  constructor(private readonly moderation: ReviewModerationService) {}

  @Get()
  @AdminRoute('reviews:moderate')
  @Contract({
    operationId: 'adminListReviews',
    summary: 'Reviews by status (waiting ones first, oldest first)',
    tags: TAGS,
    query: adminReviewQuerySchema,
    responses: { 200: adminReviewPageSchema },
    errors: [403],
  })
  list(
    @Query() query: z.infer<typeof adminReviewQuerySchema>,
  ): Promise<z.infer<typeof adminReviewPageSchema>> {
    return this.moderation.list(query);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @AdminRoute('reviews:moderate')
  @Contract({
    operationId: 'adminPublishReview',
    summary: 'Publish a waiting review as written',
    tags: TAGS,
    params: adminReviewParamsSchema,
    responses: { 200: adminReviewSchema },
    errors: [403, 404, 409],
    audit: ['review.published'],
  })
  publish(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Req() request: Request,
  ): Promise<AdminReview> {
    return this.moderation.publish(id, staffActor(auth, request));
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @AdminRoute('reviews:moderate')
  @Contract({
    operationId: 'adminRejectReview',
    summary: 'Reject a waiting review with a reason',
    tags: TAGS,
    params: adminReviewParamsSchema,
    body: rejectReviewSchema,
    responses: { 200: adminReviewSchema },
    errors: [403, 404, 409],
    audit: ['review.rejected'],
  })
  reject(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: z.infer<typeof rejectReviewSchema>,
    @Req() request: Request,
  ): Promise<AdminReview> {
    return this.moderation.reject(id, body.reason, staffActor(auth, request));
  }
}
