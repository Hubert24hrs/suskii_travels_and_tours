import { secureStorage } from './secure-storage';

/**
 * The assistant on this device (ADR-101, ADR-105): which conversation is open and, for a
 * guest, the access token returned when it started. Both live in the secure store, like guest
 * booking and support tokens. Nothing of what was said is kept: the conversation is read from
 * the API each time.
 */
const CURRENT = 'agent.current';
const tokenKey = (conversationId: string): string => `agent.${conversationId}`;
const ID = /^[0-9a-f-]{36}$/i;

export const assistantSession = {
  saveToken: (conversationId: string, token: string): Promise<void> =>
    secureStorage.set(tokenKey(conversationId), token),
  /** Request headers that open a guest's conversation; empty for an account's. */
  headers: async (conversationId: string): Promise<Record<string, string>> => {
    const token = await secureStorage.get(tokenKey(conversationId));
    return token ? { 'X-Agent-Token': token } : {};
  },
  /** The conversation last opened on this device; null when there is none. */
  current: async (): Promise<string | null> => {
    const id = await secureStorage.get(CURRENT);
    return id && ID.test(id) ? id : null;
  },
  remember: (conversationId: string | null): Promise<void> =>
    conversationId ? secureStorage.set(CURRENT, conversationId) : secureStorage.remove(CURRENT),
};

/** How often a conversation is read again while the assistant is answering. */
export const ASSISTANT_POLL_MS = 1_500;

const UUID_PART = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
const SLUG_PART = '([a-z0-9]+(?:-[a-z0-9]+){0,15})';

/** Website paths a card can carry, and the app's own screen for each. */
const CARD_SCREENS: readonly [RegExp, (id: string) => string][] = [
  // A booking the assistant prepared: the app's checkout for that quote (ADR-109).
  [new RegExp(`^/checkout/${UUID_PART}$`, 'i'), (id) => `/checkout/${id.toLowerCase()}`],
  // A combined trip it put together: the app's trip screen, where each part is booked (ADR-117).
  [new RegExp(`^/trips/${UUID_PART}$`, 'i'), (id) => `/trips/built/${id.toLowerCase()}`],
  // A bus trip it found: the seat map, where the traveller chooses the seats (ADR-117).
  [new RegExp(`^/buses/trips/${UUID_PART}$`, 'i'), (id) => `/buses/trips/${id.toLowerCase()}`],
  [new RegExp(`^/packages/${SLUG_PART}$`), (slug) => `/packages/${slug}`],
  [new RegExp(`^/tours/${SLUG_PART}$`), (slug) => `/tours/${slug}`],
];

/**
 * The screen of the app a card of the assistant opens, where the app has one of its own: a
 * booking the assistant prepared opens the app's checkout for that quote, where the traveller
 * enters the details and pays; a combined trip, a bus trip's seat map, a package or a tour opens
 * its screen. Null for every other link, which goes through the allowlist of incoming links or
 * to the website. Only a whole path of these shapes matches, so nothing else reaches the router.
 */
export const assistantCardPath = (href: string): string | null => {
  for (const [pattern, screen] of CARD_SCREENS) {
    const id = pattern.exec(href)?.[1];
    if (id) return screen(id);
  }
  return null;
};
