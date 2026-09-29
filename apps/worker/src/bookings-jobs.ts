import { UnrecoverableError } from 'bullmq';

import {
  InternalApiError,
  type BookingsApi,
  type ExpiryRun,
  type PaymentRun,
  type PlanRun,
  type RefundRun,
  type TicketingRun,
} from './internal-api.js';
import { type Logger } from './logger.js';

/**
 * Booking and money housekeeping (ADR-014, ADR-016 to ADR-019). Sweeps run every minute through
 * the API's internal routes: unpaid bookings past their payment deadline expire; paid bookings
 * are ticketed (first attempts the API could not start, plus retries whose backoff has elapsed);
 * pending payments whose webhook never came are verified with the provider; payment plans get
 * their reminders and are closed on a missed payment; approved refunds are sent and pending ones
 * followed up. The API owns the state machine, the ledger, locking and backoff; the worker only
 * keeps the clock.
 */
export const BOOKINGS_QUEUE = 'bookings';

export const BOOKING_JOB = {
  expire: 'bookings-expire',
  ticket: 'bookings-ticket',
  reconcile: 'bookings-reconcile-payments',
  plans: 'bookings-payment-plans',
  refunds: 'bookings-refunds',
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
): Promise<ExpiryRun | TicketingRun | PaymentRun | PlanRun | RefundRun> {
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
    case BOOKING_JOB.reconcile: {
      const result = await sweep(() => deps.api.reconcilePayments());
      if (result.settled > 0) deps.logger.info(result, 'payments settled by reconciliation');
      return result;
    }
    case BOOKING_JOB.plans: {
      const result = await sweep(() => deps.api.processDuePaymentPlans());
      if (result.reminders > 0 || result.expired > 0)
        deps.logger.info(result, 'payment plans processed');
      if (result.defaulted > 0) {
        deps.logger.warn(
          { defaulted: result.defaulted },
          'payment plans closed on a missed payment',
        );
      }
      return result;
    }
    case BOOKING_JOB.refunds: {
      const result = await sweep(() => deps.api.processDueRefunds());
      if (result.executed > 0 || result.settled > 0) deps.logger.info(result, 'refunds processed');
      if (result.review > 0) {
        deps.logger.warn({ review: result.review }, 'refunds need an operations review');
      }
      return result;
    }
    default:
      throw new UnrecoverableError(`unknown job ${job.name}`);
  }
}
