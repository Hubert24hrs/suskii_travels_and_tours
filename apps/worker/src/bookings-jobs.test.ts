import { UnrecoverableError } from 'bullmq';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { ACCOUNT_JOB, BOOKING_JOB, processBookingJob, VISA_JOB } from './bookings-jobs.js';
import { InternalApiError, type BookingsApi } from './internal-api.js';

const fakeApi = (overrides: Partial<BookingsApi> = {}): BookingsApi => ({
  expireDueBookings: vi.fn(() => Promise.resolve({ expired: 2 })),
  ticketDueBookings: vi.fn(() =>
    Promise.resolve({ attempted: 3, confirmed: 1, retrying: 1, exhausted: 1 }),
  ),
  reconcilePayments: vi.fn(() => Promise.resolve({ checked: 2, settled: 1 })),
  processDuePaymentPlans: vi.fn(() => Promise.resolve({ reminders: 1, defaulted: 1, expired: 0 })),
  processDueRefunds: vi.fn(() => Promise.resolve({ executed: 2, settled: 1, review: 1 })),
  scanDueVisaDocuments: vi.fn(() =>
    Promise.resolve({ scanned: 3, clean: 1, infected: 1, failed: 1 }),
  ),
  pruneVisaDocuments: vi.fn(() => Promise.resolve({ deleted: 4 })),
  runReminders: vi.fn(() => Promise.resolve({ checkin: 2, prime: 1 })),
  runReferrals: vi.fn(() => Promise.resolve({ qualified: 1, review: 1, rewarded: 1 })),
  runRetention: vi.fn(() =>
    Promise.resolve({
      sessions: 3,
      'verification-tokens': 0,
      'idempotency-keys': 5,
      'booking-access-links': 0,
      offers: 2,
      'webhook-events': 0,
      notifications: 0,
      'search-logs': 0,
      'newsletter-pending': 0,
      'closed-bookings': 1,
    }),
  ),
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
