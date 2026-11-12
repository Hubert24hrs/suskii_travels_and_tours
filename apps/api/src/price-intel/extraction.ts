import { parse, type HTMLElement } from 'node-html-parser';

import {
  currencyInText,
  hostInDomain,
  priceFromText,
  type ExtractionMethod,
  type Money,
  type ObservationAvailability,
  type ScrapeVendor,
} from '@suskii/shared';

import { parseExactJson } from '../pricing/fx-providers';

import { PUBLIC_ITEM_FIELDS, type PublicItemField, type Recipe, type RecipeField } from './recipes';
import { ScrapeError, type ScrapePage } from './scrape-provider';

/** Items read from one page at most: a results page lists tens of offers, never thousands. */
export const MAX_ITEMS = 50;
const MAX_LD_BLOCKS = 30;
const MAX_FIELD_LENGTH = 120;

export type PublicItem = Partial<Record<PublicItemField, string | number>>;

/** One priced thing read from a page, before it is judged. */
export interface ExtractedItem {
  price: Money;
  availability: ObservationAvailability;
  /** Public facts only (`PUBLIC_ITEM_FIELDS`). */
  item: PublicItem;
  method: ExtractionMethod;
}

export interface Extraction {
  items: ExtractedItem[];
  method: ExtractionMethod;
  parserVersion: string;
}

type Raw = Partial<Record<RecipeField, unknown>>;

const NUMERIC_FIELDS: ReadonlySet<PublicItemField> = new Set(['stars', 'stops', 'seats']);
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
/** Nine or more digits in a row of digits, spaces and dashes, optionally after a plus. */
const PHONE = /(?:\+|\b00)?\d(?:[\s().-]?\d){8,}/;

/** Text that holds a contact detail is never a public fact about a product. */
export const looksPersonal = (text: string): boolean => EMAIL.test(text) || PHONE.test(text);

const clean = (value: unknown): string | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length === 0 ? null : text;
};

/**
 * Keeps only the public facts, bounded and typed. A fact that holds an email address or a phone
 * number is dropped; an item whose title does is not an item.
 */
export function publicItem(raw: Raw, domain: string): PublicItem | null {
  const item: PublicItem = {};
  for (const field of PUBLIC_ITEM_FIELDS) {
    const text = clean(raw[field]);
    if (text === null) continue;
    if (field === 'link') {
      const link = sameSiteLink(text, domain);
      if (link) item.link = link;
      continue;
    }
    // Flight times are digits by nature; everything else is checked for contact details.
    const timeLike = field === 'departure' || field === 'arrival' || field === 'duration';
    if (!timeLike && looksPersonal(text)) {
      if (field === 'title') return null;
      continue;
    }
    if (NUMERIC_FIELDS.has(field)) {
      const number = Number(/-?\d+(?:\.\d+)?/.exec(text)?.[0]);
      if (Number.isFinite(number) && number >= 0 && number <= 99) item[field] = number;
      continue;
    }
    item[field] = text.slice(0, MAX_FIELD_LENGTH);
  }
  return typeof item.title === 'string' && item.title.length >= 2 ? item : null;
}

/** An https address on the same site, without credentials; anything else is not kept. */
function sameSiteLink(text: string, domain: string): string | null {
  try {
    const url = new URL(text, `https://${domain}/`);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    if (!hostInDomain(url.hostname, domain)) return null;
    url.hash = '';
    const link = url.toString();
    return link.length <= 500 ? link : null;
  } catch {
    return null;
  }
}

const AVAILABILITY: readonly (readonly [RegExp, ObservationAvailability])[] = [
  [
    /sold\s?out|out\s?of\s?stock|soldout|unavailable|no (?:rooms|seats|cars) (?:left|available)/i,
    'sold_out',
  ],
  [/limited|only \d+ left|few left|last (?:room|seat|car)/i, 'limited'],
  [/in\s?stock|instock|available|book now|select/i, 'available'],
];

export function availabilityOf(value: unknown): ObservationAvailability {
  const text = clean(value);
  if (text === null) return 'unknown';
  return AVAILABILITY.find(([pattern]) => pattern.test(text))?.[1] ?? 'unknown';
}

/** A price from whatever a source gave: a number kept as its exact text, or printed text. */
function priceOf(raw: Raw, marketCurrency: string): Money | null {
  const value = clean(raw.price);
  if (value === null) return null;
  const named = clean(raw.currency);
  const currency =
    (named && /^[A-Z]{3}$/.test(named.toUpperCase()) ? named.toUpperCase() : null) ??
    (named ? currencyInText(named) : null);
  // A bare number with a currency beside it reads in that currency; printed text names its own.
  return priceFromText(
    /^[\d.,' ]+$/.test(value) && currency ? `${currency} ${value}` : value,
    currency ?? marketCurrency,
  );
}

function toItems(
  raws: readonly Raw[],
  method: ExtractionMethod,
  context: { domain: string; currency: string },
): ExtractedItem[] {
  const items: ExtractedItem[] = [];
  for (const raw of raws.slice(0, MAX_ITEMS)) {
    const price = priceOf(raw, context.currency);
    const item = publicItem(raw, context.domain);
    if (!price || !item) continue;
    items.push({ price, item, availability: availabilityOf(raw.availability), method });
  }
  return items;
}

// --- structured data (JSON-LD) ----------------------------------------------------------------

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const list = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
const typesOf = (node: Json): string[] =>
  list(node['@type']).filter((type): type is string => typeof type === 'string');
const nameOf = (value: unknown): unknown => (isObject(value) ? value.name : value);

/** Every object in a JSON-LD block, following `@graph` and item lists; depth and count bounded. */
function ldNodes(root: unknown): Json[] {
  const nodes: Json[] = [];
  const visit = (value: unknown, depth: number): void => {
    if (depth > 6 || nodes.length > 500) return;
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, depth + 1);
      return;
    }
    if (!isObject(value)) return;
    nodes.push(value);
    visit(value['@graph'], depth + 1);
    visit(value.itemListElement, depth + 1);
    visit(value.item, depth + 1);
    visit(value.mainEntity, depth + 1);
  };
  visit(root, 0);
  return nodes;
}

/** The fields of a schema.org thing and one of its offers. Reviews and authors are never read. */
function ldRaw(node: Json, offer: Json): Raw {
  const spec = isObject(offer.priceSpecification) ? offer.priceSpecification : {};
  const rating = isObject(node.starRating) ? node.starRating.ratingValue : undefined;
  const flight = isObject(node.departureAirport) || isObject(node.arrivalAirport);
  return {
    title: node.name ?? offer.name,
    brand: nameOf(node.brand) ?? nameOf(node.provider) ?? nameOf(offer.seller),
    stars: rating,
    roomType: offer.name !== node.name ? offer.name : undefined,
    carrier: flight ? (nameOf(node.provider) ?? nameOf(node.airline)) : undefined,
    flightNumber: node.flightNumber,
    departure: node.departureTime,
    arrival: node.arrivalTime,
    vehicleClass: node.bodyType ?? node.vehicleConfiguration,
    transmission: node.vehicleTransmission,
    seats: node.vehicleSeatingCapacity ?? node.seatingCapacity,
    link: offer.url ?? node.url,
    price: offer.price ?? offer.lowPrice ?? spec.price,
    currency: offer.priceCurrency ?? spec.priceCurrency,
    availability: offer.availability,
  };
}

function fromStructuredData(root: HTMLElement, types: readonly string[]): Raw[] {
  const wanted = new Set(types.map((type) => type.toLowerCase()));
  const raws: Raw[] = [];
  for (const script of root
    .querySelectorAll('script[type="application/ld+json"]')
    .slice(0, MAX_LD_BLOCKS)) {
    let data: unknown;
    try {
      // Numbers stay as their exact source text: a price is never a float on the way.
      data = parseExactJson(script.rawText);
    } catch {
      continue;
    }
    for (const node of ldNodes(data)) {
      if (!typesOf(node).some((type) => wanted.has(type.toLowerCase()))) continue;
      const offers = [...list(node.offers), ...list(node.makesOffer)].flatMap((offer) =>
        isObject(offer) ? [offer, ...list(offer.offers).filter(isObject)] : [],
      );
      // A thing that is itself an offer (`Offer`, `AggregateOffer`) prices itself.
      const priced = offers.length > 0 ? offers : node.price !== undefined ? [node] : [];
      for (const offer of priced) raws.push(ldRaw(node, offer));
      if (raws.length >= MAX_ITEMS) return raws;
    }
  }
  return raws;
}

/**
 * How many priced items each schema.org type yields from a page's structured data, for the
 * types that yield any. It reads as `extract` does, so what is counted is what would be
 * stored. Used to propose a recipe for a page the current one cannot read (ADR-102).
 */
export function pricedByType<T extends string>(
  html: string,
  types: readonly T[],
  context: { domain: string; currency: string },
): Map<T, number> {
  const root = parse(html, { comment: false });
  const counts = new Map<T, number>();
  for (const type of types) {
    const items = toItems(fromStructuredData(root, [type]), 'structured_data', context);
    if (items.length > 0) counts.set(type, items.length);
  }
  return counts;
}

// --- selectors --------------------------------------------------------------------------------

type FieldSelector = string | { selector: string; attribute: string };

function fromSelectors(
  root: HTMLElement,
  itemSelector: string,
  fields: Partial<Record<RecipeField, FieldSelector>>,
): Raw[] {
  let elements: HTMLElement[];
  try {
    elements = root.querySelectorAll(itemSelector).slice(0, MAX_ITEMS);
  } catch {
    // A selector the parser cannot read is a recipe fault, reported as a parse failure.
    return [];
  }
  return elements.map((element) => {
    const raw: Raw = {};
    for (const [field, where] of Object.entries(fields) as [RecipeField, FieldSelector][]) {
      try {
        const target = element.querySelector(typeof where === 'string' ? where : where.selector);
        if (!target) continue;
        raw[field] = typeof where === 'string' ? target.text : target.getAttribute(where.attribute);
      } catch {
        continue;
      }
    }
    return raw;
  });
}

// --- fields a vendor extracted ----------------------------------------------------------------

function fromVendorFields(
  items: readonly Record<string, unknown>[],
  fields: Partial<Record<RecipeField, string>>,
): Raw[] {
  return items.slice(0, MAX_ITEMS).map((entry) => {
    const raw: Raw = {};
    for (const [field, path] of Object.entries(fields) as [RecipeField, string][]) {
      let value: unknown = entry;
      for (const key of path.split('.')) value = isObject(value) ? value[key] : undefined;
      if (typeof value === 'string' || typeof value === 'number') raw[field] = value;
    }
    return raw;
  });
}

/**
 * Reads priced items out of a page with a site's recipe (ADR-102): each method in order, from
 * `fromMethod` on (parser drift moves a site to its next method), and the first that finds a
 * price wins. Throws `ScrapeError('parse_failed')` when none does, so the router can try a
 * vendor that renders. The page is data: nothing in it is run, followed or obeyed.
 */
export function extract(
  page: ScrapePage,
  recipe: Recipe,
  context: { domain: string; currency: string; vendor: ScrapeVendor; fromMethod?: number },
): Extraction {
  let root: HTMLElement | null = null;
  const html = (): HTMLElement | null => {
    if (page.html === null) return null;
    root ??= parse(page.html, { comment: false });
    return root;
  };
  for (const method of recipe.methods.slice(context.fromMethod ?? 0)) {
    let raws: Raw[] = [];
    if (method.method === 'structured_data') {
      const document = html();
      if (document) raws = fromStructuredData(document, method.types);
    } else if (method.method === 'selectors') {
      const document = html();
      if (document) raws = fromSelectors(document, method.item, method.fields);
    } else if (page.items !== null) {
      raws = fromVendorFields(page.items, method.fields);
    }
    const items = toItems(raws, method.method, context);
    if (items.length > 0) return { items, method: method.method, parserVersion: recipe.version };
  }
  throw new ScrapeError(context.vendor, 'parse_failed', { reason: 'no price read' });
}
