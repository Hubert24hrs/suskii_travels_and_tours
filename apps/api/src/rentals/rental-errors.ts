import { HttpStatus } from '@nestjs/common';

import { ProblemDetailsException } from '../common/problem-details';

import type { RENTAL_QUOTE_ISSUES } from './rentals.schemas';

type RentalQuoteIssue = (typeof RENTAL_QUOTE_ISSUES)[keyof typeof RENTAL_QUOTE_ISSUES];

export const rentalQuoteInvalid = (code: RentalQuoteIssue): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'quote-invalid',
    'This rental cannot be booked',
    'Change the dates, the delivery address or the options and try again.',
    { code },
  );

/** The rental is not at the step this action needs (licence, handover order, deposit). */
export const rentalConflict = (title: string, detail?: string): ProblemDetailsException =>
  new ProblemDetailsException(HttpStatus.CONFLICT, 'rental-conflict', title, detail);
