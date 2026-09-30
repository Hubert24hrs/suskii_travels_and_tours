import type { components, paths } from '@suskii/api-client/schema';
import createClient from 'openapi-fetch';

export type RefreshTargets = components['schemas']['RefreshTargets'];
export type RefreshResult = components['schemas']['RefreshResult'];
export type PruneResult = components['schemas']['PruneResult'];
export type PushTokenPruneResult = components['schemas']['PushTokenPruneRun'];
export type ExpiryRun = components['schemas']['BookingExpiryRun'];
export type TicketingRun = components['schemas']['TicketingRun'];
export type PaymentRun = components['schemas']['PaymentReconciliationRun'];
export type PlanRun = components['schemas']['PaymentPlanRun'];
export type RefundRun = components['schemas']['RefundRun'];
export type VisaScanRun = components['schemas']['VisaScanRun'];
export type VisaPruneRun = components['schemas']['VisaPruneRun'];

/** A failed internal API call. `status` 0 means the API was unreachable or timed out. */
export class InternalApiError extends Error {
  constructor(
    readonly operation: string,
    readonly status: number,
  ) {
    super(`${operation} failed with status ${status}`);
    this.name = 'InternalApiError';
  }

  /** Worth retrying: the API or a supplier was unavailable, or we were rate limited. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

/** The worker's view of the API's /v1/internal routes (ADR-011). */
export interface InternalApi {
  readonly refreshTargets: () => Promise<RefreshTargets>;
  readonly refreshDealRoute: (routeId: string) => Promise<RefreshResult>;
  readonly refreshDestination: (destinationId: string) => Promise<RefreshResult>;
  readonly pruneSnapshots: () => Promise<PruneResult>;
  /** Push tokens of ended sessions, closed bookings and stale devices (ADR-022). */
  readonly prunePushTokens: () => Promise<PushTokenPruneResult>;
}

/**
 * Booking and money housekeeping routes (ADR-014, ADR-016 to ADR-019): expiry, ticketing retries,
 * payment reconciliation, payment plan reminders and defaults, and refund execution.
 */
export interface BookingsApi {
  readonly expireDueBookings: () => Promise<ExpiryRun>;
  readonly ticketDueBookings: () => Promise<TicketingRun>;
  readonly reconcilePayments: () => Promise<PaymentRun>;
  readonly processDuePaymentPlans: () => Promise<PlanRun>;
  readonly processDueRefunds: () => Promise<RefundRun>;
  /** Visa documents whose background virus scan did not finish (ADR-026). */
  readonly scanDueVisaDocuments: () => Promise<VisaScanRun>;
  /** Visa documents past their retention period. */
  readonly pruneVisaDocuments: () => Promise<VisaPruneRun>;
}

export interface InternalApiOptions {
  baseUrl: string;
  token: string;
  /** A refresh runs a few supplier searches (each within the 12 s search budget). */
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

/** Sweeps that call suppliers or payment providers: the API stops starting calls after 20 s. */
const TICKETING_TIMEOUT_MS = 120_000;
const MONEY_SWEEP_TIMEOUT_MS = 90_000;

export function createInternalApi(options: InternalApiOptions): InternalApi & BookingsApi {
  const client = createClient<paths>({
    baseUrl: options.baseUrl.replace(/\/$/, ''),
    headers: { Authorization: `Bearer ${options.token}` },
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const timeoutMs = options.timeoutMs ?? 60_000;

  const call = async <T>(
    operation: string,
    request: (signal: AbortSignal) => Promise<{ data?: T; response: Response }>,
    timeout = timeoutMs,
  ): Promise<T> => {
    let result: { data?: T; response: Response };
    try {
      result = await request(AbortSignal.timeout(timeout));
    } catch {
      throw new InternalApiError(operation, 0);
    }
    if (result.data === undefined) throw new InternalApiError(operation, result.response.status);
    return result.data;
  };

  return {
    refreshTargets: () =>
      call('listRefreshTargets', (signal) =>
        client.GET('/v1/internal/refresh-targets', { signal }),
      ),
    refreshDealRoute: (routeId) =>
      call('refreshDealRoute', (signal) =>
        client.POST('/v1/internal/deals/routes/{routeId}/refresh', {
          params: { path: { routeId } },
          signal,
        }),
      ),
    refreshDestination: (destinationId) =>
      call('refreshHotelDestination', (signal) =>
        client.POST('/v1/internal/destinations/{destinationId}/refresh', {
          params: { path: { destinationId } },
          signal,
        }),
      ),
    pruneSnapshots: () =>
      call('pruneSnapshots', (signal) => client.POST('/v1/internal/snapshots/prune', { signal })),
    prunePushTokens: () =>
      call('prunePushTokens', (signal) =>
        client.POST('/v1/internal/push-tokens/prune', { signal }),
      ),
    expireDueBookings: () =>
      call('expireDueBookings', (signal) =>
        client.POST('/v1/internal/bookings/expire-due', { signal }),
      ),
    // The API stops starting attempts after 20 s, but one supplier booking may take up to 45 s.
    ticketDueBookings: () =>
      call(
        'ticketDueBookings',
        (signal) => client.POST('/v1/internal/bookings/ticket-due', { signal }),
        TICKETING_TIMEOUT_MS,
      ),
    reconcilePayments: () =>
      call(
        'reconcileBookingPayments',
        (signal) => client.POST('/v1/internal/bookings/reconcile-payments', { signal }),
        MONEY_SWEEP_TIMEOUT_MS,
      ),
    processDuePaymentPlans: () =>
      call(
        'processDuePaymentPlans',
        (signal) => client.POST('/v1/internal/bookings/payment-plans-due', { signal }),
        MONEY_SWEEP_TIMEOUT_MS,
      ),
    processDueRefunds: () =>
      call(
        'processDueRefunds',
        (signal) => client.POST('/v1/internal/bookings/refunds-due', { signal }),
        MONEY_SWEEP_TIMEOUT_MS,
      ),
    scanDueVisaDocuments: () =>
      call(
        'scanDueVisaDocuments',
        (signal) => client.POST('/v1/internal/visa/scan-due', { signal }),
        MONEY_SWEEP_TIMEOUT_MS,
      ),
    pruneVisaDocuments: () =>
      call('pruneVisaDocuments', (signal) => client.POST('/v1/internal/visa/prune', { signal })),
  };
}
