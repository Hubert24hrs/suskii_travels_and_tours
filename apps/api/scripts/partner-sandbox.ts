/**
 * Partner sandbox check (ADR-069 to ADR-071, ADR-086): calls Hotelbeds' evaluation host, Expedia
 * Rapid's test host, Viator's Partner API and the Travelpayouts Partner Links API through our own
 * adapters, and prints what came back: hotels and their cheapest stays with a rate or price
 * check, tours with their prices, and whether each
 * affiliate programme gets a tracked link. Read-only: it books nothing, prints no key and sends
 * no personal data. CI never runs it; the manual `partner-sandbox.yml` workflow does, with the
 * owner's secrets. A partner whose keys are not set is skipped and named.
 *
 *   pnpm --filter @suskii/api sandbox:partners                   # every partner with keys
 *   pnpm --filter @suskii/api sandbox:partners --only hotelbeds  # or expedia, viator, travelpayouts
 */
import { appendFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { add, addDays, formatMoney, localDate } from '@suskii/shared';

import type { LinkStore } from '../src/partners/travelpayouts/travelpayouts-linker';
import { TravelpayoutsLinker } from '../src/partners/travelpayouts/travelpayouts-linker';
import { ViatorActivityPartner } from '../src/partners/viator/viator-activity-partner';
import { PARTNER_PROGRAMS, type OfferTrip } from '../src/partners/partner-programs';
import { ExpediaHotelSupplier } from '../src/suppliers/expedia/expedia-hotel-supplier';
import { ExpediaClient } from '../src/suppliers/expedia/expedia.client';
import { HotelbedsHotelSupplier } from '../src/suppliers/hotelbeds/hotelbeds-hotel-supplier';
import { HotelbedsClient } from '../src/suppliers/hotelbeds/hotelbeds.client';
import type {
  HotelSearchQuery,
  HotelSupplier,
  SupplierHotelRate,
} from '../src/suppliers/supplier.types';

const PARTNERS = ['hotelbeds', 'expedia', 'viator', 'travelpayouts'] as const;
type Partner = (typeof PARTNERS)[number];

/** The only Hotelbeds host this check calls: the evaluation environment books nothing. */
const HOTELBEDS_TEST_URL = 'https://api.test.hotelbeds.com';
/** The only Rapid host this check calls: the test environment books nothing. */
const EXPEDIA_TEST_URL = 'https://test.ean.com';
const TIMEOUT_MS = 30_000;
const CLICK_ID = 'sandbox-check';

const PLACES: (HotelSearchQuery['city'] & { tours: boolean })[] = [
  {
    id: 'sandbox-lagos',
    name: 'Lagos',
    countryCode: 'NG',
    latitude: 6.5244,
    longitude: 3.3792,
    timeZone: 'Africa/Lagos',
    tours: true,
  },
  {
    id: 'sandbox-abuja',
    name: 'Abuja',
    countryCode: 'NG',
    latitude: 9.0765,
    longitude: 7.3986,
    timeZone: 'Africa/Lagos',
    tours: true,
  },
  {
    id: 'sandbox-dubai',
    name: 'Dubai',
    countryCode: 'AE',
    latitude: 25.2048,
    longitude: 55.2708,
    timeZone: 'Asia/Dubai',
    tours: true,
  },
  {
    id: 'sandbox-london',
    name: 'London',
    countryCode: 'GB',
    latitude: 51.5072,
    longitude: -0.1276,
    timeZone: 'Europe/London',
    tours: false,
  },
];

const lines: string[] = [];
function say(line = ''): void {
  lines.push(line);
  process.stdout.write(`${line}\n`);
}

/** A setting, with an empty value read as unset (an unset Actions secret arrives empty). */
function env(name: string): string | undefined {
  const value = process.env[name]?.trim() ?? '';
  return value.length > 0 ? value : undefined;
}
const total = (rate: SupplierHotelRate): string =>
  formatMoney(add(rate.price.base, rate.price.taxes), 'en-GB');
/** An error's class and message; adapters keep keys and tokens out of both. */
const reason = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error';

const checkIn = addDays(localDate(new Date(), 'UTC'), 30);
const checkOut = addDays(checkIn, 2);

/** The settings each partner needs, so a missing one is named rather than guessed at. */
const REQUIRED: Record<Partner, string[]> = {
  hotelbeds: ['HOTELBEDS_API_KEY', 'HOTELBEDS_API_SECRET'],
  expedia: ['EXPEDIA_RAPID_API_KEY', 'EXPEDIA_RAPID_SHARED_SECRET'],
  viator: ['VIATOR_API_KEY'],
  travelpayouts: ['TRAVELPAYOUTS_TOKEN', 'TRAVELPAYOUTS_MARKER'],
};

/** Searches each place, then checks the price of the cheapest rate found once. */
async function hotelChecks(supplier: HotelSupplier, checkName: string): Promise<boolean> {
  let ok = true;
  let checked = false;
  for (const city of PLACES) {
    const query: HotelSearchQuery = {
      city,
      checkIn,
      checkOut,
      rooms: [{ adults: 2, childAges: [] }],
      freeCancellationOnly: false,
    };
    try {
      const hotels = await supplier.search(query, AbortSignal.timeout(TIMEOUT_MS));
      const rates = hotels.flatMap((hotel) => hotel.rates.map((rate) => ({ hotel, rate })));
      const cheapest = [...rates].sort((a, b) =>
        Number(
          add(a.rate.price.base, a.rate.price.taxes).minor -
            add(b.rate.price.base, b.rate.price.taxes).minor,
        ),
      )[0];
      say(
        `- ${city.name}, ${checkIn} to ${checkOut}, 2 adults: ${hotels.length} hotels, ` +
          `${rates.length} rates` +
          (cheapest ? `; cheapest ${total(cheapest.rate)} at ${cheapest.hotel.name}` : ''),
      );
      if (cheapest && !checked) {
        checked = true;
        try {
          const fresh = await supplier.reprice(
            cheapest.hotel,
            cheapest.rate,
            query,
            AbortSignal.timeout(TIMEOUT_MS),
          );
          say(`  - ${checkName}: ${total(fresh)} (search said ${total(cheapest.rate)})`);
        } catch (error) {
          ok = false;
          say(`  - ${checkName} failed: ${reason(error)}`);
        }
      }
    } catch (error) {
      ok = false;
      say(`- ${city.name}: search failed: ${reason(error)}`);
    }
  }
  return ok;
}

async function hotelbeds(): Promise<boolean> {
  say('## Hotelbeds (evaluation host)');
  const baseUrl = env('HOTELBEDS_API_URL') ?? HOTELBEDS_TEST_URL;
  if (new URL(baseUrl).origin !== HOTELBEDS_TEST_URL) {
    say(`- Refused: this check only calls ${HOTELBEDS_TEST_URL}.`);
    return false;
  }
  const supplier = new HotelbedsHotelSupplier(
    new HotelbedsClient({
      baseUrl,
      apiKey: env('HOTELBEDS_API_KEY') ?? '',
      secret: env('HOTELBEDS_API_SECRET') ?? '',
    }),
    Number(env('HOTELBEDS_SEARCH_RADIUS_KM') ?? 20),
  );
  return hotelChecks(supplier, 'Rate check');
}

async function expedia(): Promise<boolean> {
  say('## Expedia Rapid (test host)');
  const baseUrl = env('EXPEDIA_RAPID_API_URL') ?? EXPEDIA_TEST_URL;
  if (new URL(baseUrl).origin !== EXPEDIA_TEST_URL) {
    say(`- Refused: this check only calls ${EXPEDIA_TEST_URL}.`);
    return false;
  }
  const supplier = new ExpediaHotelSupplier(
    new ExpediaClient({
      baseUrl,
      apiKey: env('EXPEDIA_RAPID_API_KEY') ?? '',
      sharedSecret: env('EXPEDIA_RAPID_SHARED_SECRET') ?? '',
    }),
    {
      pointOfSale: env('EXPEDIA_POINT_OF_SALE') ?? 'NG',
      requestCurrency: env('EXPEDIA_REQUEST_CURRENCY') ?? 'USD',
      radiusKm: Number(env('EXPEDIA_SEARCH_RADIUS_KM') ?? 20),
      maxProperties: Number(env('EXPEDIA_MAX_PROPERTIES') ?? 250),
      ratesPerProperty: Number(env('EXPEDIA_RATES_PER_PROPERTY') ?? 4),
    },
  );
  return hotelChecks(supplier, 'Price check');
}

async function viator(): Promise<boolean> {
  say('## Viator (Partner API, tours with prices)');
  const partner = new ViatorActivityPartner({
    baseUrl: env('VIATOR_API_URL') ?? 'https://api.viator.com/partner',
    apiKey: env('VIATOR_API_KEY') ?? '',
    campaign: env('VIATOR_CAMPAIGN') ?? 'suskii',
  });
  let ok = true;
  for (const place of PLACES.filter((candidate) => candidate.tours)) {
    const trip: OfferTrip = {
      countryCode: place.countryCode,
      cityName: place.name,
      startDate: checkIn,
      endDate: checkOut,
    };
    try {
      const products = await partner.search(trip, 5, AbortSignal.timeout(TIMEOUT_MS));
      say(`- ${place.name}: ${products.length} tours`);
      for (const product of products.slice(0, 3)) {
        const price = product.fromPrice ? formatMoney(product.fromPrice, 'en-GB') : 'no price';
        say(`  - ${product.title}: from ${price}`);
      }
    } catch (error) {
      ok = false;
      say(`- ${place.name}: search failed: ${reason(error)}`);
    }
  }
  return ok;
}

/** In memory: the check runs once, so nothing needs to outlive it. */
function memoryStore(): LinkStore {
  const values = new Map<string, string>();
  const counts = new Map<string, number>();
  return {
    get: (key) => Promise.resolve(values.get(key) ?? null),
    set: (key, value) => {
      values.set(key, value);
      return Promise.resolve();
    },
    take: (key, limit) => {
      const used = counts.get(key) ?? 0;
      counts.set(key, used + 1);
      return Promise.resolve(used < limit);
    },
  };
}

async function travelpayouts(): Promise<boolean> {
  say('## Travelpayouts (Partner Links API)');
  const linker = new TravelpayoutsLinker({
    baseUrl: env('TRAVELPAYOUTS_API_URL') ?? 'https://api.travelpayouts.com',
    token: env('TRAVELPAYOUTS_TOKEN') ?? '',
    marker: env('TRAVELPAYOUTS_MARKER') ?? '',
    trs: env('TRAVELPAYOUTS_TRS'),
    timeoutMs: TIMEOUT_MS,
    store: memoryStore(),
  });
  const trip: OfferTrip = {
    countryCode: 'NG',
    cityName: 'Lagos',
    startDate: checkIn,
    endDate: checkOut,
  };
  let tracked = 0;
  const programs = PARTNER_PROGRAMS.filter((program) => program.network === 'travelpayouts');
  for (const program of programs) {
    const link = await linker.link(program, program.landing(trip), CLICK_ID);
    const host = new URL(link.url).hostname;
    if (link.tracked) tracked++;
    say(
      `- ${program.name}: ${link.tracked ? `tracked link on ${host}` : `untracked (falls back to ${host})`}`,
    );
  }
  say(`- ${tracked} of ${programs.length} programmes got a tracked link`);
  return tracked > 0;
}

const CHECKS: Record<Partner, () => Promise<boolean>> = {
  hotelbeds,
  expedia,
  viator,
  travelpayouts,
};

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { only: { type: 'string', default: 'all' } } });
  const only = values.only;
  if (only !== 'all' && !PARTNERS.includes(only as Partner)) {
    throw new Error(`--only must be all, ${PARTNERS.join(', ')}`);
  }
  const selected = only === 'all' ? [...PARTNERS] : [only as Partner];
  say('# Partner sandbox check');
  say();
  let failed = 0;
  let ran = 0;
  for (const partner of selected) {
    const missing = REQUIRED[partner].filter((name) => !env(name));
    if (missing.length > 0) {
      say(`## ${partner}`);
      say(`- Skipped: set ${missing.join(' and ')} to check it.`);
      say();
      continue;
    }
    ran++;
    if (!(await CHECKS[partner]())) failed++;
    say();
  }
  if (ran === 0) say('No partner had its keys set, so nothing was called.');
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `${lines.join('\n')}\n`);
  if (ran === 0 || failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`${reason(error)}\n`);
  process.exitCode = 1;
});
