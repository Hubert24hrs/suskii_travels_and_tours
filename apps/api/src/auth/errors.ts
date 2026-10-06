import { HttpStatus } from '@nestjs/common';

import { ProblemDetailsException } from '../common/problem-details';

// Auth errors are deliberately generic: they never reveal whether an account exists, which
// factor failed, or why a token was rejected beyond what the client must do next.

export const invalidCredentials = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.UNAUTHORIZED,
    'invalid-credentials',
    'Invalid credentials',
    'The sign-in details are incorrect.',
  );

export const authenticationRequired = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.UNAUTHORIZED,
    'authentication-required',
    'Authentication required',
  );

export const invalidToken = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.UNAUTHORIZED,
    'invalid-token',
    'Invalid or expired token',
    'Refresh the session or sign in again.',
  );

export const sessionRevoked = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.UNAUTHORIZED,
    'session-revoked',
    'Session ended',
    'This session was signed out. Sign in again.',
  );

export const invalidCode = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.UNAUTHORIZED,
    'invalid-code',
    'Invalid code',
    'The code is incorrect or has expired.',
  );

export const csrfFailed = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.FORBIDDEN,
    'csrf-failed',
    'CSRF check failed',
    'Send the X-CSRF-Token header with cookie-authenticated requests.',
  );

export const forbidden = (): ProblemDetailsException =>
  new ProblemDetailsException(HttpStatus.FORBIDDEN, 'forbidden', 'Forbidden');

export const mfaRequired = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.FORBIDDEN,
    'mfa-required',
    'Multi-factor authentication required',
    'Staff accounts must sign in with an authenticator app to use admin routes.',
  );

export const tooManyAttempts = (retryAfterSeconds: number): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.TOO_MANY_REQUESTS,
    'too-many-attempts',
    'Too many attempts',
    'Wait before trying again.',
    { retryAfterSeconds },
    { 'Retry-After': String(retryAfterSeconds) },
  );

export const passwordBreached = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'password-breached',
    'Choose a different password',
    'This password has appeared in a data breach. Use a unique password.',
  );

export const passwordGuessable = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'password-guessable',
    'Choose a different password',
    'This password contains our name or your own details. Use something only you would think of.',
  );

export const invalidOrExpiredLink = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.BAD_REQUEST,
    'invalid-or-expired-link',
    'Invalid or expired link',
    'Request a new link and try again.',
  );
