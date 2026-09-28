'use client';

import { breakpoint } from '@suskii/design-tokens';
import { useCallback, useSyncExternalStore } from 'react';

/** Subscribes to a CSS media query. Returns `false` during server rendering. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** True at the `md` breakpoint and up (tablet/desktop layouts). */
export function useIsDesktop(): boolean {
  return useMediaQuery(`(min-width: ${breakpoint.md}px)`);
}
