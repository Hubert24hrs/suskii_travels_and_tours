import { UnrecoverableError } from 'bullmq';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { BOOKING_JOB, processBookingJob } from './bookings-jobs.js';
import { InternalApiError, type BookingsApi } from './internal-api.js';

const fakeApi = (overrides: Partial<BookingsApi> = {}): BookingsApi => ({
  expireDueBookings: vi.fn(() => Promise.resolve({ expired: 2 })),
  ticketDueBookings: vi.fn(() =>
    Promise.resolve({ attempted: 3, confirmed: 1, retrying: 1, exhausted: 1 }),
  ),
  ...overrides,
});

const logger = () => {
  const log = pino({ level: 'silent' });
  return Object.assign(log, { info: vi.fn(), warn: vi.fn() });
};

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
});
