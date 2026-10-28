import { UnrecoverableError } from 'bullmq';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';

import {
  ACCOUNT_JOB,
  BOOKING_JOB,
  FINANCE_JOB,
  processBookingJob,
  VISA_JOB,
} from './bookings-jobs.js';
import { InternalApiError, type BookingsApi } from './internal-api.js';

const fakeApi = (overrides: Partial<BookingsApi> = {}): BookingsApi => ({
  expireDueBookings: vi.fn(() => Promise.resolve({ expired: 2 })),
  ticketDueBookings: vi.fn(() =>
    Promise.resolve({ attempted: 3, confirmed: 1, retrying: 1, exhausted: 1 }),
  ),
  reconcilePayments: vi.fn(() => Promise.resolve({ checked: 2, settled: 1 })),
  processDuePaymentPlans: vi.fn(() => Promise.resolve({ reminders: 1, defaulted: 1, expired: 0 })),
  processDueRefunds: vi.fn(() => Promise.resolve({ executed: 2, settled: 1, review: 1 })),
  checkScheduleChanges: vi.fn(() =>
    Promise.resolve({ checked: 4, detected: 1, resolved: 0, failed: 1 }),
  ),
  scanDueVisaDocuments: vi.fn(() =>
    Promise.resolve({ scanned: 3, clean: 1, infected: 1, failed: 1 }),
  ),
  pruneVisaDocuments: vi.fn(() => Promise.resolve({ deleted: 4 })),
  runReminders: vi.fn(() => Promise.resolve({ checkin: 2, prime: 1 })),
  runReferrals: vi.fn(() => Promise.resolve({ qualified: 1, review: 1, rewarded: 1 })),
  runReviewInvitations: vi.fn(() => Promise.resolve({ planned: 3, sent: 2, skipped: 1 })),
  runAdConversions: vi.fn(() => Promise.resolve({ sent: 2, retried: 1, failed: 1, withdrawn: 0 })),
  runRetention: vi.fn(() =>
    Promise.resolve({
      sessions: 3,
      'device-credentials': 0,
      'verification-tokens': 0,
      'idempotency-keys': 5,
      'booking-access-links': 0,
      offers: 2,
      'webhook-events': 0,
      notifications: 0,
      'search-logs': 0,
      'newsletter-pending': 0,
      'cookie-consents': 0,
      'closed-bookings': 1,
      'bus-seat-holds': 4,
      'ticket-scans': 0,
      'ride-offers': 6,
      'ride-location-pings': 120,
      'ride-locations': 2,
      'ride-share-links': 1,
      'safety-incidents': 0,
      'driver-documents': 0,
      'driver-payouts': 0,
      'reconciliation-discrepancies': 0,
      'rental-licences': 0,
      'rental-photos': 0,
      'partner-clicks': 0,
      'partner-conversions': 0,
      'rejected-reviews': 0,
      'company-invitations': 0,
      'company-top-ups': 0,
      'ad-conversions': 0,
      'metasearch-landings': 0,
      'support-conversations': 0,
      'whatsapp-contacts': 0,
      'supplier-customer-ip': 0,
      'status-incidents': 0,
    }),
  ),
  reconcileLedger: vi.fn(() => Promise.resolve({ checked: 12, discrepancies: 1, unconfirmed: 2 })),
  runDriverPayouts: vi.fn(() => Promise.resolve({ sent: 3, paid: 2, failed: 1, pending: 0 })),
  ...overrides,
});

const logger = () => {
  const log = pino({ level: 'silent' });
  return Object.assign(log, { info: vi.fn(), warn: vi.fn() });
};

describe('retention sweep', () => {
  it('runs the daily sweep and logs what it removed', async () => {
    const api = fakeApi();
    const log = logger();
    const result = await processBookingJob({ name: ACCOUNT_JOB.retention }, { api, logger: log });
    expect(result).toMatchObject({ sessions: 3, 'closed-bookings': 1 });
    expect(log.info).toHaveBeenCalledWith(result, 'records past retention purged');
  });
});

describe('finance sweeps', () => {
  it('reconciles the ledger and warns finance about discrepancies', async () => {
    const api = fakeApi();
    const log = logger();
    await expect(
      processBookingJob({ name: FINANCE_JOB.reconcileLedger }, { api, logger: log }),
    ).resolves.toEqual({ checked: 12, discrepancies: 1, unconfirmed: 2 });
    expect(log.warn).toHaveBeenCalledWith(
      { discrepancies: 1 },
      'ledger reconciliation raised discrepancies for finance',
    );
    const clean = fakeApi({
      reconcileLedger: vi.fn(() =>
        Promise.resolve({ checked: 4, discrepancies: 0, unconfirmed: 0 }),
      ),
    });
    const quiet = logger();
    await processBookingJob({ name: FINANCE_JOB.reconcileLedger }, { api: clean, logger: quiet });
    expect(quiet.warn).not.toHaveBeenCalled();
    expect(quiet.info).toHaveBeenCalledWith(
      { checked: 4, discrepancies: 0, unconfirmed: 0 },
      'ledger reconciled',
    );
  });

  it('runs driver payouts and reports failures', async () => {
    const api = fakeApi();
    const log = logger();
    await processBookingJob({ name: FINANCE_JOB.driverPayouts }, { api, logger: log });
    expect(api.runDriverPayouts).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledWith(
      { sent: 3, paid: 2, failed: 1, pending: 0 },
      'driver payouts processed',
    );
    expect(log.warn).toHaveBeenCalledWith({ failed: 1 }, 'driver payouts failed');
  });

  it('stops a payout run on a final API error', async () => {
    const api = fakeApi({
      runDriverPayouts: vi.fn(() => Promise.reject(new InternalApiError('runDriverPayouts', 401))),
    });
    await expect(
      processBookingJob({ name: FINANCE_JOB.driverPayouts }, { api, logger: logger() }),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });
});

describe('account sweeps', () => {
  it('sends reminders and processes referrals, flagging reviews', async () => {
    const api = fakeApi();
    const log = logger();
    await expect(
      processBookingJob({ name: ACCOUNT_JOB.reminders }, { api, logger: log }),
    ).resolves.toEqual({ checkin: 2, prime: 1 });
    expect(log.info).toHaveBeenCalledWith({ checkin: 2, prime: 1 }, 'reminders sent');
    await expect(
      processBookingJob({ name: ACCOUNT_JOB.referrals }, { api, logger: log }),
    ).resolves.toEqual({ qualified: 1, review: 1, rewarded: 1 });
    expect(log.warn).toHaveBeenCalledWith({ review: 1 }, 'referrals need review');
  });

  it('sends review invitations and logs only when some went out', async () => {
    const api = fakeApi();
    const log = logger();
    await expect(
      processBookingJob({ name: ACCOUNT_JOB.reviewInvitations }, { api, logger: log }),
    ).resolves.toEqual({ planned: 3, sent: 2, skipped: 1 });
    expect(log.info).toHaveBeenCalledWith(
      { planned: 3, sent: 2, skipped: 1 },
      'review invitations sent',
    );
    const quiet = logger();
    await processBookingJob(
      { name: ACCOUNT_JOB.reviewInvitations },
      {
        api: fakeApi({
          runReviewInvitations: vi.fn(() => Promise.resolve({ planned: 5, sent: 0, skipped: 0 })),
        }),
        logger: quiet,
      },
    );
    expect(quiet.info).not.toHaveBeenCalled();
  });

  it('sends ad conversions and warns when some were given up (ADR-079)', async () => {
    const log = logger();
    await expect(
      processBookingJob({ name: ACCOUNT_JOB.adConversions }, { api: fakeApi(), logger: log }),
    ).resolves.toEqual({ sent: 2, retried: 1, failed: 1, withdrawn: 0 });
    expect(log.info).toHaveBeenCalledWith(
      { sent: 2, retried: 1, failed: 1, withdrawn: 0 },
      'ad conversions sent',
    );
    expect(log.warn).toHaveBeenCalledWith({ failed: 1 }, 'ad conversions given up after retries');
  });

  it('stops on a final failure until the next tick', async () => {
    const api = fakeApi({
      runReminders: vi.fn(() => Promise.reject(new InternalApiError('runReminders', 404))),
    });
    await expect(
      processBookingJob({ name: ACCOUNT_JOB.reminders }, { api, logger: logger() }),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });
});

describe('booking jobs', () => {
  it('expires due bookings through the API', async () => {
    const api = fakeApi();
    const log = logger();
    await expect(
      processBookingJob({ name: BOOKING_JOB.expire }, { api, logger: log }),
    ).resolves.toEqual({
      expired: 2,
    });
    expect(api.expireDueBookings).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledWith({ expired: 2 }, 'unpaid bookings expired');
  });

  it('runs the ticketing sweep and warns when a booking needs a refund', async () => {
    const api = fakeApi();
    const log = logger();
    await processBookingJob({ name: BOOKING_JOB.ticket }, { api, logger: log });
    expect(api.ticketDueBookings).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(
      { exhausted: 1 },
      'ticketing retries exhausted: bookings moved to REFUND_PENDING',
    );
  });

  it('stays quiet when there is nothing to do', async () => {
    const api = fakeApi({
      expireDueBookings: vi.fn(() => Promise.resolve({ expired: 0 })),
      ticketDueBookings: vi.fn(() =>
        Promise.resolve({ attempted: 0, confirmed: 0, retrying: 0, exhausted: 0 }),
      ),
    });
    const log = logger();
    await processBookingJob({ name: BOOKING_JOB.expire }, { api, logger: log });
    await processBookingJob({ name: BOOKING_JOB.ticket }, { api, logger: log });
    expect(log.info).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('gives up on final API errors and rethrows transient ones', async () => {
    const final = fakeApi({
      ticketDueBookings: vi.fn(() =>
        Promise.reject(new InternalApiError('ticketDueBookings', 401)),
      ),
    });
    await expect(
      processBookingJob({ name: BOOKING_JOB.ticket }, { api: final, logger: logger() }),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    const transient = fakeApi({
      expireDueBookings: vi.fn(() =>
        Promise.reject(new InternalApiError('expireDueBookings', 503)),
      ),
    });
    await expect(
      processBookingJob({ name: BOOKING_JOB.expire }, { api: transient, logger: logger() }),
    ).rejects.toBeInstanceOf(InternalApiError);

    await expect(
      processBookingJob({ name: 'nope' }, { api: fakeApi(), logger: logger() }),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('runs the money sweeps and warns about defaults and refunds needing review', async () => {
    const api = fakeApi();
    const log = logger();
    await expect(
      processBookingJob({ name: BOOKING_JOB.reconcile }, { api, logger: log }),
    ).resolves.toEqual({ checked: 2, settled: 1 });
    await processBookingJob({ name: BOOKING_JOB.plans }, { api, logger: log });
    await processBookingJob({ name: BOOKING_JOB.refunds }, { api, logger: log });
    expect(api.reconcilePayments).toHaveBeenCalledTimes(1);
    expect(api.processDuePaymentPlans).toHaveBeenCalledTimes(1);
    expect(api.processDueRefunds).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledWith(
      { checked: 2, settled: 1 },
      'payments settled by reconciliation',
    );
    expect(log.warn).toHaveBeenCalledWith(
      { defaulted: 1 },
      'payment plans closed on a missed payment',
    );
    expect(log.warn).toHaveBeenCalledWith({ review: 1 }, 'refunds need an operations review');
  });

  it('checks ticketed flights for airline schedule changes and warns about failed checks', async () => {
    const api = fakeApi();
    const log = logger();
    await expect(
      processBookingJob({ name: BOOKING_JOB.scheduleChanges }, { api, logger: log }),
    ).resolves.toEqual({ checked: 4, detected: 1, resolved: 0, failed: 1 });
    expect(api.checkScheduleChanges).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledWith(
      { checked: 4, detected: 1, resolved: 0, failed: 1 },
      'airline schedule changes found',
    );
    expect(log.warn).toHaveBeenCalledWith({ failed: 1 }, 'airline schedule change checks failed');
  });

  it('rescans lost visa document scans and prunes documents past retention', async () => {
    const api = fakeApi();
    const log = logger();
    await expect(processBookingJob({ name: VISA_JOB.scan }, { api, logger: log })).resolves.toEqual(
      { scanned: 3, clean: 1, infected: 1, failed: 1 },
    );
    expect(log.warn).toHaveBeenCalledWith(
      { infected: 1, failed: 1 },
      'visa document scans found infected files or failed',
    );
    await expect(
      processBookingJob({ name: VISA_JOB.prune }, { api, logger: log }),
    ).resolves.toEqual({ deleted: 4 });
    expect(api.pruneVisaDocuments).toHaveBeenCalledTimes(1);
  });
});
