import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import type { z } from 'zod';

import { Public } from '../auth/decorators';
import type { AuthenticatedRequest } from '../auth/auth-context';
import { bookingCaller } from '../bookings/booking-caller';
import { BOOKING_TOKEN_HEADER, bookingIdParamsSchema } from '../bookings/bookings.schemas';
import { Contract } from '../contract/contract';
import { CarsFeatureRoute } from '../ground/cars-flags';
import { CARS_LIMITS, RateLimit } from '../rate-limit/rate-limit.decorator';

import {
  carsSuggestionsSchema,
  departurePlanQuerySchema,
  departurePlanSchema,
} from './planning.schemas';
import { TripPlanningService } from './trip-planning.service';

const TAGS = ['Bookings'];

/**
 * Cars features on a booking (P9): the departure planner and trip bundling. Like the booking
 * itself, owners reach them with their session and guests with the booking's access token.
 */
@Public()
@Controller('bookings/:bookingId')
export class TripPlanningController {
  constructor(private readonly planning: TripPlanningService) {}

  @Get('departure-plan')
  @CarsFeatureRoute('departure_planner')
  @RateLimit(CARS_LIMITS.planIp)
  @Contract({
    operationId: 'getDeparturePlan',
    summary: 'When to leave for the airport or the bus terminal',
    description:
      'For a flight or bus booking that has not left: the time to be there (check-in or boarding), the routed travel time from the chosen ride place plus a traffic allowance, the time to leave, and a ride to book for it. 422 `plan-unavailable` when the trip cannot be planned (no pick-up point for the airport or terminal, a place in another city, already left).',
    tags: TAGS,
    params: bookingIdParamsSchema,
    query: departurePlanQuerySchema,
    headers: [BOOKING_TOKEN_HEADER],
    responses: { 200: departurePlanSchema },
    errors: [404, 422],
  })
  departurePlan(
    @Param('bookingId') bookingId: string,
    @Query() query: z.infer<typeof departurePlanQuerySchema>,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof departurePlanSchema>> {
    return this.planning.departurePlan(bookingId, query.from, bookingCaller(request));
  }

  @Get('cars-suggestions')
  @CarsFeatureRoute('bundles')
  @Contract({
    operationId: 'getCarsSuggestions',
    summary: 'Rides, cars and buses that fit this trip',
    description:
      'For an upcoming flight: a ride from the arrival airport, a car for the stay and onward buses from the arrival city; for a hotel: a car for the stay. Each only while its product is on and has inventory there. Suggestions prefill the search forms; they book nothing.',
    tags: TAGS,
    params: bookingIdParamsSchema,
    headers: [BOOKING_TOKEN_HEADER],
    responses: { 200: carsSuggestionsSchema },
    errors: [404],
  })
  suggestions(
    @Param('bookingId') bookingId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof carsSuggestionsSchema>> {
    return this.planning.suggestions(bookingId, bookingCaller(request));
  }
}
