import { describe, expect, it, vi } from 'vitest';

import { createInternalApi, type InternalApiError } from './internal-api.js';

const TOKEN = 't'.repeat(40);
const ROUTE_ID = '01920000-0000-7000-8000-000000000001';

/** Awaits a call that must fail and returns its error. */
const failure = async (call: Promise<unknown>): Promise<InternalApiError> => {
  try {
    await call;
  } catch (error) {
    return error as InternalApiError;
  }
  throw new Error('expected the call to fail');
};

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('internal API client', () => {
  it('calls the typed internal routes with the service token', async () => {
    const fetch = vi.fn((request: Request) =>
      Promise.resolve(
        request.url.endsWith('/refresh-targets')
          ? reply(200, { dealRoutes: [], hotelDestinations: [] })
          : reply(200, {
              status: 'refreshed',
              snapshotId: 'x',
              fetchedAt: '2026-10-01T00:00:00.000Z',
            }),
      ),
    );
    const api = createInternalApi({
      baseUrl: 'http://api.internal:4000/',
      token: TOKEN,
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    await expect(api.refreshTargets()).resolves.toEqual({ dealRoutes: [], hotelDestinations: [] });
    await expect(api.refreshDealRoute(ROUTE_ID)).resolves.toMatchObject({ status: 'refreshed' });

    const requests = fetch.mock.calls.map(([request]) => request);
    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      'GET http://api.internal:4000/v1/internal/refresh-targets',
      `POST http://api.internal:4000/v1/internal/deals/routes/${ROUTE_ID}/refresh`,
    ]);
    expect(requests[0]?.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
  });

  it('calls the booking sweep routes', async () => {
    const fetch = vi.fn((request: Request) =>
      Promise.resolve(
        request.url.endsWith('/expire-due')
          ? reply(200, { expired: 1 })
          : reply(200, { attempted: 1, confirmed: 1, retrying: 0, exhausted: 0 }),
      ),
    );
    const api = createInternalApi({
      baseUrl: 'http://api.internal:4000',
      token: TOKEN,
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    await expect(api.expireDueBookings()).resolves.toEqual({ expired: 1 });
    await expect(api.ticketDueBookings()).resolves.toMatchObject({ confirmed: 1 });
    expect(fetch.mock.calls.map(([request]) => `${request.method} ${request.url}`)).toEqual([
      'POST http://api.internal:4000/v1/internal/bookings/expire-due',
      'POST http://api.internal:4000/v1/internal/bookings/ticket-due',
    ]);
  });

  it('calls the money sweep routes', async () => {
    const replies: Record<string, unknown> = {
      'reconcile-payments': { checked: 1, settled: 1 },
      'payment-plans-due': { reminders: 2, defaulted: 0, expired: 1 },
      'refunds-due': { executed: 1, settled: 1, review: 0 },
    };
    const fetch = vi.fn((request: Request) =>
      Promise.resolve(reply(200, replies[request.url.split('/').pop() ?? ''] ?? {})),
    );
    const api = createInternalApi({
      baseUrl: 'http://api.internal:4000',
      token: TOKEN,
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    await expect(api.reconcilePayments()).resolves.toEqual({ checked: 1, settled: 1 });
    await expect(api.processDuePaymentPlans()).resolves.toMatchObject({ reminders: 2 });
    await expect(api.processDueRefunds()).resolves.toMatchObject({ executed: 1 });
    expect(fetch.mock.calls.map(([request]) => request.url)).toEqual([
      'http://api.internal:4000/v1/internal/bookings/reconcile-payments',
      'http://api.internal:4000/v1/internal/bookings/payment-plans-due',
      'http://api.internal:4000/v1/internal/bookings/refunds-due',
    ]);
  });

  it('calls the visa document routes', async () => {
    const replies: Record<string, unknown> = {
      'scan-due': { scanned: 1, clean: 1, infected: 0, failed: 0 },
      prune: { deleted: 2 },
    };
    const fetch = vi.fn((request: Request) =>
      Promise.resolve(reply(200, replies[request.url.split('/').pop() ?? ''] ?? {})),
    );
    const api = createInternalApi({
      baseUrl: 'http://api.internal:4000',
      token: TOKEN,
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    await expect(api.scanDueVisaDocuments()).resolves.toMatchObject({ clean: 1 });
    await expect(api.pruneVisaDocuments()).resolves.toEqual({ deleted: 2 });
    expect(fetch.mock.calls.map(([request]) => request.url)).toEqual([
      'http://api.internal:4000/v1/internal/visa/scan-due',
      'http://api.internal:4000/v1/internal/visa/prune',
    ]);
  });

  it('classifies failures as retryable or final', async () => {
    const statuses = [503, 429, 404, 401];
    const api = createInternalApi({
      baseUrl: 'http://api',
      token: TOKEN,
      fetch: vi.fn(() => Promise.resolve(reply(statuses.shift() ?? 500, { type: 'x' }))),
    });
    const errors: InternalApiError[] = [];
    for (let index = 0; index < 4; index += 1) {
      errors.push(await failure(api.refreshDealRoute(ROUTE_ID)));
    }
    expect(errors.map((error) => [error.status, error.retryable])).toEqual([
      [503, true],
      [429, true],
      [404, false],
      [401, false],
    ]);

    const offline = createInternalApi({
      baseUrl: 'http://api',
      token: TOKEN,
      fetch: vi.fn(() => Promise.reject(new TypeError('fetch failed'))),
    });
    await expect(offline.pruneSnapshots()).rejects.toMatchObject({ status: 0, retryable: true });
  });
});
