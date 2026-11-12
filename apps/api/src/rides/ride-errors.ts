import { HttpStatus } from '@nestjs/common';

import { ProblemDetailsException } from '../common/problem-details';

import type { RIDE_QUOTE_ISSUES } from './rides.schemas';

type RideQuoteIssue = (typeof RIDE_QUOTE_ISSUES)[keyof typeof RIDE_QUOTE_ISSUES];

export const rideQuoteInvalid = (code: RideQuoteIssue): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'quote-invalid',
    'This ride cannot be booked',
    'Change the pickup, drop-off, time or category and try again.',
    { code },
  );

/** The ride moved on (another action won, or it already ended). */
export const rideConflict = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.CONFLICT,
    'ride-conflict',
    'The ride has changed',
    'Refresh the ride and try again.',
  );

export const offerGone = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.CONFLICT,
    'offer-gone',
    'This ride is no longer offered to you',
    'It expired, was declined or went to another driver.',
  );

export const pinInvalid = (attemptsLeft: number): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'pin-invalid',
    'That PIN is not right',
    'Ask the rider for the four-digit code on their screen.',
    { attemptsLeft },
  );

export const pinLocked = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.LOCKED,
    'pin-locked',
    'This ride is locked',
    'Too many wrong PINs. Our safety team has been alerted and will contact you.',
  );

export const notDriving = (reason: string): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.CONFLICT,
    'cannot-drive',
    'You cannot go online yet',
    'Finish the steps on your driver profile, or contact driver support.',
    { reason },
  );

export const rideInProgress = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.CONFLICT,
    'ride-in-progress',
    'Finish your current ride first',
  );

export const implausibleLocation = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'location-implausible',
    'This position was rejected',
    'It is outside the service area or too far from the last one.',
  );

export const ratingClosed = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.CONFLICT,
    'rating-closed',
    'This ride cannot be rated',
    'Rate a ride once, after it is completed.',
  );
