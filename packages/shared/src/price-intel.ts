import { currencyExponent, parseMoney, type Money } from './money';

/**
 * Price intelligence (ADR-102): the names and pure rules the API, the worker and the console
 * share. A price read from a public web page is never a price Suskii sells at: it is an
 * indicative observation, shown as one and confirmed by a person before anything is paid
 * (ADR-104).
 */

/** What a price can be read for. */
export const PRICE_PRODUCTS = ['flight', 'hotel', 'car', 'transfer', 'tour'] as const;
export type PriceProduct = (typeof PRICE_PRODUCTS)[number];

/** Every site starts in `review`; production reads only `approved`; `blocked` is never read. */
export const SOURCE_POLICY_STATUSES = ['review', 'approved', 'blocked'] as const;
export type SourcePolicyStatus = (typeof SOURCE_POLICY_STATUSES)[number];

/** Why reading a site is allowed. Recorded with a reference when a site is approved. */
export const SOURCE_POLICY_BASES = [
  'licence',
  'permission',
  'public_data_assessment',
  'counsel_note',
] as const;
export type SourcePolicyBasis = (typeof SOURCE_POLICY_BASES)[number];

/** What a site's robots file or terms say about automated access. */
export const AUTOMATED_ACCESS_FINDINGS = ['allowed', 'silent', 'disallowed', 'unknown'] as const;
export type AutomatedAccessFinding = (typeof AUTOMATED_ACCESS_FINDINGS)[number];

/**
 * Whether a basis is enough for a site. When its robots file or its terms disallow automated
 * access, only the site's own word (a licence or a written permission) is: an assessment or a
 * note cannot overrule what the site says. An unread robots file or unread terms is not
 * "allowed": the approver must read both first.
 */
export function basisIssue(input: {
  basis: SourcePolicyBasis;
  robots: AutomatedAccessFinding;
  terms: AutomatedAccessFinding;
}): 'findings_unknown' | 'needs_licence_or_permission' | null {
  if (input.robots === 'unknown' || input.terms === 'unknown') return 'findings_unknown';
  const disallowed = input.robots === 'disallowed' || input.terms === 'disallowed';
  if (disallowed && input.basis !== 'licence' && input.basis !== 'permission') {
    return 'needs_licence_or_permission';
  }
  return null;
}

/** The services that fetch a page. `direct` is our own plain request; `mock` is for tests. */
export const SCRAPE_VENDORS = [
  'firecrawl',
  'apify',
  'browse_ai',
  'oxylabs',
  'bright_data',
  'direct',
  'mock',
] as const;
export type ScrapeVendor = (typeof SCRAPE_VENDORS)[number];

/**
 * How a request leaves, cheapest and plainest first. A policy names the highest class its
 * approver allowed; the router never goes above it (the default is the lowest).
 */
export const PROXY_CLASSES = ['none', 'datacenter', 'residential', 'unblocker'] as const;
export type ProxyClass = (typeof PROXY_CLASSES)[number];
export const DEFAULT_MAX_PROXY_CLASS: ProxyClass = 'none';

const proxyRank = (proxy: ProxyClass): number => PROXY_CLASSES.indexOf(proxy);

/** True when `proxy` is within what the policy allows. */
export const proxyAllowed = (proxy: ProxyClass, max: ProxyClass): boolean =>
  proxyRank(proxy) <= proxyRank(max);

/**
 * The next class up that the vendor offers and the policy allows, or null when there is none.
 * Used once after a block; it can never return a class above `max`.
 */
export function nextProxyClass(
  current: ProxyClass,
  max: ProxyClass,
  offered: readonly ProxyClass[],
): ProxyClass | null {
  for (const candidate of PROXY_CLASSES) {
    if (proxyRank(candidate) <= proxyRank(current)) continue;
    if (!proxyAllowed(candidate, max)) return null;
    if (offered.includes(candidate)) return candidate;
  }
  return null;
}

/** The lowest class a vendor offers within the policy, or null when it offers none. */
export function firstProxyClass(
  max: ProxyClass,
  offered: readonly ProxyClass[],
): ProxyClass | null {
  return PROXY_CLASSES.find((proxy) => proxyAllowed(proxy, max) && offered.includes(proxy)) ?? null;
}

/** Why an attempt to read a page failed. Every failure is one of these, and nothing else. */
export const SCRAPE_FAILURE_CLASSES = [
  // The site refused (403, a challenge page, a ban).
  'blocked',
  // The vendor or the site did not answer in time.
  'timeout',
  // The vendor failed (5xx, a broken answer, a network error).
  'provider_error',
  // The vendor says the account is out of credits or over its rate.
  'quota_exhausted',
  // The page came back without the content (an empty shell that needs rendering).
  'empty_or_unrendered',
  // The content came back and no price could be read from it.
  'parse_failed',
  // The policy, a kill switch or a budget says no.
  'policy_denied',
] as const;
export type ScrapeFailureClass = (typeof SCRAPE_FAILURE_CLASSES)[number];

/**
 * What the router does after a failure of each class (ADR-102). One reaction per class, so a
 * read can never loop:
 *
 * - `escalate_proxy`: once more on the same vendor one proxy class higher, then the next vendor.
 * - `retry_once`: one retry on the same vendor after a backoff with jitter, then the next vendor.
 * - `open_breaker`: the vendor's breaker opens until its reset; the next vendor.
 * - `need_rendering`: the next vendor that renders pages; repeated failures flag parser drift.
 * - `stop`: nothing more is tried.
 */
export const FAILURE_REACTIONS = {
  blocked: 'escalate_proxy',
  timeout: 'retry_once',
  provider_error: 'retry_once',
  quota_exhausted: 'open_breaker',
  empty_or_unrendered: 'need_rendering',
  parse_failed: 'need_rendering',
  policy_denied: 'stop',
} as const satisfies Record<ScrapeFailureClass, string>;
export type FailureReaction = (typeof FAILURE_REACTIONS)[ScrapeFailureClass];

/** How a price is read out of what came back, most reliable first. */
export const EXTRACTION_METHODS = [
  'structured_data',
  'selectors',
  'vendor_fields',
  'model',
] as const;
export type ExtractionMethod = (typeof EXTRACTION_METHODS)[number];

/** Whether an observation may be shown. `unverified` is shown as such; `rejected` never. */
export const OBSERVATION_STATUSES = ['verified', 'unverified', 'rejected'] as const;
export type ObservationStatus = (typeof OBSERVATION_STATUSES)[number];

export const OBSERVATION_AVAILABILITY = ['available', 'limited', 'sold_out', 'unknown'] as const;
export type ObservationAvailability = (typeof OBSERVATION_AVAILABILITY)[number];

/** What made an observation weaker; shown to staff, never to a traveller. */
export const OBSERVATION_FLAGS = [
  'currency_mismatch',
  'outlier_low',
  'outlier_high',
  'no_history',
  'sources_disagree',
  'low_confidence_method',
  'taxes_unknown',
] as const;
export type ObservationFlag = (typeof OBSERVATION_FLAGS)[number];

/** Below this an observation is not shown at all. */
export const OBSERVATION_MIN_CONFIDENCE = 40;
/** At or above this, with no flag that forbids it, an observation is `verified`. */
export const OBSERVATION_VERIFIED_CONFIDENCE = 70;
/** How far from the recent median a price may be before it is an outlier. */
export const OUTLIER_LOW_RATIO = 0.4;
export const OUTLIER_HIGH_RATIO = 2.5;
/** Observations of the same thing needed before the median means anything. */
export const OUTLIER_MIN_HISTORY = 5;

/** What a method is worth before anything else is known. */
const METHOD_CONFIDENCE: Record<ExtractionMethod, number> = {
  structured_data: 85,
  vendor_fields: 75,
  selectors: 70,
  model: 50,
};

const median = (values: readonly bigint[]): bigint => {
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0n;
  if (sorted.length % 2 === 1) return upper;
  return ((sorted[middle - 1] ?? 0n) + upper) / 2n;
};

/**
 * Judges one observation (ADR-102): a score from 0 to 100, the flags that lowered it and whether
 * it may be shown. Rules, not a model: the method it was read with, whether the currency is the
 * market's, whether taxes are known to be inside, how it sits against the recent median of the
 * same thing, and whether another source agrees.
 */
export function judgeObservation(input: {
  price: Money;
  method: ExtractionMethod;
  marketCurrency: string;
  taxesIncluded: boolean | null;
  /** Recent prices of the same thing from this source, in the same currency (minor units). */
  history: readonly bigint[];
  /** The price another source gave for the same thing, in the same currency, if any. */
  otherSource?: bigint | null;
}): { confidence: number; flags: ObservationFlag[]; status: ObservationStatus } {
  const flags: ObservationFlag[] = [];
  let confidence = METHOD_CONFIDENCE[input.method];
  if (input.method === 'model') flags.push('low_confidence_method');

  if (input.price.minor <= 0n) return { confidence: 0, flags, status: 'rejected' };

  // A price in another currency than the market's is usually a wrong locale or a wrong field.
  if (input.price.currency !== input.marketCurrency) {
    flags.push('currency_mismatch');
    confidence -= 35;
  }
  if (input.taxesIncluded === null) {
    flags.push('taxes_unknown');
    confidence -= 10;
  }

  if (input.history.length >= OUTLIER_MIN_HISTORY) {
    const typical = median(input.history);
    if (typical > 0n) {
      // Integer arithmetic: price * 100 against median * ratio * 100.
      const scaled = input.price.minor * 100n;
      if (scaled < typical * BigInt(Math.round(OUTLIER_LOW_RATIO * 100))) {
        flags.push('outlier_low');
        confidence -= 40;
      } else if (scaled > typical * BigInt(Math.round(OUTLIER_HIGH_RATIO * 100))) {
        flags.push('outlier_high');
        confidence -= 30;
      } else {
        confidence += 5;
      }
    }
  } else {
    flags.push('no_history');
    confidence -= 5;
  }

  if (input.otherSource !== undefined && input.otherSource !== null && input.otherSource > 0n) {
    const low = input.price.minor < input.otherSource ? input.price.minor : input.otherSource;
    const high = input.price.minor < input.otherSource ? input.otherSource : input.price.minor;
    // Within 15% of each other counts as agreement.
    if (high * 100n <= low * 115n) confidence += 10;
    else {
      flags.push('sources_disagree');
      confidence -= 15;
    }
  }

  confidence = Math.max(0, Math.min(100, confidence));
  const blocking = flags.includes('currency_mismatch') || flags.includes('outlier_low');
  const status: ObservationStatus =
    confidence < OBSERVATION_MIN_CONFIDENCE
      ? 'rejected'
      : confidence >= OBSERVATION_VERIFIED_CONFIDENCE && !blocking
        ? 'verified'
        : 'unverified';
  return { confidence, flags, status };
}

/** Symbols and local codes sites print instead of the ISO code. Unambiguous ones only. */
const CURRENCY_MARKS: readonly (readonly [RegExp, string])[] = [
  [/₦|\bNGN\b|\bN(?=\s?\d)/, 'NGN'],
  [/GH₵|₵|\bGHS\b|\bGH¢/, 'GHS'],
  [/\bKSh\b|\bKES\b/i, 'KES'],
  [/\bZAR\b|\bR(?=\s?\d)/, 'ZAR'],
  [/£|\bGBP\b/, 'GBP'],
  [/€|\bEUR\b/, 'EUR'],
  [/\bAED\b|د\.إ/, 'AED'],
  [/\bUSD\b|US\$/, 'USD'],
  [/\bCAD\b|CA\$|C\$/, 'CAD'],
  [/\bXOF\b|\bCFA\b/, 'XOF'],
  [/\bEGP\b|E£/, 'EGP'],
];

/**
 * The currency a printed price names, or null when it names none or only an ambiguous sign
 * (a bare "$" is a dozen currencies: the caller falls back to the source's market).
 */
export function currencyInText(text: string): string | null {
  for (const [pattern, code] of CURRENCY_MARKS) {
    if (pattern.test(text)) return code;
  }
  const iso = /\b([A-Z]{3})\b/.exec(text);
  return iso?.[1] && isPlausibleCurrency(iso[1]) ? iso[1] : null;
}

const KNOWN_CURRENCIES = new Set([
  'NGN',
  'GHS',
  'KES',
  'ZAR',
  'GBP',
  'EUR',
  'AED',
  'USD',
  'CAD',
  'XOF',
  'XAF',
  'EGP',
  'TZS',
  'UGX',
  'RWF',
  'MAD',
  'SAR',
  'QAR',
  'TRY',
  'INR',
  'CNY',
  'JPY',
  'AUD',
  'CHF',
  'ETB',
  'ZMW',
]);
const isPlausibleCurrency = (code: string): boolean => KNOWN_CURRENCIES.has(code);

/**
 * Reads a printed amount ("₦1,250,000.50", "1.250.000,50 €", "NGN 250 000", "1'250.5") into a
 * plain decimal string, or null when the text holds no single amount. The last separator is the
 * decimal point only when it is followed by one or two digits (or exactly as many as the
 * currency has); three digits after a separator is a thousands group.
 */
export function decimalFromText(text: string, currency: string): string | null {
  const cleaned = text.replace(/[\u00a0\u202f\u2009]/g, ' ');
  // A space or an apostrophe joins digits only as a thousands separator: exactly three digits
  // follow it. "250 000 for 2 nights" is two numbers, never 2500002.
  const candidates = cleaned.match(/\d+(?:[.,]\d+|[ ']\d{3}(?!\d))*/g);
  // More than one number is a range, a "was/now" pair or a price with a count: not one amount.
  if (candidates?.length !== 1) return null;
  const raw = (candidates[0] ?? '').replace(/[' ]/g, '');
  const exponent = currencyExponent(currency);

  const lastDot = raw.lastIndexOf('.');
  const lastComma = raw.lastIndexOf(',');
  const last = Math.max(lastDot, lastComma);
  if (last === -1) return /^\d+$/.test(raw) ? raw : null;

  const separator = raw[last] ?? '.';
  const other = separator === '.' ? ',' : '.';
  const after = raw.slice(last + 1);
  const before = raw.slice(0, last);
  const occurrences = raw.split(separator).length - 1;
  const decimalLength = after.length === exponent || after.length === 1 || after.length === 2;
  // "1.250.000": the same separator twice is always grouping.
  const isDecimal = occurrences === 1 && decimalLength && after.length !== 3 && exponent > 0;

  if (!isDecimal) {
    const digits = raw.replace(/[.,]/g, '');
    // Grouping must be in threes, or the text is not an amount we understand.
    const groups = raw.split(/[.,]/);
    if (groups.slice(1).some((group) => group.length !== 3)) return null;
    return /^\d+$/.test(digits) ? digits : null;
  }
  const whole = before.split(other).join('');
  if (!/^\d+$/.test(whole) || !/^\d+$/.test(after)) return null;
  if (before.includes(separator)) return null;
  const wholeGroups = before.split(other);
  if (wholeGroups.length > 1 && wholeGroups.slice(1).some((group) => group.length !== 3)) {
    return null;
  }
  return `${whole}.${after}`;
}

/**
 * A printed price as `Money`: the currency the text names, or the source's market currency, and
 * the amount in minor units. Null when the text is not one clear, positive amount. Never a
 * float anywhere on the way.
 */
export function priceFromText(text: string, marketCurrency: string): Money | null {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 80) return null;
  const currency = currencyInText(trimmed) ?? marketCurrency;
  let decimal: string | null;
  try {
    decimal = decimalFromText(trimmed.replace(/[A-Za-z]{2,}\$?|\$/g, ' '), currency);
    if (decimal === null) return null;
    const amount = parseMoney(decimal, currency, 'half-even');
    return amount.minor > 0n ? amount : null;
  } catch {
    return null;
  }
}

/** A domain as a policy stores it: lower case, no scheme, port, path, `www.` or trailing dot. */
export function normaliseDomain(input: string): string | null {
  const text = input.trim().toLowerCase();
  if (text.length === 0 || text.length > 253) return null;
  // No `URL` here: this package runs where there is none (no DOM or Node library types).
  let host = text.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  host = host.split(/[/?#]/)[0] ?? '';
  // Credentials in a host are never part of a domain.
  if (host.includes('@')) return null;
  host = host
    .replace(/:\d{1,5}$/, '')
    .replace(/\.$/, '')
    .replace(/^www\./, '');
  // A registrable name: labels of letters, digits and hyphens, at least one dot, no IP address.
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(host)) return null;
  return host;
}

/** True when `host` is the policy's domain or a subdomain of it. */
export function hostInDomain(host: string, domain: string): boolean {
  const name = host.toLowerCase().replace(/\.$/, '');
  return name === domain || name.endsWith(`.${domain}`);
}

/** Budget thresholds that tell staff, once each per period. */
export const BUDGET_ALERT_PERCENTS = [50, 80, 100] as const;

/** The highest alert threshold a spend has reached, or null below the first. */
export function budgetAlertLevel(spent: number, cap: number): 50 | 80 | 100 | null {
  if (cap <= 0) return null;
  const percent = (spent / cap) * 100;
  if (percent >= 100) return 100;
  if (percent >= 80) return 80;
  if (percent >= 50) return 50;
  return null;
}

/**
 * Whether `hour` (0-23, the site's local time) is inside a night window such as 23 to 5, which
 * wraps midnight. Scheduled reads run only inside it; a start equal to the end means any hour.
 */
export function inNightWindow(hour: number, startHour: number, endHour: number): boolean {
  if (startHour === endHour) return true;
  return startHour < endHour
    ? hour >= startHour && hour < endHour
    : hour >= startHour || hour < endHour;
}
