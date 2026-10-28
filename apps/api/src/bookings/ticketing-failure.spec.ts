import {
  CircuitOpenError,
  OfferUnavailableError,
  SupplierAmbiguousError,
  SupplierRequestError,
  SupplierTimeoutError,
  SupplierUnavailableError,
} from '../suppliers/supplier.errors';

import { ticketingFailure } from './ticketing.service';

describe('ticketingFailure', () => {
  const supplier = 'hotelbeds';

  it('retries failures that booked nothing', () => {
    for (const idempotent of [true, false]) {
      expect(ticketingFailure(new SupplierUnavailableError(supplier, 'down'), idempotent)).toEqual({
        retryable: true,
        reason: 'supplier_unavailable',
      });
      expect(ticketingFailure(new CircuitOpenError(supplier, 'open'), idempotent)).toEqual({
        retryable: true,
        reason: 'circuit_open',
      });
    }
  });

  it('retries a possible booking only with a supplier that dedupes on the key', () => {
    const unclear = new SupplierAmbiguousError(supplier, 'booking is PRECONFIRMED');
    expect(ticketingFailure(unclear, true)).toEqual({ retryable: true, reason: 'unconfirmed' });
    expect(ticketingFailure(unclear, false)).toEqual({
      retryable: false,
      reason: 'unconfirmed_needs_review',
    });
    expect(ticketingFailure(new SupplierTimeoutError(supplier, 'slow'), false)).toEqual({
      retryable: false,
      reason: 'timeout_needs_review',
    });
    expect(ticketingFailure(new Error('bug'), undefined)).toEqual({
      retryable: false,
      reason: 'internal_error_needs_review',
    });
  });

  it('stops at a definite refusal', () => {
    expect(ticketingFailure(new OfferUnavailableError(supplier, 'gone'), false)).toEqual({
      retryable: false,
      reason: 'offer_unavailable',
    });
    expect(ticketingFailure(new SupplierRequestError(supplier, 'bad'), true)).toEqual({
      retryable: false,
      reason: 'supplier_rejected',
    });
  });
});
