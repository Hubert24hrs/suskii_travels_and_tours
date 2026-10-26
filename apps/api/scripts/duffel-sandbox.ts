/**
 * Duffel Stays sandbox check (ADR-062): asks Duffel's test mode the questions the fixtures could
 * not answer and prints what came back. It refuses anything but a test token (`duffel_test_`),
 * prints no token and sends only made-up guest details. CI never runs it; the manual
 * `duffel-sandbox.yml` workflow does, with the DUFFEL_API_TOKEN repository secret.
 *
 *   DUFFEL_API_TOKEN=duffel_test_... pnpm --filter @suskii/api sandbox:duffel
 *   pnpm --filter @suskii/api sandbox:duffel --book   # also books, repeats a booking, cancels
 */
import { appendFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { add, addDays, compare, formatMoney, localDate } from '@suskii/shared';

import { DuffelHotelSupplier } from '../src/suppliers/duffel/duffel-hotel-supplier';
import { DuffelClient } from '../src/suppliers/duffel/duffel.client';
import type {
  HotelSearchQuery,
  SupplierHotel,
  SupplierHotelRate,
} from '../src/suppliers/supplier.types';

const BASE_URL = process.env.DUFFEL_API_URL ?? 'https://api.duffel.com';
const TIMEOUT_MS = 30_000;
/** Marks the bookings this check makes, so it can find and cancel them. */
const TAG = 'sandbox-check';
/** Made-up guest details: test mode only, never a real person. */
const GUEST = { given_name: 'Sandbox', family_name: 'Tester' };
const CONTACT = { email: 'sandbox@example.com', phone_number: '+442080160509' };

const CITIES: HotelSearchQuery['city'][] = [
  {
    id: 'sandbox-lagos',
    name: 'Lagos',
    countryCode: 'NG',
    latitude: 6.5244,
    longitude: 3.3792,
    timeZone: 'Africa/Lagos',
  },
  {
    id: 'sandbox-london',
    name: 'London',
    countryCode: 'GB',
    latitude: 51.5072,
    longitude: -0.1276,
    timeZone: 'Europe/London',
  },
];

type Json = Record<string, unknown>;

interface Probe {
  status: number;
  code: string | null;
  data: unknown;
}

const lines: string[] = [];
function say(line = ''): void {
  lines.push(line);
  process.stdout.write(`${line}\n`);
}

const record = (value: unknown): Json =>
  value !== null && typeof value === 'object' ? (value as Json) : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const shown = (answer: Probe): string =>
  `HTTP ${answer.status.toString()}${answer.code ? ` ${answer.code}` : ''}`;

/** One raw call, for the status and error code our client folds into its errors. */
async function probe(
  token: string,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<Probe> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${token}`,
      'Duffel-Version': 'v2',
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  const first = record(list(record(payload).errors)[0]);
  return {
    status: response.status,
    code: typeof first.code === 'string' ? first.code : null,
    data: record(payload).data ?? null,
  };
}

/** Runs one adapter or client call; the outcome names the error class the pipeline would see. */
async function attempt<T>(call: () => Promise<T>): Promise<{ value: T | null; outcome: string }> {
  try {
    return { value: await call(), outcome: 'ok' };
  } catch (error) {
    const failure = error as Error;
    return { value: null, outcome: `${failure.constructor.name}: ${failure.message}` };
  }
}

function distanceKm(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): number {
  const rad = (degrees: number): number => (degrees * Math.PI) / 180;
  const a =
    Math.sin(rad(to.latitude - from.latitude) / 2) ** 2 +
    Math.cos(rad(from.latitude)) *
      Math.cos(rad(to.latitude)) *
      Math.sin(rad(to.longitude - from.longitude) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

function searchBody(query: HotelSearchQuery, radius: number): Json {
  return {
    data: {
      rooms: 1,
      guests: [{ type: 'adult' }, { type: 'adult' }],
      check_in_date: query.checkIn,
      check_out_date: query.checkOut,
      location: {
        radius,
        geographic_coordinates: {
          latitude: query.city.latitude,
          longitude: query.city.longitude,
        },
      },
    },
  };
}

const totalOf = (rate: SupplierHotelRate) => add(rate.price.base, rate.price.taxes);
const money = (rate: SupplierHotelRate): string => formatMoney(totalOf(rate), 'en-GB');

function cheapest(rates: SupplierHotelRate[]): SupplierHotelRate | undefined {
  return rates.reduce<SupplierHotelRate | undefined>(
    (best, rate) => (best && compare(totalOf(best), totalOf(rate)) <= 0 ? best : rate),
    undefined,
  );
}

/** Counts the values of one rate field ("pay_now 3, guarantee 1"). */
function tally(rates: Json[], key: string): string {
  const counts = new Map<string, number>();
  for (const rate of rates) {
    const field = rate[key];
    const value = Array.isArray(field) ? field.map(String).join('+') : String(field);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts].map(([value, count]) => `${value} ${count.toString()}`).join(', ') || 'none';
}

async function main(): Promise<number> {
  const { values } = parseArgs({ options: { book: { type: 'boolean', default: false } } });
  const token = process.env.DUFFEL_API_TOKEN ?? '';
  if (!token.startsWith('duffel_test_')) {
    process.stderr.write(
      'DUFFEL_API_TOKEN must be a Duffel test token (duffel_test_...); this check never runs in live mode.\n',
    );
    return 1;
  }

  const client = new DuffelClient({ baseUrl: BASE_URL, token });
  const supplier = new DuffelHotelSupplier(client);
  const signal = (): AbortSignal => AbortSignal.timeout(TIMEOUT_MS);
  const checkIn = addDays(localDate(new Date(), 'UTC'), 30);
  const queryFor = (city: HotelSearchQuery['city']): HotelSearchQuery => ({
    city,
    checkIn,
    checkOut: addDays(checkIn, 2),
    rooms: [{ adults: 2, childAges: [] }],
    freeCancellationOnly: false,
  });
  const failures: string[] = [];

  say('## Duffel Stays sandbox check (ADR-062)');
  say();
  say(`Stay: ${checkIn}, 2 nights, 1 room, 2 adults. Test mode only.`);

  // 1. Search: the raw answer (do results carry rooms?) and what the adapter makes of it.
  say();
  say('### 1. Search (10 km)');
  let chosen: { query: HotelSearchQuery; hotel: SupplierHotel } | null = null;
  for (const city of CITIES) {
    const query = queryFor(city);
    const raw = await probe(token, 'POST', '/stays/search', searchBody(query, 10));
    const results = list(record(raw.data).results);
    const withRooms = results.filter(
      (result) => list(record(record(result).accommodation).rooms).length > 0,
    ).length;
    const mapped = await attempt(() => supplier.search(query, signal()));
    const hotels = mapped.value ?? [];
    say(
      `- ${city.name}: ${shown(raw)}, ${results.length.toString()} results, ` +
        `${withRooms.toString()} with rooms and rates; adapter: ` +
        (mapped.value ? `${hotels.length.toString()} hotels mapped` : mapped.outcome),
    );
    if (raw.status === 200 && results.length > 0 && hotels.length === 0) {
      failures.push(`${city.name}: Duffel returned results but the adapter mapped none`);
    }
    const first = hotels[0];
    if (!chosen && first) chosen = { query, hotel: first };
  }
  if (!chosen) {
    failures.push('No city returned a hotel; the remaining checks need one');
    return finish(failures);
  }
  const { query, hotel } = chosen;

  // 2. Radius unit: the farthest result for each radius, in kilometres.
  say();
  say(`### 2. Radius unit (${query.city.name})`);
  const centre = { latitude: query.city.latitude ?? 0, longitude: query.city.longitude ?? 0 };
  const verdicts: string[] = [];
  for (const radius of [1, 5, 25]) {
    const raw = await probe(token, 'POST', '/stays/search', searchBody(query, radius));
    const distances: number[] = [];
    for (const result of list(record(raw.data).results)) {
      const location = record(record(record(result).accommodation).location);
      const point = record(location.geographic_coordinates);
      if (typeof point.latitude === 'number' && typeof point.longitude === 'number') {
        distances.push(
          distanceKm(centre, { latitude: point.latitude, longitude: point.longitude }),
        );
      }
    }
    const farthest = distances.length > 0 ? Math.max(...distances) : null;
    say(
      `- radius ${radius.toString()}: ${shown(raw)}, ${distances.length.toString()} results, ` +
        `farthest ${farthest === null ? 'n/a' : `${farthest.toFixed(2)} km`}`,
    );
    if (farthest !== null) {
      verdicts.push(
        farthest <= radius * 1.05 ? 'km' : farthest <= radius * 1.7 ? 'miles' : 'unclear',
      );
    }
  }
  let unit = 'inconclusive';
  if (verdicts.length === 0) unit = 'inconclusive (no results with coordinates)';
  else if (verdicts.every((verdict) => verdict === 'km')) unit = 'consistent with kilometres';
  else if (verdicts.includes('miles') && !verdicts.includes('unclear'))
    unit = 'consistent with miles: SEARCH_RADIUS_KM needs converting';
  say(`- Verdict: ${unit}`);

  // 3. Every rate of the first hotel: what Duffel offers and what we can sell.
  say();
  say('### 3. Rates (fetch_all_rates)');
  const allRaw = await probe(
    token,
    'POST',
    `/stays/search_results/${encodeURIComponent(hotel.supplierResultId ?? '')}/actions/fetch_all_rates`,
  );
  const rawRates = list(record(record(allRaw.data).accommodation).rooms).flatMap((room) =>
    list(record(room).rates).map(record),
  );
  const rates = await attempt(() => supplier.rates(hotel, query, signal()));
  const sellable = rates.value ?? [];
  say(`- ${hotel.name}: ${shown(allRaw)}, ${rawRates.length.toString()} rates`);
  say(`- payment_type: ${tally(rawRates, 'payment_type')}`);
  say(`- available_payment_methods: ${tally(rawRates, 'available_payment_methods')}`);
  say(`- board_type: ${tally(rawRates, 'board_type')}`);
  say(
    `- adapter: ` +
      (rates.value
        ? `${sellable.length.toString()} sellable, ` +
          `${sellable.filter((rate) => rate.refundable).length.toString()} with free cancellation`
        : rates.outcome),
  );
  const target = cheapest(sellable);
  if (!target) {
    failures.push('The first hotel has no rate we can sell; quotes and bookings were skipped');
    return finish(failures);
  }

  // 4. Quote: through the adapter, then raw for the fields a quote carries.
  say();
  say('### 4. Quote');
  const repriced = await attempt(() => supplier.reprice(hotel, target, query, signal()));
  if (repriced.value) {
    say(`- adapter: ${money(target)} listed, ${money(repriced.value)} quoted`);
  } else {
    say(`- adapter: ${repriced.outcome}`);
    failures.push(`Quote failed: ${repriced.outcome}`);
  }
  const rawQuote = await probe(token, 'POST', '/stays/quotes', {
    data: { rate_id: target.supplierRateId },
  });
  const quote = record(rawQuote.data);
  say(`- raw: ${shown(rawQuote)}, fields: ${Object.keys(quote).sort().join(', ') || 'none'}`);
  const expiresAt = typeof quote.expires_at === 'string' ? Date.parse(quote.expires_at) : NaN;
  say(
    `- quote lifetime: ` +
      (Number.isNaN(expiresAt)
        ? 'no expires_at field'
        : `${Math.round((expiresAt - Date.now()) / 60_000).toString()} minutes`),
  );

  // 5. Error codes for unknown ids, and how our client classifies them.
  say();
  say('### 5. Error codes');
  const unknownIds: { label: string; path: string; body?: Json }[] = [
    {
      label: 'rate',
      path: '/stays/quotes',
      body: { data: { rate_id: 'rat_0000AAAAAAAAAAAAAAAAAAAA' } },
    },
    {
      label: 'search result',
      path: '/stays/search_results/srr_0000AAAAAAAAAAAAAAAAAAAA/actions/fetch_all_rates',
    },
    {
      label: 'quote',
      path: '/stays/bookings',
      body: { data: { quote_id: 'quo_0000AAAAAAAAAAAAAAAAAAAA', guests: [GUEST], ...CONTACT } },
    },
  ];
  for (const { label, path, body } of unknownIds) {
    const raw = await probe(token, 'POST', path, body);
    const ours = await attempt(() => client.request('POST', path, signal(), body));
    say(`- unknown ${label}: ${shown(raw)} -> ${ours.outcome.split(':')[0] ?? ours.outcome}`);
  }

  // 6. Booking (opt-in): through the adapter, a repeat on one quote, then cancellations.
  say();
  say('### 6. Booking');
  if (!values.book) {
    say('- skipped (run with --book)');
    return finish(failures);
  }
  if (repriced.value) {
    const fresh = repriced.value;
    const booked = await attempt(() =>
      supplier.book(
        {
          hotel,
          rate: fresh,
          query,
          guests: [{ givenNames: GUEST.given_name, surname: GUEST.family_name }],
          contact: { email: CONTACT.email, phone: CONTACT.phone_number },
          idempotencyKey: TAG,
        },
        signal(),
      ),
    );
    say(`- adapter booking: ${booked.value ? 'confirmed, reference received' : booked.outcome}`);
    if (!booked.value) failures.push(`Adapter booking failed: ${booked.outcome}`);
  }
  const bookQuote = await probe(token, 'POST', '/stays/quotes', {
    data: { rate_id: target.supplierRateId },
  });
  const quoteId = record(bookQuote.data).id;
  if (typeof quoteId === 'string') {
    const body = {
      data: {
        quote_id: quoteId,
        guests: [GUEST],
        ...CONTACT,
        metadata: { suskii_booking_item: TAG },
      },
    };
    const first = await probe(token, 'POST', '/stays/bookings', body);
    const second = await probe(token, 'POST', '/stays/bookings', body);
    say(`- raw booking: ${shown(first)}, status ${String(record(first.data).status)}`);
    say(
      `- same quote again: ${shown(second)}` +
        (second.status < 300 ? ' (accepted: a retry can book twice)' : ' (refused)'),
    );
  } else {
    say(`- raw quote for the booking: ${shown(bookQuote)}`);
  }
  // Cancels every live booking this check made (the adapter does not expose its booking id).
  const listed = await probe(token, 'GET', '/stays/bookings?limit=50');
  for (const booking of list(listed.data).map(record)) {
    const ours = record(booking.metadata).suskii_booking_item === TAG;
    if (!ours || booking.status === 'cancelled' || typeof booking.id !== 'string') continue;
    const cancelled = await probe(
      token,
      'POST',
      `/stays/bookings/${encodeURIComponent(booking.id)}/actions/cancel`,
    );
    say(`- cancel: ${shown(cancelled)}, status ${String(record(cancelled.data).status)}`);
  }
  return finish(failures);
}

function finish(failures: string[]): number {
  say();
  say('### Result');
  if (failures.length === 0) say('- Every check ran; read the answers above against ADR-062.');
  for (const failure of failures) say(`- FAILED: ${failure}`);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `${lines.join('\n')}\n`);
  return failures.length === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`sandbox check failed: ${(error as Error).message}\n`);
    process.exit(1);
  },
);
