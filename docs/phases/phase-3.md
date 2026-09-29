# Phase 3: Search, catalog and supplier adapters

Status: complete, awaiting owner review

## Goal

Make travel search work end to end on the API: airport and city autocomplete, flight and hotel
search across pluggable suppliers (mock adapters with realistic fixtures, Duffel flights behind a
flag), resilient orchestration (parallel calls, timeouts, circuit breakers, partial results,
caching, offer expiry, re-pricing), and a pricing module (markups, fees, promos, currency
conversion) built on exact money utilities.

## Acceptance criteria (from PROJECT_SPEC.json)

1. Search works end to end with mock suppliers.
2. Money utilities have property-based tests.
3. Supplier failure returns partial results gracefully.

## Plan

### `packages/shared` (used by API, web and mobile)

| Module      | Contents                                                                                                                                                                                                                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `money.ts`  | `Money` = bigint minor units + ISO 4217 code. Exponent table, strict decimal parsing, add/subtract, ratio and basis-point maths with explicit rounding modes (half-even, half-up, up, down), largest-remainder allocation, exact rational FX conversion across exponents, `Intl` formatting, JSON wire format |
| `time.ts`   | IANA time-zone helpers without a dependency: local wall time to UTC (DST gaps and overlaps), UTC to local, local date "today" in a zone, day offsets (+1 arrivals)                                                                                                                                            |
| `search.ts` | Flight search form and request schemas (trip type, 1-5 legs, cabin, travellers, rules from the homepage spec) and hotel search schemas (1-8 rooms, child ages, stay length)                                                                                                                                   |
| Tests       | fast-check property tests for money (acceptance criterion 2), DST and date-line cases for time, schema rules                                                                                                                                                                                                  |

### Data (migration 2)

- `airports.search_text` / `cities.search_text` (accent-folded, lower-case) with GIN `pg_trgm` indexes,
  filled by the seed.
- Pricing: `markup_rules`, `fee_rules`, `promo_codes`, `promo_redemptions` (written from phase 6).
- `offers`: re-priced offer snapshots (supplier, supplier offer id, normalised payload, price,
  expiry) that phase 5 books from.
- `search_logs`: anonymised search analytics (route, dates, party size, cabin, outcome, latency; no
  user, session or IP).

### Catalog (`apps/api/src/catalog`)

- `GET /v1/catalog/places?q=` autocomplete: exact IATA code first, then prefix, then trigram and
  word similarity over airports and cities (cities list their airports). Accent-insensitive.
- `GET /v1/catalog/places/popular`: compact, edge-cacheable index (large airports plus every airport
  in Nigeria) for instant client-side suggestions; the API serves the long tail.
- `GET /v1/catalog/airports/{iataCode}`, `GET /v1/catalog/countries`.

### Suppliers (`apps/api/src/suppliers`)

- Domain types owned by us (never vendor types): `FlightSearchQuery`, `SupplierFlightOffer`
  (slices, segments with local and UTC times plus time zones, baggage, fare brand, conditions,
  hold availability, supplier price), `HotelSearchQuery`, `SupplierHotel`, `SupplierHotelRate`.
- `FlightSupplier` / `HotelSupplier` interfaces: `search(query, signal)` and
  `reprice(supplierOfferId, signal)`. Amadeus and a GDS/consolidator adapter can plug in later.
- `MockFlightSupplier`: deterministic (seeded by the query), geographically plausible itineraries
  from real airport coordinates and time zones: direct and one-stop options via real hubs, fare
  brands, baggage, conditions, NGN for Nigerian domestic routes and USD otherwise. Offers are
  flagged `supplier: "mock"` so clients can label them.
- `MockHotelSupplier`: deterministic hotels around a city with stars, review scores, amenities,
  room rates, board, cancellation deadlines and tax lines.
- `DuffelFlightSupplier` (enabled only when `FLIGHT_SUPPLIERS` includes `duffel` and
  `DUFFEL_API_TOKEN` is set): offer requests, offer re-pricing, error mapping, response validation
  with Zod, and an airline reference sync command (ADR-006). Tested against fixtures shaped like
  Duffel's documented responses (the API is not reachable from this sandbox).
- Resilience: per-supplier circuit breaker (rolling failure rate, cool-down, half-open probe) and
  timeouts via `AbortSignal`.

### Search orchestration (`apps/api/src/search`)

- `POST /v1/flights/searches` and `POST /v1/hotels/searches`: validate (departure not before today in
  the origin's local date), look up the Redis cache by normalised query hash, otherwise call every
  enabled supplier in parallel with per-supplier timeouts inside a 12 s budget, merge and
  de-duplicate, store the result set, price it, and return facets plus the first page. Each
  response lists supplier outcomes (`ok`, `timeout`, `error`, `circuit_open`) and `partial: true`
  when any supplier failed. Partial results are cached briefly so the next search retries.
- `GET .../searches/{id}/offers` (flights) and `.../hotels` (hotels): sort (cheapest, fastest, best;
  price, rating, stars), filters from the spec (stops, airlines, times, price, duration, baggage,
  refundable; stars, rating, free cancellation, amenities), cursor pagination, display currency.
- Offer and hotel detail endpoints; expired offers answer `410` with the original query so clients
  can re-search with preserved inputs.
- `POST .../offers/{id}/quote` and `.../rates/{id}/quote`: re-price with the supplier, persist an
  `Offer` snapshot, and report price changes explicitly (consent screen edge case).
- New search IDs per supplier fetch (never reused), so an old offer id can never point at a
  different offer. Anonymised `SearchLog` written after the response. Search rate limits per IP
  (per minute and per day) and per user.

### Pricing (`apps/api/src/pricing`)

- `FxProvider` interface with a clearly labelled `MockFxProvider`; rates cached in Redis with their
  timestamp; exact rational cross rates via USD.
- Pricing engine: first matching markup rule by priority (vertical, route, countries, airline,
  cabin, supplier, channel, user tier; percentage or fixed, with caps), stacking fee rules (per
  booking or per passenger), promo codes (percentage or fixed, cap, minimum spend, validity,
  verticals, global and per-user limits), conversion line by line so the breakdown always sums to
  the total. Output: fare, taxes, fees, discount, total, FX rate used.
- `POST /v1/pricing/promos/validate` (quote + code), with strict rate limits and one generic
  failure message (no code enumeration).
- No markup, fee or promo is seeded: they are business decisions (admin console, phase 10).

### Observability

Supplier latency and outcome metrics (OpenTelemetry histograms/counters, exported when an OTLP
endpoint is configured), structured logs without PII.

### Tests

Unit: money properties, time zones, schemas, circuit breaker, mock generators (determinism,
plausibility), Duffel mapping and error handling, pricing engine (plus property tests), facets and
filters. E2E (Testcontainers): autocomplete, flight and hotel search end to end, caching, partial
results with a failing and a hanging supplier, circuit breaker opening, expiry and 410, quotes with
price changes, pricing with rules, FX and promos, rate limits.

## Risks and mitigations

| Risk                                                             | Mitigation                                                                                                                        |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Duffel is unreachable from this sandbox and no credentials exist | Adapter built to the documented v2 API, validated with Zod, tested with fixtures; off unless `FLIGHT_SUPPLIERS` includes `duffel` |
| Mock fares could be mistaken for real prices                     | Offers carry `supplier: "mock"`; production refuses mock suppliers and mock FX unless `ALLOW_MOCK_PROVIDERS=true` (staging)       |
| FX source (official vs parallel NGN rate) is a business decision | `FxProvider` interface and mock adapter only; the provider choice is an owner decision (ADR-008)                                  |
| No IANA library in the runtime (Temporal not shipped)            | `Intl.DateTimeFormat`-based conversion with DST gap/overlap handling, tested at known transitions                                 |
| Float drift in prices                                            | bigint minor units everywhere internally, rational FX, explicit rounding modes, property tests                                    |
| Result sets are large                                            | Offers stored once per search in Redis hashes; pages and facets computed from the stored set                                      |
| No traffic data for a "top 500 airports" index                   | Index = OurAirports large airports + all Nigerian airports (about 1,170 entries, roughly 25 kB gzipped)                           |

## Implementation notes (what changed versus the plan)

- **Autocomplete ranking** is computed in SQL (so `LIMIT` keeps the best rows): exact IATA code,
  then prefix, then word prefix, then trigram similarity, plus boosts for major airports, the
  primary market (Nigeria, then Africa) and multi-airport metros. Trigram thresholds are looser than
  pg_trgm's defaults so single typos match ("lagso", "nairobbi"); the tables are small enough that
  the resulting scan takes milliseconds. Search logs can later feed real popularity.
- **City names**: the seed strips OurAirports locality suffixes ("Paris (Roissy-en-France, ...)"),
  so CDG and ORY group under one "Paris".
- **E2E runs the real seed** (about 13 s once per run), so catalog and search tests exercise the
  actual reference data.
- **Re-pricing receives the stored offer** instead of an id, so adapters stay stateless across
  instances (the mock recomputes; Duffel fetches by its offer id).
- **Overnight layovers**: a wait of 4 hours or more that crosses local midnight or starts before
  05:00 (found by a unit test: the first rule missed early-morning connections).
- **Timeouts** reject before aborting, so a task that settles synchronously on abort cannot beat
  the timeout (found by a unit test).
- **OpenAPI problem responses** are generated for every status an operation references; the new
  `410` responses exposed a dangling `$ref` that the client generator rejected. A test now resolves
  every `$ref`.
- **Circuit breakers** are created per application instance (a module-level singleton would have
  leaked state between app instances in tests).
- **Promo validation** runs against a persisted quote (`Offer` row), recomputing the price with the
  caller's current tier; redemption is recorded at payment (phase 6).
- **Hotel "recommended"** sort balances review score and stars against price (the first version
  was too price-heavy and ranked 2-star hotels first in the live smoke test).
- **Live smoke test** (local Postgres + Redis, mock suppliers): LOS-LHR return search in 178 ms,
  16 ms from cache; hotel search in Lagos in 128 ms; quotes, filters, promo and search logs verified.
