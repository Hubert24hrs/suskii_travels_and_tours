import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import type { Money } from '@suskii/shared';

export interface PayoutRequest {
  /** Our idempotency key for the transfer (`payout:{id}`). */
  reference: string;
  amount: Money;
  bankCode: string;
  accountNumber: string;
  accountName: string;
}

export interface PayoutResult {
  status: 'paid' | 'pending' | 'failed';
  providerReference: string;
}

/** Driver payouts to bank accounts (ADR-051). Real providers are an owner decision. */
export abstract class PayoutProvider {
  abstract readonly name: string;
  /** Idempotent by `reference`: sending the same payout twice pays once. */
  abstract send(request: PayoutRequest): Promise<PayoutResult>;
}

/**
 * Development and test payouts (refused in production with rides on, unless
 * ALLOW_MOCK_PROVIDERS): account numbers ending `0000` fail; everything else is paid at once.
 */
@Injectable()
export class MockPayoutProvider extends PayoutProvider {
  readonly name = 'mock';
  private readonly sent = new Map<string, PayoutResult>();

  send(request: PayoutRequest): Promise<PayoutResult> {
    const previous = this.sent.get(request.reference);
    if (previous) return Promise.resolve(previous);
    const result: PayoutResult = {
      status: request.accountNumber.endsWith('0000') ? 'failed' : 'paid',
      providerReference: `mock-po-${createHash('sha256').update(request.reference).digest('hex').slice(0, 12)}`,
    };
    this.sent.set(request.reference, result);
    return Promise.resolve(result);
  }
}
