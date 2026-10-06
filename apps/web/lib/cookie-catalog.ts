import type { Messages } from '@suskii/i18n';
import type { OptionalCookieCategory } from '@suskii/shared/lite';

export type CookieCategory = 'necessary' | OptionalCookieCategory;
type CookieMessages = Messages['cookies'];

export interface CookieEntry {
  /** As the browser shows it in production; a trailing `*` matches a prefix. */
  name: string;
  kind: 'cookie' | 'localStorage' | 'sessionStorage' | 'third-party';
  category: CookieCategory;
  provider: keyof CookieMessages['providers'];
  purpose: keyof CookieMessages['items'];
  duration: keyof CookieMessages['durations'];
}

/**
 * Every cookie and storage key the website sets (ADR-042). The cookie settings dialog renders
 * this list and `e2e/cookies.spec.ts` fails when the site stores something missing from it.
 * Adding an optional entry also needs a new COOKIE_POLICY_VERSION and the first-visit prompt.
 */
export const COOKIE_CATALOG: readonly CookieEntry[] = [
  {
    name: '__Secure-suskii_at',
    kind: 'cookie',
    category: 'necessary',
    provider: 'suskii',
    purpose: 'access',
    duration: 'accessToken',
  },
  {
    name: '__Secure-suskii_rt',
    kind: 'cookie',
    category: 'necessary',
    provider: 'suskii',
    purpose: 'refresh',
    duration: 'refreshToken',
  },
  {
    name: '__Secure-suskii_csrf',
    kind: 'cookie',
    category: 'necessary',
    provider: 'suskii',
    purpose: 'csrf',
    duration: 'refreshToken',
  },
  {
    name: 'suskii_currency',
    kind: 'cookie',
    category: 'necessary',
    provider: 'suskii',
    purpose: 'currency',
    duration: 'oneYear',
  },
  {
    name: 'suskii_locale',
    kind: 'cookie',
    category: 'necessary',
    provider: 'suskii',
    purpose: 'locale',
    duration: 'oneYear',
  },
  {
    name: 'suskii_consent',
    kind: 'cookie',
    category: 'necessary',
    provider: 'suskii',
    purpose: 'consent',
    duration: 'oneYear',
  },
  {
    name: 'suskii.session.accessExpiresAt',
    kind: 'localStorage',
    category: 'necessary',
    provider: 'suskii',
    purpose: 'sessionExpiry',
    duration: 'untilSignOut',
  },
  {
    name: 'suskii.booking.*',
    kind: 'sessionStorage',
    category: 'necessary',
    provider: 'suskii',
    purpose: 'bookingAccess',
    duration: 'tab',
  },
  {
    name: 'suskii:search:*',
    kind: 'localStorage',
    category: 'necessary',
    provider: 'suskii',
    purpose: 'search',
    duration: 'untilCleared',
  },
  {
    name: 'suskii:addons:last-name',
    kind: 'sessionStorage',
    category: 'necessary',
    provider: 'suskii',
    purpose: 'addonsName',
    duration: 'tab',
  },
  {
    name: 'Turnstile',
    kind: 'third-party',
    category: 'necessary',
    provider: 'cloudflare',
    purpose: 'turnstile',
    duration: 'challenge',
  },
];

/** Development serves plain HTTP, where the API drops the `__Secure-` prefix. */
const bare = (name: string): string => name.replace(/^__Secure-/, '');

/** The catalog entry that covers a stored name, if any. */
export function catalogEntryFor(
  name: string,
  kind: Exclude<CookieEntry['kind'], 'third-party'>,
): CookieEntry | undefined {
  return COOKIE_CATALOG.find((entry) => {
    if (entry.kind !== kind) return false;
    if (entry.name.endsWith('*')) return name.startsWith(entry.name.slice(0, -1));
    return kind === 'cookie' ? bare(entry.name) === bare(name) : entry.name === name;
  });
}
