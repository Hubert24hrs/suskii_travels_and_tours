import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { z } from 'zod';

import type { AuthenticatedRequest } from '../auth/auth-context';
import { Public } from '../auth/decorators';
import { bookingCaller } from '../bookings/booking-caller';
import { BOOKING_TOKEN_HEADER } from '../bookings/bookings.schemas';
import { Contract } from '../contract/contract';
import { RateLimit, REVIEW_LIMITS } from '../rate-limit/rate-limit.decorator';

import {
  bookingReviewsParamsSchema,
  bookingReviewsSchema,
  ownReviewSchema,
  reviewItemParamsSchema,
  reviewPageQuerySchema,
  reviewPageSchema,
  writeReviewSchema,
} from './reviews.schemas';
import { ReviewsService } from './reviews.service';

const TAGS = ['Reviews'];

/**
 * Verified reviews (ADR-077). Public pages list published reviews; a booking's owner or guest-link
 * holder writes and withdraws the reviews of its finished items.
 */
@Public()
@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get('reviews')
  @RateLimit(REVIEW_LIMITS.readIp)
  @Contract({
    operationId: 'listReviews',
    summary: "A subject's published reviews and verified score",
    description:
      'Pass `subject` (hotel results carry it as `verifiedReviews.subjectId`), or `kind` and `ref` for a package, tour, bus operator or rental vehicle. Newest first; `summary` is null until a review is published.',
    tags: TAGS,
    query: reviewPageQuerySchema,
    responses: { 200: reviewPageSchema },
    errors: [400],
  })
  list(
    @Query() query: z.infer<typeof reviewPageQuerySchema>,
  ): Promise<z.infer<typeof reviewPageSchema>> {
    return this.reviews.page(query);
  }

  @Get('bookings/:bookingId/reviews')
  @Contract({
    operationId: 'getBookingReviews',
    summary: 'What can be reviewed in a booking, and the reviews written',
    description:
      "Items that can be reviewed (stays, packages, tours, buses and rentals), whether the trip has ended and the window is open, and the traveller's own review with its moderation status.",
    tags: TAGS,
    params: bookingReviewsParamsSchema,
    headers: [BOOKING_TOKEN_HEADER],
    responses: { 200: bookingReviewsSchema },
    errors: [404],
  })
  forBooking(
    @Param('bookingId') bookingId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof bookingReviewsSchema>> {
    return this.reviews.forBooking(bookingId, bookingCaller(request));
  }

  @Put('bookings/:bookingId/items/:itemId/review')
  @RateLimit(REVIEW_LIMITS.writeIp)
  @Contract({
    operationId: 'writeReview',
    summary: 'Write the review of a finished trip, or change it while it waits',
    description:
      'Once per booking item, after the trip has ended and within the review window. The review waits for a moderator before it appears. 409 `review-not-eligible` when the item cannot be reviewed, `review-closed` when the review was already published or rejected (withdraw it instead).',
    tags: TAGS,
    params: reviewItemParamsSchema,
    headers: [BOOKING_TOKEN_HEADER],
    body: writeReviewSchema,
    responses: { 200: ownReviewSchema },
    errors: [404, 409],
  })
  write(
    @Param('bookingId') bookingId: string,
    @Param('itemId') itemId: string,
    @Body() body: z.infer<typeof writeReviewSchema>,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof ownReviewSchema>> {
    return this.reviews.write(bookingId, itemId, body, bookingCaller(request));
  }

  @Delete('bookings/:bookingId/items/:itemId/review')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit(REVIEW_LIMITS.writeIp)
  @Contract({
    operationId: 'withdrawReview',
    summary: 'Withdraw the review of a trip',
    description: 'Removes it everywhere, whatever its status.',
    tags: TAGS,
    params: reviewItemParamsSchema,
    headers: [BOOKING_TOKEN_HEADER],
    responses: { 204: null },
    errors: [404],
  })
  async withdraw(
    @Param('bookingId') bookingId: string,
    @Param('itemId') itemId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.reviews.withdraw(bookingId, itemId, bookingCaller(request));
  }
}
