import { resolveIncomingUrl } from './deep-links';
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

/** Pages of the website the app has a screen for, by their whole path. */
const PAGE_SCREENS: Readonly<Record<string, string>> = {
  '/': '/',
  // Home is where the app searches flights and hotels: its forms are its first tabs.
  '/flights': '/',
  '/hotels': '/',
  '/deals': '/deals',
  '/prime': '/prime',
  '/account': '/account',
  '/account/company': '/account/company',
  // The app keeps no saved travellers of its own: Account is the nearest place.
  '/account/travellers': '/account',
  '/assistant': '/assistant',
  '/assistant/preferences': '/assistant/preferences',
  '/sign-in': '/sign-in',
  '/register': '/register',
  '/status': '/status',
  '/support': '/support',
  // The website's `/trips` plans a combined trip (ADR-099); the app's `/trips` lists bookings.
  '/trips': '/trips/plan',
  '/manage-booking': '/trips',
  '/quotes': '/account/quotes',
  '/flights/groups': '/search/groups',
  '/buses': '/buses',
  '/rides': '/rides',
  '/rentals': '/rentals',
  '/cars': '/cars',
  '/packages': '/packages',
  '/tours': '/tours',
};

/** Pages of one thing (by id or slug) and the app's screen for it. */
const ITEM_SCREENS: readonly [RegExp, (key: string) => string][] = [
  // A booking the assistant prepared: the app's checkout for that quote (ADR-109).
  [new RegExp(`^/checkout/${UUID_PART}$`, 'i'), (id) => `/checkout/${id.toLowerCase()}`],
  // A combined trip it put together: the app's trip screen, where each part is booked (ADR-117).
  [new RegExp(`^/trips/${UUID_PART}$`, 'i'), (id) => `/trips/built/${id.toLowerCase()}`],
  // A booking of the account: the app's screen for it is under its Trips.
  [new RegExp(`^/bookings/${UUID_PART}$`, 'i'), (id) => `/trips/${id.toLowerCase()}`],
  // A bus trip it found: the seat map, where the traveller chooses the seats (ADR-117).
  [new RegExp(`^/buses/trips/${UUID_PART}$`, 'i'), (id) => `/buses/trips/${id.toLowerCase()}`],
  [new RegExp(`^/support/${UUID_PART}$`, 'i'), (id) => `/support/${id.toLowerCase()}`],
  [new RegExp(`^/quotes/${UUID_PART}$`, 'i'), (id) => `/account/quotes/${id.toLowerCase()}`],
  [new RegExp(`^/packages/${SLUG_PART}$`), (slug) => `/packages/${slug}`],
  [new RegExp(`^/tours/${SLUG_PART}$`), (slug) => `/tours/${slug}`],
  [new RegExp(`^/rentals/${SLUG_PART}$`), (slug) => `/rentals/${slug}`],
];

/** What an app screen reads from a card's query; everything else is dropped. */
const KEPT_QUERY: readonly [RegExp, readonly string[]][] = [
  [/^\/rentals\/[^/]+$/, ['pickupAt', 'returnAt', 'chauffeur']],
];

const SITE_PATH = /^(\/(?!\/)[^?#\s]*)(?:\?([^#\s]*))?$/;

/** The query `screen` reads, taken from a card's own query and encoded again. */
function keptQuery(screen: string, query: string): string {
  const keys = KEPT_QUERY.find(([pattern]) => pattern.test(screen))?.[1] ?? [];
  const parts: string[] = [];
  for (const pair of query.split('&')) {
    const [key = '', value = ''] = pair.split('=');
    if (!keys.includes(key) || value === '') continue;
    try {
      parts.push(`${key}=${encodeURIComponent(decodeURIComponent(value))}`);
    } catch {
      // A value that is not valid percent-encoding is left out.
    }
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

/** Where a card of the assistant leads: a screen of the app, or a page of the website. */
export type AssistantCardTarget = { screen: string } | { web: string };

/**
 * Where a card of the assistant leads (ADR-109, ADR-117). Its link is a path of the website.
 * Every page the app has a screen for opens that screen: a booking the assistant prepared opens
 * the app's checkout, a combined trip its trip screen, a search its results, Home and the other
 * sections their tabs. A page the app has nothing for opens on the website. Null for anything
 * that is not a path of the site, which is then not a link at all: nothing else reaches the
 * router or the browser.
 */
export function assistantCardTarget(href: string, webBaseUrl: string): AssistantCardTarget | null {
  const match = SITE_PATH.exec(href.trim());
  if (!match) return null;
  const path = match[1] === '/' ? '/' : (match[1] ?? '/').replace(/\/+$/, '');
  const query = match[2] ?? '';
  const page = PAGE_SCREENS[path];
  if (page) return { screen: page };
  for (const [pattern, screen] of ITEM_SCREENS) {
    const key = pattern.exec(path)?.[1];
    if (key) {
      const target = screen(key);
      return { screen: `${target}${keptQuery(target, query)}` };
    }
  }
  // A search the app runs itself: the same parameters, checked by its own search forms.
  if (path === '/flights/search' || path === '/hotels/search') {
    const resolved = resolveIncomingUrl(`${path}${query ? `?${query}` : ''}`, null);
    return { screen: resolved.path || '/' };
  }
  return { web: new URL(`${path}${query ? `?${query}` : ''}`, webBaseUrl).toString() };
}
