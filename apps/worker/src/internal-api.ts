import { randomUUID } from 'node:crypto';

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
export type PriceAlertRun = components['schemas']['PriceAlertRun'];
export type ReferralRun = components['schemas']['ReferralRun'];
export type ReminderRun = components['schemas']['ReminderRun'];
export type RetentionRun = components['schemas']['RetentionRun'];

/** A failed internal API call. `status` 0 means the API was unreachable or timed out. */
export class InternalApiError extends Error {
  constructor(
    readonly operation: string,
    readonly status: number,
    /** The `X-Request-Id` sent with the call; the API logs the same id. */
    readonly requestId?: string,
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
  /** Due price alerts: supplier searches, so they run on the rate-limited refresh queue. */
  readonly runPriceAlerts: () => Promise<PriceAlertRun>;
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
  /** Check-in and Suskii Prime reminders (ADR-030, ADR-032). */
  readonly runReminders: () => Promise<ReminderRun>;
  /** Referral qualification and rewards (ADR-031). */
  readonly runReferrals: () => Promise<ReferralRun>;
  /** Records past their retention period are purged; long-closed bookings anonymised (ADR-039). */
  readonly runRetention: () => Promise<RetentionRun>;
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
/** The first daily sweep after a backlog can delete many rows; later ones find little. */
const RETENTION_TIMEOUT_MS = 300_000;
/** A batch of price alerts runs a search per distinct route and date (cache hits are quick). */
const PRICE_ALERT_TIMEOUT_MS = 300_000;

export function createInternalApi(options: InternalApiOptions): InternalApi & BookingsApi {
  const client = createClient<paths>({
    baseUrl: options.baseUrl.replace(/\/$/, ''),
    headers: { Authorization: `Bearer ${options.token}` },
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const timeoutMs = options.timeoutMs ?? 60_000;

  // Every call carries its own request id, so a failed sweep can be found in the API's logs.
  const call = async <T>(
    operation: string,
    request: (
      signal: AbortSignal,
      headers: Record<string, string>,
    ) => Promise<{ data?: T; response: Response }>,
    timeout = timeoutMs,
  ): Promise<T> => {
    const requestId = `worker-${randomUUID()}`;
    let result: { data?: T; response: Response };
    try {
      result = await request(AbortSignal.timeout(timeout), { 'X-Request-Id': requestId });
    } catch {
      throw new InternalApiError(operation, 0, requestId);
    }
    if (result.data === undefined)
      throw new InternalApiError(operation, result.response.status, requestId);
    return result.data;
  };

  return {
    refreshTargets: () =>
      call('listRefreshTargets', (signal, headers) =>
        client.GET('/v1/internal/refresh-targets', { signal, headers }),
      ),
    refreshDealRoute: (routeId) =>
      call('refreshDealRoute', (signal, headers) =>
        client.POST('/v1/internal/deals/routes/{routeId}/refresh', {
          params: { path: { routeId } },
          signal,
          headers,
        }),
      ),
    refreshDestination: (destinationId) =>
      call('refreshHotelDestination', (signal, headers) =>
        client.POST('/v1/internal/destinations/{destinationId}/refresh', {
          params: { path: { destinationId } },
          signal,
          headers,
        }),
      ),
    pruneSnapshots: () =>
      call('pruneSnapshots', (signal, headers) =>
        client.POST('/v1/internal/snapshots/prune', { signal, headers }),
      ),
    prunePushTokens: () =>
      call('prunePushTokens', (signal, headers) =>
        client.POST('/v1/internal/push-tokens/prune', { signal, headers }),
      ),
    expireDueBookings: () =>
      call('expireDueBookings', (signal, headers) =>
        client.POST('/v1/internal/bookings/expire-due', { signal, headers }),
      ),
    // The API stops starting attempts after 20 s, but one supplier booking may take up to 45 s.
    ticketDueBookings: () =>
      call(
        'ticketDueBookings',
        (signal, headers) => client.POST('/v1/internal/bookings/ticket-due', { signal, headers }),
        TICKETING_TIMEOUT_MS,
      ),
    reconcilePayments: () =>
      call(
        'reconcileBookingPayments',
        (signal, headers) =>
          client.POST('/v1/internal/bookings/reconcile-payments', { signal, headers }),
        MONEY_SWEEP_TIMEOUT_MS,
      ),
    processDuePaymentPlans: () =>
      call(
        'processDuePaymentPlans',
        (signal, headers) =>
          client.POST('/v1/internal/bookings/payment-plans-due', { signal, headers }),
        MONEY_SWEEP_TIMEOUT_MS,
      ),
    processDueRefunds: () =>
      call(
        'processDueRefunds',
        (signal, headers) => client.POST('/v1/internal/bookings/refunds-due', { signal, headers }),
        MONEY_SWEEP_TIMEOUT_MS,
      ),
    scanDueVisaDocuments: () =>
      call(
        'scanDueVisaDocuments',
        (signal, headers) => client.POST('/v1/internal/visa/scan-due', { signal, headers }),
        MONEY_SWEEP_TIMEOUT_MS,
      ),
    pruneVisaDocuments: () =>
      call('pruneVisaDocuments', (signal, headers) =>
        client.POST('/v1/internal/visa/prune', { signal, headers }),
      ),
    runPriceAlerts: () =>
      call(
        'runPriceAlerts',
        (signal, headers) => client.POST('/v1/internal/price-alerts/run', { signal, headers }),
        PRICE_ALERT_TIMEOUT_MS,
      ),
    runReminders: () =>
      call('runReminders', (signal, headers) =>
        client.POST('/v1/internal/reminders/run', { signal, headers }),
      ),
    runReferrals: () =>
      call(
        'runReferrals',
        (signal, headers) => client.POST('/v1/internal/referrals/run', { signal, headers }),
        MONEY_SWEEP_TIMEOUT_MS,
      ),
    runRetention: () =>
      call(
        'runRetention',
        (signal, headers) => client.POST('/v1/internal/retention/run', { signal, headers }),
        RETENTION_TIMEOUT_MS,
      ),
  };
}
