// API load test (phase 11, ADR-045). Three open-model scenarios run side by side:
//
// - browse: catalog and content reads (autocomplete, home content, deals, destinations, packages);
// - book: a guest's flight journey: search, quote, checkout, booking and the start of payment;
// - chat: a guest's conversation with the assistant (ADR-101): a message, then its run read
//   until it has ended. The stack answers from the mock inside the API, so this measures what
//   the platform adds around a model (storing and sealing the message, the run, its event log
//   and the reads of it), never a model.
//
// Thresholds follow PROJECT_SPEC.json#/performance/api_targets: p95 under 300 ms for every
// non-search call, searches inside the 12 s supplier timeout, and fewer than 1% failed requests;
// a chat answer is read within 3 s of its message. Run against a stack with mock suppliers, rate
// limiting off and the per-address spend cap of the assistant lifted
// (E2E_AGENT_GUEST_DAILY_MICROUSD): a load test measures capacity, not the per-IP limits. On a
// stack without the assistant (E2E_AGENT=off), set LOAD_CHAT=off.
//
//   k6 run load/k6/api.js                         (API_URL defaults to http://localhost:4000)
//   LOAD_SCALE=0.5 LOAD_DURATION=30s k6 run load/k6/api.js
//
// Never point it at production: every journey creates a real guest booking.
import { check, fail, sleep } from 'k6';
import http from 'k6/http';
import { Trend } from 'k6/metrics';

const API = (__ENV.API_URL || 'http://localhost:4000').replace(/\/$/, '');
const SCALE = Number(__ENV.LOAD_SCALE || 1);
const DURATION = __ENV.LOAD_DURATION || '1m';
const CHAT = __ENV.LOAD_CHAT !== 'off';

/** From sending a message to reading that its run has ended, in milliseconds. */
const chatAnswer = new Trend('chat_answer', true);

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
    ...(CHAT
      ? {
          chat: {
            executor: 'constant-arrival-rate',
            exec: 'chat',
            rate: Math.max(1, Math.round(1 * SCALE)),
            timeUnit: '1s',
            duration: DURATION,
            preAllocatedVUs: 5,
            maxVUs: 50,
          },
        }
      : {}),
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
    'http_req_duration{kind:read}': ['p(95)<300'],
    'http_req_duration{kind:write}': ['p(95)<300'],
    'http_req_duration{kind:search}': ['p(95)<12000'],
    ...(CHAT ? { 'http_req_duration{kind:chat}': ['p(95)<300'], chat_answer: ['p(95)<3000'] } : {}),
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

const QUESTIONS = [
  'What can you help me with?',
  'How do I change the name on a booking?',
  'Do you sell bus tickets?',
  'Can I pay in installments?',
];

// One conversation per virtual user: a traveller's messages follow each other, and the API
// answers one at a time in a conversation.
let conversation = null;

export function chat() {
  if (!conversation) {
    // The stack's bot-protection mock accepts any token but "fail".
    const started = post(
      '/v1/agent/conversations',
      { turnstileToken: 'load-test' },
      'POST /v1/agent/conversations',
      'chat',
    );
    if (!check(started, { 'conversation 201': (r) => r.status === 201 })) return;
    conversation = {
      id: started.json('conversation.id'),
      guest: { 'X-Agent-Token': started.json('accessToken') },
      messages: 0,
    };
  }
  const sentAt = Date.now();
  const sent = post(
    '/v1/agent/chat',
    { conversationId: conversation.id, text: pick(QUESTIONS) },
    'POST /v1/agent/chat',
    'chat',
    conversation.guest,
  );
  if (!check(sent, { 'message 202': (r) => r.status === 202 })) {
    conversation = null;
    return;
  }
  conversation.messages += 1;

  // A client polls the run until it has ended (or reads its stream).
  const runId = sent.json('runId');
  let run = null;
  let ended = false;
  for (let attempt = 0; attempt < 50 && !ended; attempt += 1) {
    sleep(0.1);
    run = http.get(`${API}/v1/agent/runs/${runId}`, {
      headers: { ...HEADERS, ...conversation.guest },
      tags: { name: 'GET /v1/agent/runs/{id}', kind: 'chat' },
    });
    ended = run.status === 200 && run.json('done') === true;
  }
  if (check(run, { 'run answered': (r) => ended && r.json('status') === 'succeeded' })) {
    chatAnswer.add(Date.now() - sentAt);
  }
  // A conversation holds 200 messages; start another well before that.
  if (conversation.messages >= 150) conversation = null;
}

export function setup() {
  const ready = http.get(`${API}/ready`);
  if (ready.status !== 200) fail(`API not ready at ${API} (status ${ready.status})`);
  if (CHAT) {
    const assistant = http.get(`${API}/v1/agent/status`, { headers: HEADERS });
    if (assistant.status !== 200 || assistant.json('available') !== true) {
      fail(
        'The assistant is not available on this stack: start it with the assistant, or set LOAD_CHAT=off.',
      );
    }
  }
}
