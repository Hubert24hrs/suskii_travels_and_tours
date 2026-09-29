/** Base class for failures a supplier adapter reports; messages never contain credentials or PII. */
export class SupplierError extends Error {
  constructor(
    readonly supplier: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** The supplier did not answer within its time budget. */
export class SupplierTimeoutError extends SupplierError {}

/** The supplier failed (5xx, network error, malformed response, rate limited). */
export class SupplierUnavailableError extends SupplierError {}

/** The supplier rejected the request itself (4xx other than availability). */
export class SupplierRequestError extends SupplierError {}

/** The offer has expired or sold out; the customer must search again. */
export class OfferUnavailableError extends SupplierError {}

/** The circuit breaker is open; the supplier was not called. */
export class CircuitOpenError extends SupplierError {}

/**
 * Runs `task` with an abort signal that fires after `ms` (or when `parent` aborts) and rejects
 * with `SupplierTimeoutError` even if the task ignores its signal.
 */
export async function withTimeout<T>(
  supplier: string,
  ms: number,
  parent: AbortSignal | undefined,
  task: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const signals = parent ? [parent, controller.signal] : [controller.signal];
  const signal = AbortSignal.any(signals);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    const fail = () =>
      reject(new SupplierTimeoutError(supplier, `${supplier} timed out after ${ms} ms`));
    timer = setTimeout(() => {
      // Reject first: aborting may settle the task synchronously, and the timeout must win.
      fail();
      controller.abort();
    }, ms);
    parent?.addEventListener('abort', fail, { once: true });
  });
  try {
    return await Promise.race([task(signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
