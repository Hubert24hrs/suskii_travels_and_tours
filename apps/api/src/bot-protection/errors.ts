import { HttpStatus } from '@nestjs/common';

import { ProblemDetailsException } from '../common/problem-details';

/** A Turnstile token or device attestation was missing or did not verify. */
export const botCheckFailed = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.BAD_REQUEST,
    'bot-check-failed',
    'We could not verify this request',
    'Refresh the page and try again.',
  );
