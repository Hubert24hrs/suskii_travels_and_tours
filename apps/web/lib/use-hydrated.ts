import { useSyncExternalStore } from 'react';

const subscribe = () => () => undefined;

/**
 * `false` on the server and during hydration, `true` afterwards. A client component can render
 * what the server also knows (a UTC date) first and switch to browser-only values (the visitor's
 * time zone) once hydrated, without a hydration mismatch.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
