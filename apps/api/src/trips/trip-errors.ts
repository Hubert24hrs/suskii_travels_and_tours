import { HttpStatus } from '@nestjs/common';

import { ProblemDetailsException } from '../common/problem-details';

/** Why a booking cannot join a trip (`code`). */
export const TRIP_PART_ISSUES = {
  unsupported: 'unsupported',
  currency: 'currency',
  notPayable: 'not_payable',
  paymentPlan: 'payment_plan',
  company: 'company',
  otherTrip: 'other_trip',
  notWanted: 'not_wanted',
} as const;
export type TripPartIssue = (typeof TRIP_PART_ISSUES)[keyof typeof TRIP_PART_ISSUES];

export const tripPartInvalid = (code: TripPartIssue): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'trip-part-invalid',
    'This booking cannot be added to the trip',
    'A trip takes an unpaid flight, hotel, rental car, airport transfer or travel insurance booking of yours, in its own currency.',
    { code },
  );

export const tripPartPaid = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.CONFLICT,
    'trip-part-paid',
    'This part of the trip is already paid',
    'A paid booking stays in its trip. Cancel it from the booking itself if you need to.',
  );

export const tripHasPayments = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.CONFLICT,
    'trip-has-payments',
    'This trip cannot be deleted',
    'A trip with a payment, started or made, is kept with its bookings.',
  );

export const tripNothingToPay = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.CONFLICT,
    'trip-nothing-to-pay',
    'There is nothing to pay on this trip',
    'Add a part to the trip first, or reload it: it may already be paid.',
  );

export const tooManyTrips = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.CONFLICT,
    'too-many-trips',
    'You have too many unpaid trips',
    'Pay or finish one of your trips before starting another.',
  );
