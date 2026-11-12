import { HttpStatus } from '@nestjs/common';

import { ProblemDetailsException } from '../common/problem-details';
import type { ValidationIssue } from '../contract/contract.interceptor';

/** Results expired: the original request is returned so clients can search again unchanged. */
export const searchExpired = (request: unknown): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.GONE,
    'search-expired',
    'Search results expired',
    'Prices change quickly. Search again to see current fares.',
    { request },
  );

export const offerUnavailable = (request: unknown): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.GONE,
    'offer-unavailable',
    'This offer is no longer available',
    'It expired or sold out. Search again with the same details.',
    { request },
  );

export const searchUnavailable = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.SERVICE_UNAVAILABLE,
    'search-unavailable',
    'Search is temporarily unavailable',
    'None of our suppliers answered. Try again in a moment.',
    {},
    { 'Retry-After': '30' },
  );

export const supplierUnavailable = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.SERVICE_UNAVAILABLE,
    'supplier-unavailable',
    'Could not confirm the price',
    'The supplier did not respond. Try again in a moment.',
    {},
    { 'Retry-After': '10' },
  );

export const quoteExpired = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.GONE,
    'quote-expired',
    'This quote has expired',
    'Confirm the price again.',
  );

/** One message for every failure, so codes cannot be enumerated. */
export const promoInvalid = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'promo-invalid',
    'This code cannot be applied',
    'Check the code and the booking it applies to.',
  );

export const invalidSearch = (errors: ValidationIssue[]): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.BAD_REQUEST,
    'validation-failed',
    'Validation failed',
    'One or more fields are invalid.',
    { errors },
  );
