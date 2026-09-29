import { UnrecoverableError } from 'bullmq';

import {
  InternalApiError,
  type BookingsApi,
  type ExpiryRun,
  type TicketingRun,
} from './internal-api.js';
import { type Logger } from './logger.js';

/**
 * Booking housekeeping (ADR-014). Two sweeps run every minute through the API's internal routes:
 * unpaid bookings past their payment deadline expire, and paid bookings are ticketed (first
 * attempts the API could not start, plus retries whose backoff has elapsed). The API owns the
 * state machine, locking and backoff; the worker only keeps the clock.
 */
export const BOOKINGS_QUEUE = 'bookings';

export const BOOKING_JOB = {
  expire: 'bookings-expire',
  ticket: 'bookings-ticket',
} as const;

export interface BookingJobDeps {
  api: BookingsApi;
  logger: Logger;
}

/** A sweep that failed for good (bad token, missing route) is not retried until the next tick. */
async function sweep<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof InternalApiError && !error.retryable) {
      throw new UnrecoverableError(error.message);
    }
    throw error;
  }
}

export async function processBookingJob(
  job: { name: string },
  deps: BookingJobDeps,
): Promise<ExpiryRun | TicketingRun> {
  switch (job.name) {
    case BOOKING_JOB.expire: {
      const result = await sweep(() => deps.api.expireDueBookings());
      if (result.expired > 0) deps.logger.info(result, 'unpaid bookings expired');
      return result;
    }
    case BOOKING_JOB.ticket: {
      const result = await sweep(() => deps.api.ticketDueBookings());
      if (result.attempted > 0) deps.logger.info(result, 'ticketing attempts made');
      if (result.exhausted > 0) {
        deps.logger.warn(
          { exhausted: result.exhausted },
          'ticketing retries exhausted: bookings moved to REFUND_PENDING',
        );
      }
      return result;
    }
    default:
      throw new UnrecoverableError(`unknown job ${job.name}`);
  }
}
