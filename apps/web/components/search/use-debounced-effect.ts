'use client';

import { useEffect, useEffectEvent } from 'react';

/** Runs `effect` after `delay` ms without changes; the effect gets an AbortSignal for fetches. */
export function useDebouncedEffect(
  effect: (signal: AbortSignal) => void,
  deps: readonly unknown[],
  delay = 200,
): void {
  const run = useEffectEvent(effect);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => run(controller.signal), delay);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps are passed through by the caller.
  }, [...deps, delay]);
}
