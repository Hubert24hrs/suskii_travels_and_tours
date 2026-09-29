# ADR-011: Deals, hotel destinations and the internal API

- Status: Accepted
- Date: 2026-09-29
- Deciders: Claude Code (implementer), pending owner review

## Context

The homepage shows "Fresh flight offers" from a deals service that a worker refreshes, and "Top
hotel destinations" from the CMS with minimum prices from hotel search. The guardrails require
every deal price to come from a real or clearly labelled mock quote with a "from" qualifier and a
"last updated" time, and stale deals must drop automatically. Supplier adapters live in the API;
the worker is a separate process (`apps/worker`, BullMQ).

## Decisions

### Data

- `DealRoute`: origin and destination airports, slug (`lagos-to-london`, used by the SEO route
  pages), stay length, cabin, active flag and order. Seeded with starter routes from the five origin
  cities the spec names (Lagos, Abuja, Port Harcourt, Accra, Nairobi) to popular destinations. This
  is configuration, not a business fact: the admin console manages it in phase 10.
- `DealSnapshot`: one row per successful refresh with the cheapest fare found (dates, airline,
  stops, duration, supplier base and taxes in the supplier currency, supplier name, fetched at).
  Snapshots are kept 7 days for price history, then pruned.
- `DestinationContent` (the spec's CMS entity): city, slug, featured flag, order, optional image
  URL, published. Seeded with the nine destinations the spec lists.
- `DestinationHotelSnapshot`: hotel count and cheapest nightly rate per refresh.

### Pricing at read time, never stored as display prices

Snapshots keep the supplier price and the context the markup rules need (route, countries,
carrier, cabin, supplier). The public endpoints price them on every read with the pricing engine,
so markups, fees, the display currency and the sales channel are always current. The "from" price
is per adult for the round trip, including taxes and fees, like the search results.

### Freshness and honesty

- Public endpoints return only snapshots newer than `DEALS_MAX_AGE_HOURS` (default 24); older ones
  disappear from the homepage automatically.
- Every item carries `updatedAt` (the fetch time) and `sample: true` when the supplier is the mock,
  which the web renders as a "Sample fare" badge. Mock suppliers are refused in production unless
  `ALLOW_MOCK_PROVIDERS=true` (ADR-009), so sample fares cannot reach customers unlabelled.
- No discount badge: a percentage off needs a real reference price. It returns with promotions in
  the admin console.

### How a refresh works

Each deal route is searched for a few departure dates (`DEALS_DEPARTURE_OFFSETS_DAYS`, default 21
and 45 days ahead, return after the route's stay length, one adult, economy) through the normal
search orchestration, so caching, validation, circuit breakers and de-duplication apply and a
customer searching the same trip shares the cached result. The cheapest offer becomes the
snapshot. Hotel destinations run one hotel search (check-in `DESTINATIONS_CHECK_IN_OFFSET_DAYS`
ahead, 2 nights, 2 adults) and store the hotel count and the cheapest nightly rate.

### Worker and internal API

The worker never talks to suppliers or the database directly. It owns scheduling, fan-out, retries
and rate limiting (BullMQ job schedulers and per-route jobs with exponential backoff); the API owns
the domain and exposes token-guarded internal routes under `/v1/internal`:

- `@InternalRoute()` = not user-authenticated, but requires `Authorization: Bearer
<INTERNAL_API_TOKEN>`, compared in constant time over SHA-256 digests. The token is at least 32
  characters, required in production, and production refuses the local development default.
- Internal routes are documented in the OpenAPI document (tag `internal`) so the worker uses the
  generated types; the edge (Cloudflare) should block `/v1/internal/*` from the internet in phase
  12 as defence in depth.
- The API's default limits (120 requests per minute per route, 600 per minute per IP) apply, and
  refreshes reuse the search cache, so even a leaked token cannot make the API hammer suppliers.
- Without `INTERNAL_API_TOKEN` the routes answer 404. `.env.example` ships a clearly named local
  development token (`local-dev-only-…`) so the stack works out of the box; production refuses it.

## Consequences

- One code path prices search results, deals and destinations.
- A cold cache costs a few supplier searches per route every refresh interval; the interval and
  date offsets are configurable to fit real supplier quotas (Duffel) later.
- If the worker stops, deals age out after 24 hours instead of showing stale prices.
