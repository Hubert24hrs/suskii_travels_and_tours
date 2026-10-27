import { money, type Money } from '@suskii/shared';

import { countryName, type OfferTrip } from './partner-programs';

/** A bookable tour or activity from the partner's search, already tagged with our affiliate id. */
export interface ActivityProduct {
  code: string;
  title: string;
  /** The partner's product page; used verbatim by the redirect. */
  url: string;
  imageUrl: string | null;
  rating: { average: number; count: number } | null;
  durationMinutes: number | null;
  fromPrice: Money | null;
}

/** Tours and activities with prices (ADR-069). Vendor payloads never leave the adapter. */
export abstract class ActivityPartner {
  abstract readonly name: 'mock' | 'viator';
  /** The campaign value the partner's links carry, stored on clicks to match its reports. */
  abstract readonly campaign: string | null;
  /** True for invented sample products (clients show a badge). */
  abstract readonly sample: boolean;
  abstract search(trip: OfferTrip, limit: number, signal: AbortSignal): Promise<ActivityProduct[]>;
}

const SAMPLE_TITLES = [
  'City highlights walking tour',
  'Food and market tasting',
  'Sunset boat cruise',
];

/** Tests and local stacks: three sample products for any place, on Viator's host. */
export class MockActivityPartner extends ActivityPartner {
  readonly name = 'mock' as const;
  readonly campaign = null;
  readonly sample = true;

  search(trip: OfferTrip, limit: number): Promise<ActivityProduct[]> {
    const place = trip.cityName ?? countryName(trip.countryCode) ?? 'your destination';
    const slug = place.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return Promise.resolve(
      SAMPLE_TITLES.slice(0, limit).map((title, index) => ({
        code: `SAMPLE${index + 1}`,
        title: `${title} in ${place}`,
        url: `https://www.viator.com/tours/${slug}/sample-${index + 1}/d0-SAMPLE${index + 1}`,
        imageUrl: null,
        rating: { average: 4.5, count: 120 - index * 30 },
        durationMinutes: 180 + index * 60,
        fromPrice: money(BigInt(2500 + index * 1500), 'USD'),
      })),
    );
  }
}
