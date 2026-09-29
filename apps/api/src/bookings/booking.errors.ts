import { HttpStatus } from '@nestjs/common';

import type { PassengerIssue } from '@suskii/shared';

import { ProblemDetailsException } from '../common/problem-details';

export const botCheckFailed = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.BAD_REQUEST,
    'bot-check-failed',
    'We could not verify this request',
    'Refresh the page and try again.',
  );

export const termsOutdated = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.CONFLICT,
    'terms-outdated',
    'The booking conditions have changed',
    'Reload the page, read the updated conditions and accept them to continue.',
  );

/** Passenger or guest details that do not fit the offer or itinerary. */
export const passengersInvalid = (issues: PassengerIssue[]): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'passengers-invalid',
    'Check the traveller details',
    'Some traveller details do not match the booking.',
    { issues },
  );

export const extrasInvalid = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'extras-invalid',
    'These extras cannot be added',
    'Choose the extras again.',
  );

export const bookingConflict = (
  detail = 'Reload the booking and try again.',
): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.CONFLICT,
    'booking-status-conflict',
    'The booking cannot do this now',
    detail,
  );

export const bookingExpired = (request: unknown): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.GONE,
    'booking-expired',
    'This booking has expired',
    'Prices are only held for a short time. Search again with the same details.',
    { request },
  );

export const priceConsentMismatch = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.CONFLICT,
    'price-consent-mismatch',
    'The price has changed again',
    'Review the latest price before you continue.',
  );

export const travellerLimit = (max: number): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.CONFLICT,
    'traveller-limit',
    'Saved traveller limit reached',
    `You can keep up to ${max} travellers. Remove one to add another.`,
  );

export const invalidWebhook = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.BAD_REQUEST,
    'invalid-webhook',
    'Webhook rejected',
    'The signature or payload is invalid.',
  );

export const paymentClosed = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.CONFLICT,
    'payment-closed',
    'This payment can no longer be completed',
    'Go back to the booking to start a new payment.',
  );

export interface PriceChangeDetails {
  previous: { amountMinor: number; currency: string };
  current: { amountMinor: number; currency: string };
  difference: { amountMinor: number; currency: string };
  price: unknown;
}

/** The re-price right before payment moved the total: the traveller must consent first. */
export const priceChanged = (priceChange: PriceChangeDetails): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.CONFLICT,
    'price-changed',
    'The price has changed',
    'The supplier changed the price. Review the new total to continue.',
    { priceChange },
  );
