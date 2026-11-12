import { UnrecoverableError } from 'bullmq';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { InternalApiError, type RidesApi } from './internal-api.js';
import { processRideJob, RIDE_JOB } from './rides-jobs.js';

const fakeApi = (overrides: Partial<RidesApi> = {}): RidesApi => ({
  dispatchRides: vi.fn(() => Promise.resolve({ started: 1, offered: 3, expired: 2, timedOut: 1 })),
  scanDueDriverDocuments: vi.fn(() => Promise.resolve({ scanned: 2 })),
  ...overrides,
});

const logger = () => {
  const log = pino({ level: 'silent' });
  return Object.assign(log, { info: vi.fn(), warn: vi.fn(), debug: vi.fn() });
};

describe('rides jobs', () => {
  it('dispatches rides and warns about rides that found no driver', async () => {
    const api = fakeApi();
    const log = logger();
    const result = await processRideJob({ name: RIDE_JOB.dispatch }, { api, logger: log });
    expect(result).toEqual({ started: 1, offered: 3, expired: 2, timedOut: 1 });
    expect(api.dispatchRides).toHaveBeenCalledOnce();
    expect(log.warn).toHaveBeenCalledWith({ timedOut: 1 }, expect.any(String));
  });

  it('rescans driver documents', async () => {
    const api = fakeApi();
    const log = logger();
    await expect(
      processRideJob({ name: RIDE_JOB.driverDocuments }, { api, logger: log }),
    ).resolves.toEqual({ scanned: 2 });
    expect(log.info).toHaveBeenCalledOnce();
  });

  it('does not retry a run the API refused for good', async () => {
    const api = fakeApi({
      dispatchRides: () => Promise.reject(new InternalApiError('dispatchRides', 401, 'req-1')),
    });
    await expect(
      processRideJob({ name: RIDE_JOB.dispatch }, { api, logger: logger() }),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('rejects unknown jobs', async () => {
    await expect(
      processRideJob({ name: 'nope' }, { api: fakeApi(), logger: logger() }),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });
});
