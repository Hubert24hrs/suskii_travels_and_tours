import { useSyncExternalStore } from 'react';

/**
 * Whether the traveller put the "Ask Suskii" button away (ADR-109). It lasts until the app
 * starts again and is kept nowhere: the next start shows the button as before. While it is
 * away, Account offers the assistant instead, so there is always one way in and never two.
 */
let away = false;
const listeners = new Set<() => void>();

const set = (value: boolean): void => {
  away = value;
  for (const listener of listeners) listener();
};

export const askSuskii = {
  putAway: (): void => set(true),
  /** For a new start of the app (and between tests). */
  reset: (): void => set(false),
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  isAway: (): boolean => away,
};

export const useAskSuskiiAway = (): boolean =>
  useSyncExternalStore(askSuskii.subscribe, askSuskii.isAway);
