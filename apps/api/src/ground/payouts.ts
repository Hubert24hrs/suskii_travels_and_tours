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
  /** The request's `reference`. */
  reference: string;
  status: 'paid' | 'pending' | 'failed';
  providerReference: string;
  /** Short provider code for a failure (`account_rejected`, ...); never bank details. */
  failureReason: string | null;
}

/** Driver payouts to bank accounts (ADR-051). Real providers are an owner decision. */
export abstract class PayoutProvider {
  abstract readonly name: string;
  /** Most transfers the provider takes in one batch. */
  abstract readonly maxBatch: number;
  /**
   * One bulk transfer. Idempotent by `reference`: sending the same payout again (after a lost
   * answer) pays once and returns its current state. Throws when the provider did not answer.
   */
  abstract sendBatch(requests: PayoutRequest[]): Promise<PayoutResult[]>;
  /** A transfer's current state, or null when the provider never received it. */
  abstract status(reference: string): Promise<PayoutResult | null>;
}

/**
 * Development and test payouts (refused in production with rides on, unless
 * ALLOW_MOCK_PROVIDERS): account numbers ending `0000` are rejected, ending `9999` stay pending
 * until `settlePending()`; everything else is paid at once.
 */
@Injectable()
export class MockPayoutProvider extends PayoutProvider {
  readonly name = 'mock';
  readonly maxBatch = 100;
  private readonly sent = new Map<string, PayoutResult>();
  /** Batches received, for tests. */
  readonly batches: string[][] = [];
  /** The next N batches throw as if the provider timed out after receiving them. */
  failNextBatches = 0;
  /** The next N batches throw before the provider records anything (lost on the way). */
  loseNextBatches = 0;

  sendBatch(requests: PayoutRequest[]): Promise<PayoutResult[]> {
    if (requests.length > this.maxBatch) {
      return Promise.reject(new Error(`A batch takes at most ${this.maxBatch} payouts`));
    }
    if (this.loseNextBatches > 0) {
      this.loseNextBatches -= 1;
      return Promise.reject(new Error('Mock payout provider unreachable'));
    }
    this.batches.push(requests.map((request) => request.reference));
    const results = requests.map((request) => {
      const previous = this.sent.get(request.reference);
      if (previous) return previous;
      const failed = request.accountNumber.endsWith('0000');
      const result: PayoutResult = {
        reference: request.reference,
        status: failed ? 'failed' : request.accountNumber.endsWith('9999') ? 'pending' : 'paid',
        providerReference: `mock-po-${createHash('sha256').update(request.reference).digest('hex').slice(0, 12)}`,
        failureReason: failed ? 'account_rejected' : null,
      };
      this.sent.set(request.reference, result);
      return result;
    });
    if (this.failNextBatches > 0) {
      this.failNextBatches -= 1;
      return Promise.reject(new Error('Mock payout provider timed out'));
    }
    return Promise.resolve(results);
  }

  status(reference: string): Promise<PayoutResult | null> {
    return Promise.resolve(this.sent.get(reference) ?? null);
  }

  /** Completes every pending transfer, as the bank would later. */
  settlePending(): void {
    for (const [reference, result] of this.sent) {
      if (result.status === 'pending') this.sent.set(reference, { ...result, status: 'paid' });
    }
  }
}
