import {
  flightFormToParams,
  hotelFormToParams,
  parseFlightSearchParams,
  parseHotelSearchParams,
} from '@suskii/shared';

/**
 * Incoming links (ADR-021). Every URL the system hands the app is rewritten to an allowlisted
 * in-app path before the router sees it; anything else opens Home. React Native only partly
 * implements `URL` and `URLSearchParams`, so parsing is done here with plain string handling.
 */

export interface IncomingLink {
  /** In-app route, e.g. `/trips/{id}` or `/search/flights?...`. */
  path: string;
  /** Guest access token from an emailed booking link (`#access=`), never passed to the router. */
  access?: { bookingId: string; token: string };
}

const HOME: IncomingLink = { path: '/' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ABSOLUTE = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/i;
const RELATIVE = /^(\/[^?#]*)?(\?[^#]*)?(#.*)?$/;
const ACCESS = /^#access=([A-Za-z0-9_-]{16,256})$/;
const APP_SCHEME = 'suskii';

interface Parts {
  path: string;
  query: string;
  fragment: string;
}

const decode = (value: string): string => {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return '';
  }
};

/** A `getAll`-capable view of a query string (`?a=1&a=2`), for the shared search parsers. */
export function queryInput(query: string): { getAll(name: string): string[] } {
  const pairs = query
    .replace(/^\?/, '')
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const index = pair.indexOf('=');
      return index === -1
        ? ([decode(pair), ''] as const)
        : ([decode(pair.slice(0, index)), decode(pair.slice(index + 1))] as const);
    });
  return { getAll: (name) => pairs.filter(([key]) => key === name).map(([, value]) => value) };
}

function tripLink(id: string, fragment: string, acceptToken: boolean): IncomingLink {
  const bookingId = id.toLowerCase();
  const token = acceptToken ? ACCESS.exec(fragment)?.[1] : undefined;
  return token
    ? { path: `/trips/${bookingId}`, access: { bookingId, token } }
    : { path: `/trips/${bookingId}` };
}

function searchLink(vertical: 'flights' | 'hotels', query: string): IncomingLink {
  if (vertical === 'flights') {
    const { form } = parseFlightSearchParams(queryInput(query));
    return form ? { path: `/search/flights?${flightFormToParams(form).toString()}` } : HOME;
  }
  const { form } = parseHotelSearchParams(queryInput(query));
  return form ? { path: `/search/hotels?${hotelFormToParams(form).toString()}` } : HOME;
}

/** Paths of the public website that the app handles (the app-link paths). */
function webPath({ path, query, fragment }: Parts): IncomingLink {
  const segments = path.split('/').filter(Boolean);
  const [first, second] = segments;
  if (first === 'bookings' && second && UUID.test(second) && segments.length === 2)
    return tripLink(second, fragment, true);
  if (first === 'flights' && second === 'search' && segments.length === 2)
    return searchLink('flights', query);
  if (first === 'hotels' && second === 'search' && segments.length === 2)
    return searchLink('hotels', query);
  if (first === 'deals' && segments.length === 1) return { path: '/deals' };
  return HOME;
}

/** Paths of the app itself (`suskii://trips/{id}`, notification paths). */
function appPath({ path, query }: Parts): IncomingLink {
  const segments = path.split('/').filter(Boolean);
  const [first, second, third] = segments;
  if (segments.length === 0) return HOME;
  if (first === 'trips' && segments.length === 1) return { path: '/trips' };
  if (first === 'trips' && second && UUID.test(second) && segments.length === 2)
    return tripLink(second, '', false);
  if ((first === 'deals' || first === 'account' || first === 'prime') && !second)
    return { path: `/${first}` };
  if (first === 'search' && (second === 'flights' || second === 'hotels') && !third)
    return searchLink(second, query);
  return HOME;
}

/**
 * Rewrites a link the system delivered. `webHost` is the public website's host when it serves
 * https (app links); other hosts and schemes open Home.
 */
export function resolveIncomingUrl(raw: string, webHost: string | null): IncomingLink {
  const value = raw.trim();
  const absolute = ABSOLUTE.exec(value);
  if (absolute) {
    const [, scheme = '', host = '', path = '', query = '', fragment = ''] = absolute;
    if (scheme.toLowerCase() === APP_SCHEME)
      return appPath({ path: `/${host}${path}`, query, fragment: '' });
    if (scheme.toLowerCase() === 'https' && host.toLowerCase() === webHost?.toLowerCase())
      return webPath({ path, query, fragment });
    return HOME;
  }
  const relative = RELATIVE.exec(value);
  if (!relative) return HOME;
  const [, path = '/', query = '', fragment = ''] = relative;
  // App links can arrive as a bare path; only the website's booking and search paths map.
  const parts = { path, query, fragment };
  const web = webPath(parts);
  return web === HOME ? appPath(parts) : web;
}

/** Notification data carries only an in-app trip path (ADR-022). */
export function resolveNotificationPath(path: unknown): string | null {
  if (typeof path !== 'string') return null;
  const match = /^\/trips\/([0-9a-f-]{36})$/i.exec(path);
  return match?.[1] && UUID.test(match[1]) ? `/trips/${match[1].toLowerCase()}` : null;
}
