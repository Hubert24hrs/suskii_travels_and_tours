import { UnrecoverableError } from 'bullmq';

import {
  InternalApiError,
  type BookingsApi,
  type ExpiryRun,
  type PaymentRun,
  type PlanRun,
  type ReferralRun,
  type RefundRun,
  type ReminderRun,
  type RetentionRun,
  type TicketingRun,
  type VisaPruneRun,
  type VisaScanRun,
} from './internal-api.js';
import { type Logger } from './logger.js';

/**
 * Booking and money housekeeping (ADR-014, ADR-016 to ADR-019). Sweeps run every minute through
 * the API's internal routes: unpaid bookings past their payment deadline expire; paid bookings
 * are ticketed (first attempts the API could not start, plus retries whose backoff has elapsed);
 * pending payments whose webhook never came are verified with the provider; payment plans get
 * their reminders and are closed on a missed payment; approved refunds are sent and pending ones
 * followed up. Visa documents whose background scan was lost are scanned again every few
 * minutes, and documents past their retention period are deleted daily (ADR-026). Check-in and
 * Prime reminders and referral qualification run every few minutes (ADR-030, ADR-031), and the
 * retention sweep daily (ADR-039). The API owns
 * the state machine, the ledger, locking and backoff; the worker only keeps the clock.
 */
export const BOOKINGS_QUEUE = 'bookings';

export const BOOKING_JOB = {
  expire: 'bookings-expire',
  ticket: 'bookings-ticket',
  reconcile: 'bookings-reconcile-payments',
  plans: 'bookings-payment-plans',
  refunds: 'bookings-refunds',
} as const;

/** Visa document housekeeping, on the same queue with their own schedules. */
export const VISA_JOB = {
  scan: 'visa-documents-scan',
  prune: 'visa-documents-prune',
} as const;

/** Account sweeps (ADR-030 to ADR-032): database work only, so they share this queue. */
export const ACCOUNT_JOB = {
  reminders: 'accounts-reminders',
  referrals: 'accounts-referrals',
  /** The daily retention sweep (ADR-039). */
  retention: 'accounts-retention',
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
): Promise<
  | ExpiryRun
  | TicketingRun
  | PaymentRun
  | PlanRun
  | RefundRun
  | VisaScanRun
  | VisaPruneRun
  | ReminderRun
  | ReferralRun
  | RetentionRun
> {
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
    case VISA_JOB.scan: {
      const result = await sweep(() => deps.api.scanDueVisaDocuments());
      if (result.scanned > 0) deps.logger.info(result, 'visa documents scanned');
      if (result.infected > 0 || result.failed > 0) {
        deps.logger.warn(
          { infected: result.infected, failed: result.failed },
          'visa document scans found infected files or failed',
        );
      }
      return result;
    }
    case VISA_JOB.prune: {
      const result = await sweep(() => deps.api.pruneVisaDocuments());
      if (result.deleted > 0) deps.logger.info(result, 'visa documents past retention deleted');
      return result;
    }
    case ACCOUNT_JOB.reminders: {
      const result = await sweep(() => deps.api.runReminders());
      if (result.checkin > 0 || result.prime > 0) deps.logger.info(result, 'reminders sent');
      return result;
    }
    case ACCOUNT_JOB.referrals: {
      const result = await sweep(() => deps.api.runReferrals());
      if (result.qualified > 0 || result.rewarded > 0)
        deps.logger.info(result, 'referrals processed');
      if (result.review > 0) deps.logger.warn({ review: result.review }, 'referrals need review');
      return result;
    }
    case ACCOUNT_JOB.retention: {
      const result = await sweep(() => deps.api.runRetention());
      if (Object.values(result).some((count) => count > 0)) {
        deps.logger.info(result, 'records past retention purged');
      }
      return result;
    }
    default:
      throw new UnrecoverableError(`unknown job ${job.name}`);
  }
}
