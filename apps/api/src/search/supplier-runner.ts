import { Inject, Injectable, Logger } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../config/config';
import { CircuitBreakerRegistry } from '../suppliers/circuit-breaker';
import { CircuitOpenError, SupplierTimeoutError, withTimeout } from '../suppliers/supplier.errors';
import { supplierCalls, supplierDuration } from '../telemetry/metrics';

import type { SearchVertical, SupplierOutcome, SupplierStatus } from './search-store';

function statusOf(error: unknown): SupplierStatus {
  if (error instanceof CircuitOpenError) return 'circuit_open';
  if (error instanceof SupplierTimeoutError) return 'timeout';
  return 'error';
}

/**
 * Calls suppliers behind their circuit breakers with per-supplier timeouts inside the overall
 * search budget. One supplier failing never fails the others: its outcome is reported and the
 * rest are returned (partial results).
 */
@Injectable()
export class SupplierRunner {
  private readonly logger = new Logger(SupplierRunner.name);

  constructor(
    private readonly breakers: CircuitBreakerRegistry,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async searchAll<S extends { name: string }, R>(
    vertical: SearchVertical,
    suppliers: readonly S[],
    call: (supplier: S, signal: AbortSignal) => Promise<R[]>,
  ): Promise<{ results: { supplier: S; items: R[] }[]; outcomes: SupplierOutcome[] }> {
    const budget = AbortSignal.timeout(this.config.SEARCH_TIMEOUT_MS);
    const settled = await Promise.all(
      suppliers.map(async (supplier) => {
        const started = performance.now();
        try {
          const items = await this.guard(vertical, supplier.name, budget, (signal) =>
            call(supplier, signal),
          );
          return {
            supplier,
            items,
            status: 'ok' as SupplierStatus,
            durationMs: performance.now() - started,
          };
        } catch (error) {
          const status = statusOf(error);
          this.logger.warn(
            { supplier: supplier.name, vertical, status, reason: (error as Error).message },
            'supplier search failed',
          );
          return { supplier, items: [] as R[], status, durationMs: performance.now() - started };
        }
      }),
    );
    const outcomes = settled.map(({ supplier, items, status, durationMs }) => {
      supplierDuration.record(durationMs, {
        supplier: supplier.name,
        vertical,
        operation: 'search',
        outcome: status,
      });
      supplierCalls.add(1, {
        supplier: supplier.name,
        vertical,
        operation: 'search',
        outcome: status,
      });
      return {
        supplier: supplier.name,
        status,
        resultCount: items.length,
        durationMs: Math.round(durationMs),
      };
    });
    return {
      results: settled
        .filter((entry) => entry.status === 'ok')
        .map(({ supplier, items }) => ({ supplier, items })),
      outcomes,
    };
  }

  /** One guarded call (re-pricing, booking); errors propagate to the caller. */
  async call<R>(
    vertical: SearchVertical,
    supplier: string,
    operation: string,
    task: (signal: AbortSignal) => Promise<R>,
    timeoutMs = this.config.SUPPLIER_TIMEOUT_MS,
  ): Promise<R> {
    const started = performance.now();
    let status: SupplierStatus = 'ok';
    try {
      return await this.guard(vertical, supplier, undefined, task, timeoutMs);
    } catch (error) {
      status = statusOf(error);
      throw error;
    } finally {
      supplierDuration.record(performance.now() - started, {
        supplier,
        vertical,
        operation,
        outcome: status,
      });
      supplierCalls.add(1, { supplier, vertical, operation, outcome: status });
    }
  }

  private guard<R>(
    vertical: SearchVertical,
    supplier: string,
    parent: AbortSignal | undefined,
    task: (signal: AbortSignal) => Promise<R>,
    timeoutMs = this.config.SUPPLIER_TIMEOUT_MS,
  ): Promise<R> {
    return this.breakers
      .get(`${vertical}:${supplier}`)
      .execute(() => withTimeout(supplier, timeoutMs, parent, task));
  }
}
