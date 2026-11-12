import type { AffiliateNetwork, PartnerCategory } from '../generated/prisma/client';

/** Where and when an offer is for: a trip's destination and dates, never a person. */
export interface OfferTrip {
  countryCode: string;
  cityName: string | null;
  /** ISO dates (YYYY-MM-DD), when known. */
  startDate: string | null;
  endDate: string | null;
}

export interface PartnerProgram {
  id: string;
  category: PartnerCategory;
  network: Exclude<AffiliateNetwork, 'mock'>;
  /** The partner's brand, shown beside the offer: the traveller books with them. */
  name: string;
  /** Destination hosts the redirect may send a traveller to (no open redirect, ADR-070). */
  hosts: readonly string[];
  /** The partner page for a trip. Activities link to products from search instead. */
  landing: (trip: OfferTrip) => string;
}

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

/** "Nigeria" for NG; null for a code Intl does not know. */
export function countryName(countryCode: string): string | null {
  let name: string | undefined;
  try {
    name = regionNames.of(countryCode.toUpperCase());
  } catch {
    return null;
  }
  // Unknown codes come back as themselves; ZZ is CLDR's "Unknown Region".
  return name &&
    name.toUpperCase() !== countryCode.toUpperCase() &&
    countryCode.toUpperCase() !== 'ZZ'
    ? name
    : null;
}

/** "nigeria", "united-arab-emirates": the slug partner pages use for a country. */
export function countrySlug(countryCode: string): string | null {
  const name = countryName(countryCode);
  if (!name) return null;
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || null;
}

/**
 * Affiliate programmes (ADR-069). Adding a partner is one entry; its network account must have the
 * brand connected. Landing pages are the brands' own sites: the network turns them into tracked
 * links at redirect time.
 */
export const PARTNER_PROGRAMS = [
  {
    id: 'discovercars',
    category: 'car_rental',
    network: 'travelpayouts',
    name: 'DiscoverCars',
    hosts: ['www.discovercars.com', 'discovercars.com'],
    landing: () => 'https://www.discovercars.com/',
  },
  {
    id: 'localrent',
    category: 'car_rental',
    network: 'travelpayouts',
    name: 'Localrent',
    hosts: ['localrent.com', 'www.localrent.com'],
    landing: () => 'https://localrent.com/en/',
  },
  {
    id: 'economybookings',
    category: 'car_rental',
    network: 'travelpayouts',
    name: 'Economybookings',
    hosts: ['www.economybookings.com', 'economybookings.com'],
    landing: () => 'https://www.economybookings.com/',
  },
  {
    id: 'gettransfer',
    category: 'transfer',
    network: 'travelpayouts',
    name: 'GetTransfer',
    hosts: ['gettransfer.com', 'www.gettransfer.com'],
    landing: () => 'https://gettransfer.com/en',
  },
  {
    id: 'kiwitaxi',
    category: 'transfer',
    network: 'travelpayouts',
    name: 'Kiwitaxi',
    hosts: ['kiwitaxi.com', 'www.kiwitaxi.com'],
    landing: () => 'https://kiwitaxi.com/en',
  },
  {
    id: 'airalo',
    category: 'esim',
    network: 'travelpayouts',
    name: 'Airalo',
    hosts: ['www.airalo.com', 'airalo.com'],
    landing: (trip) => {
      const slug = countrySlug(trip.countryCode);
      return slug ? `https://www.airalo.com/${slug}-esim` : 'https://www.airalo.com/';
    },
  },
  {
    id: 'ekta',
    category: 'insurance',
    network: 'travelpayouts',
    name: 'EKTA',
    hosts: ['ektatraveling.com', 'www.ektatraveling.com'],
    landing: () => 'https://ektatraveling.com/',
  },
  {
    id: 'viator',
    category: 'activity',
    network: 'viator',
    name: 'Viator',
    hosts: ['www.viator.com', 'viator.com'],
    landing: () => 'https://www.viator.com/',
  },
] as const satisfies readonly PartnerProgram[];

export type PartnerProgramId = (typeof PARTNER_PROGRAMS)[number]['id'];

const BY_ID = new Map<string, PartnerProgram>(
  PARTNER_PROGRAMS.map((program) => [program.id, program]),
);

export function partnerProgram(id: string): PartnerProgram | undefined {
  return BY_ID.get(id);
}

/** True when `url` is https on one of the programme's hosts. */
export function allowedDestination(program: PartnerProgram, url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === 'https:' &&
    parsed.username === '' &&
    parsed.password === '' &&
    parsed.port === '' &&
    program.hosts.includes(parsed.hostname.toLowerCase())
  );
}
