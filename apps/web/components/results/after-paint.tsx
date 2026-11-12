'use client';

import { useDeferredValue, type ReactNode } from 'react';

/**
 * Renders its children in a second pass, right after the first paint (ADR-075). Results show
 * their first cards at once on a slow phone; filters and the remaining cards follow in a
 * background render that a tap can interrupt.
 */
export function AfterPaint({ children }: { children: ReactNode }) {
  const painted = useDeferredValue(true, false);
  return painted ? children : null;
}
