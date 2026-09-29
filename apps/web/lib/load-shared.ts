import type * as SharedModule from '@suskii/shared';

type Shared = typeof SharedModule;

let loading: Promise<Shared> | null = null;

/**
 * The shared schemas, loaded on demand. Zod is only needed once a form is submitted, so it stays
 * out of the homepage's initial JavaScript (`@suskii/shared/lite` covers rendering). Forms call
 * this on first focus or pointer-down as a prefetch, so submitting rarely waits for it.
 */
export function loadShared(): Promise<Shared> {
  loading ??= import('@suskii/shared').catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

/** Starts loading the schemas without waiting; failures surface on submit instead. */
export function prefetchShared(): void {
  loadShared().catch(() => undefined);
}
