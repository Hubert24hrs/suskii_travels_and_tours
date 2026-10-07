// API load test (phase 11, ADR-045). Two open-model scenarios run side by side:
//
// - browse: catalog and content reads (autocomplete, home content, deals, destinations, packages);
// - book: a guest's flight journey: search, quote, checkout, booking and the start of payment.
//
// Thresholds follow PROJECT_SPEC.json#/performance/api_targets: p95 under 300 ms for every
// non-search call, searches inside the 12 s supplier timeout, and fewer than 1% failed requests.
// Run against a stack with mock suppliers and rate limiting off (a load test measures capacity,
// not the per-IP limits):
//
//   k6 run load/k6/api.js                         (API_URL defaults to http://localhost:4000)
//   LOAD_SCALE=0.5 LOAD_DURATION=30s k6 run load/k6/api.js
//
// Never point it at production: every journey creates a real guest booking.
import { check, fail } from 'k6';
import http from 'k6/http';

const API = (__ENV.API_URL || 'http://localhost:4000').replace(/\/$/, '');
const SCALE = Number(__ENV.LOAD_SCALE || 1);
const DURATION = __ENV.LOAD_DURATION || '1m';

const HEADERS = { 'Content-Type': 'application/json', 'X-Suskii-Client': 'web/0.1' };

export const options = {
  scenarios: {
    browse: {
      executor: 'constant-arrival-rate',
      exec: 'browse',
      rate: Math.max(1, Math.round(20 * SCALE)),
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 20,
      maxVUs: 100,
    },
    book: {
      executor: 'constant-arrival-rate',
      exec: 'book',
      rate: Math.max(1, Math.round(2 * SCALE)),
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 10,
      maxVUs: 100,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
    'http_req_duration{kind:read}': ['p(95)<300'],
    'http_req_duration{kind:write}': ['p(95)<300'],
    'http_req_duration{kind:search}': ['p(95)<12000'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const READS = [
  '/v1/catalog/places?q=lag',
  '/v1/catalog/places?q=lon',
  '/v1/catalog/places/popular',
  '/v1/content/home?locale=en-NG',
  '/v1/content/site?locale=en-NG',
  '/v1/deals/flights?origin=LOS&currency=NGN',
  '/v1/destinations/hotels?currency=NGN',
  '/v1/packages?currency=NGN&adults=2',
];

// Domestic routes (no passport) on many dates, so most searches miss the result cache.
const ROUTES = [
  ['LOS', 'ABV'],
  ['ABV', 'LOS'],
  ['LOS', 'PHC'],
  ['LOS', 'KAN'],
];

const pick = (items) => items[Math.floor(Math.random() * items.length)];

function inDays(days) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

function post(path, body, name, kind, extraHeaders = {}) {
  return http.post(`${API}${path}`, JSON.stringify(body), {
    headers: { ...HEADERS, ...extraHeaders },
    tags: { name, kind },
  });
}

export function browse() {
  const path = pick(READS);
  const response = http.get(`${API}${path}`, {
    headers: HEADERS,
    tags: { name: `GET ${path.split('?')[0]}`, kind: 'read' },
  });
  check(response, { 'read 200': (r) => r.status === 200 });
}

export function book() {
  const [origin, destination] = pick(ROUTES);
  const search = post(
    '/v1/flights/searches',
    {
      slices: [{ origin, destination, departureDate: inDays(20 + Math.floor(Math.random() * 60)) }],
      passengers: { adults: 1, children: 0, infants: 0 },
      cabinClass: 'economy',
    },
    'POST /v1/flights/searches',
    'search',
  );
  const offers = search.status === 200 ? search.json('offers') : [];
  if (!check(search, { 'search found offers': () => offers.length > 0 })) return;

  const quote = post(
    `/v1/flights/offers/${offers[0].id}/quote`,
    {},
    'POST /v1/flights/offers/{id}/quote',
    'write',
  );
  if (!check(quote, { 'quote 201': (r) => r.status === 201 })) return;

  // The checkout page loads the quote, with the terms version the booking must accept.
  const checkout = http.get(`${API}/v1/quotes/${quote.json('quoteId')}`, {
    headers: HEADERS,
    tags: { name: 'GET /v1/quotes/{id}', kind: 'read' },
  });
  if (!check(checkout, { 'checkout 200': (r) => r.status === 200 })) return;

  const booking = post(
    '/v1/bookings',
    {
      quoteId: checkout.json('quoteId'),
      termsVersion: checkout.json('termsVersion'),
      acceptTerms: true,
      // The stack's bot-protection mock accepts any token but "fail".
      turnstileToken: 'load-test',
      contact: { email: `load-${__VU}-${__ITER}@example.com`, phone: '+2348012345678' },
      passengers: [
        {
          type: 'adult',
          title: 'ms',
          gender: 'f',
          givenNames: 'Load',
          surname: 'Test',
          dateOfBirth: '1990-04-01',
          nationality: 'NG',
        },
      ],
    },
    'POST /v1/bookings',
    'write',
    { 'Idempotency-Key': crypto.randomUUID() },
  );
  if (!check(booking, { 'booking 201': (r) => r.status === 201 })) return;

  const payment = post(
    `/v1/bookings/${booking.json('booking.id')}/payments`,
    {},
    'POST /v1/bookings/{id}/payments',
    'write',
    { 'Idempotency-Key': crypto.randomUUID(), 'X-Booking-Token': booking.json('accessToken') },
  );
  check(payment, { 'payment started': (r) => r.status === 201 && Boolean(r.json('checkoutUrl')) });
}

export function setup() {
  const ready = http.get(`${API}/ready`);
  if (ready.status !== 200) fail(`API not ready at ${API} (status ${ready.status})`);
}
