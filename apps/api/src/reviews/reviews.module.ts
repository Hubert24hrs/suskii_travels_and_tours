import { Controller, HttpCode, HttpStatus, Module, Post } from '@nestjs/common';
import type { z } from 'zod';

import { BookingsModule } from '../bookings/bookings.module';
import { Contract } from '../contract/contract';
import { InternalRoute } from '../internal/internal-route';

import { AdminReviewsController } from './admin-reviews.controller';
import { ReviewInvitationsService } from './review-invitations.service';
import { ReviewModerationService } from './review-moderation.service';
import { ReviewsController } from './reviews.controller';
import { reviewInvitationRunSchema } from './reviews.schemas';
import { ReviewsService } from './reviews.service';

/** Worker-only: review invitations after finished trips (ADR-077). */
@InternalRoute()
@Controller('internal/reviews')
export class InternalReviewsController {
  constructor(private readonly invitations: ReviewInvitationsService) {}

  @Post('invitations/run')
  @HttpCode(HttpStatus.OK)
  @Contract({
    operationId: 'runReviewInvitations',
    summary: 'Plan and send due review invitations',
    tags: ['Internal'],
    responses: { 200: reviewInvitationRunSchema },
    errors: [401, 404],
  })
  run(): Promise<z.infer<typeof reviewInvitationRunSchema>> {
    return this.invitations.run();
  }
}

/** Verified reviews: writing, moderation, public pages and invitations (ADR-077). */
@Module({
  imports: [BookingsModule],
  controllers: [ReviewsController, AdminReviewsController, InternalReviewsController],
  providers: [ReviewsService, ReviewModerationService, ReviewInvitationsService],
})
export class ReviewsModule {}
