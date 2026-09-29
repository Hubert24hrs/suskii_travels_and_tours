import { CircuitOpenError } from './supplier.errors';

export type BreakerState = 'closed' | 'open' | 'half_open';

export interface BreakerOptions {
  /** Rolling window over which outcomes are counted. */
  windowMs: number;
  /** Minimum calls in the window before the breaker may open. */
  minimumCalls: number;
  /** Failure ratio (0-1) in the window that opens the breaker. */
  failureRate: number;
  /** How long the breaker stays open before letting one probe through. */
  openMs: number;
  now?: () => number;
}

export const DEFAULT_BREAKER_OPTIONS: BreakerOptions = {
  windowMs: 60_000,
  minimumCalls: 5,
  failureRate: 0.5,
  openMs: 30_000,
};

/**
 * Per-supplier circuit breaker: after enough failures in the rolling window the supplier is
 * skipped (fail fast, no timeout wasted) until a cool-down passes; then a single probe decides
 * whether to close again. State is per process: each instance learns independently.
 */
export class CircuitBreaker {
  private outcomes: { at: number; ok: boolean }[] = [];
  private openedAt = 0;
  private probing = false;
  private current: BreakerState = 'closed';
  private readonly now: () => number;

  constructor(
    readonly name: string,
    private readonly options: BreakerOptions = DEFAULT_BREAKER_OPTIONS,
  ) {
    this.now = options.now ?? Date.now;
  }

  get state(): BreakerState {
    if (this.current === 'open' && this.now() - this.openedAt >= this.options.openMs) {
      this.current = 'half_open';
    }
    return this.current;
  }

  async execute<T>(task: () => Promise<T>): Promise<T> {
    const state = this.state;
    if (state === 'open' || (state === 'half_open' && this.probing)) {
      throw new CircuitOpenError(this.name, `${this.name} circuit is open`);
    }
    if (state === 'half_open') this.probing = true;
    try {
      const result = await task();
      this.record(true);
      return result;
    } catch (error) {
      this.record(false);
      throw error;
    } finally {
      if (state === 'half_open') this.probing = false;
    }
  }

  private record(ok: boolean): void {
    const now = this.now();
    if (this.current === 'half_open') {
      if (ok) {
        this.current = 'closed';
        this.outcomes = [];
      } else {
        this.open(now);
      }
      return;
    }
    this.outcomes.push({ at: now, ok });
    this.outcomes = this.outcomes.filter((outcome) => now - outcome.at <= this.options.windowMs);
    const failures = this.outcomes.filter((outcome) => !outcome.ok).length;
    if (
      this.outcomes.length >= this.options.minimumCalls &&
      failures / this.outcomes.length >= this.options.failureRate
    ) {
      this.open(now);
    }
  }

  private open(now: number): void {
    this.current = 'open';
    this.openedAt = now;
    this.outcomes = [];
  }
}

/** One breaker per supplier name, shared across requests in this process. */
export class CircuitBreakerRegistry {
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(private readonly options: BreakerOptions = DEFAULT_BREAKER_OPTIONS) {}

  get(name: string): CircuitBreaker {
    let breaker = this.breakers.get(name);
    if (!breaker) {
      breaker = new CircuitBreaker(name, this.options);
      this.breakers.set(name, breaker);
    }
    return breaker;
  }
}
