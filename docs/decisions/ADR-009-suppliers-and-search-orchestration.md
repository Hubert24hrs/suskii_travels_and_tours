# ADR-009: Supplier adapters and search orchestration

- Status: Accepted (hotel provider pending owner decision)
- Date: 2026-09-29
- Deciders: Claude Code (implementer), pending owner review

## Context

Phase 3 needs `FlightSupplier` and `HotelSupplier` interfaces, mock adapters with realistic
fixtures, a Duffel flight adapter behind a feature flag, and orchestration with parallel calls,
timeouts, circuit breakers, normalisation, Redis caching and offer expiry. Supplier failure must
return partial results. The API budget is 12 seconds per search.

## Decisions

### Adapters and domain types

- Suskii owns the domain types (`SupplierFlightOffer`, slices, segments, layovers, fare
  conditions, holds; `SupplierHotel`, rates). Adapters translate vendor payloads into them;
  nothing outside `src/suppliers/<vendor>` sees vendor types.
- Every time is stored as local wall time plus IANA zone plus UTC instant, so "+1" arrivals and
  layover warnings (short connection, airport change, overnight, long) are computed once, the same
  way for every supplier. Visa-required transit warnings need the visa rules table (phase 8).
- `reprice(offer)` receives the stored offer, so adapters stay stateless across instances.
- **Feature flags**: `FLIGHT_SUPPLIERS=mock,duffel` and `HOTEL_SUPPLIERS=mock`. Duffel needs
  `DUFFEL_API_TOKEN`; production refuses the mock suppliers unless `ALLOW_MOCK_PROVIDERS=true`.
- **Mock flights** are deterministic (seeded by the query) and geographically plausible: real
  airports, coordinates and zones from the seed; real carrier codes and hubs; direct flights where a
  carrier's network allows, one-stop via hubs with limited detours; fare brands with baggage and
  conditions; NGN for Nigerian domestic routes, USD otherwise. A fictional "Suskii Mock Air" covers
  pairs no fixture route serves. Every offer carries `supplier: "mock"` so clients can label it.
- **Mock hotels** are fictional, stable per city, with stars, review scores, amenities, room types,
  board, cancellation deadlines and tax lines (7.5% VAT in Nigeria).
- **Duffel** follows the documented v2 API (offer requests, offer lookup for re-pricing, airlines
  reference data). Responses are validated with Zod; invalid offers are skipped and counted.
  Errors map to `SupplierTimeoutError`, `SupplierUnavailableError`, `SupplierRequestError` and
  `OfferUnavailableError`. The API is not reachable from the build sandbox, so the adapter is
  tested against fixtures shaped like Duffel's documentation; a sandbox-token smoke test is the
  first task once credentials exist.
- **Airlines** are synced from Duffel with `pnpm --filter @suskii/api airlines:sync` (ADR-006).

### Orchestration

- Every enabled supplier is called in parallel inside the 12 s budget (`SEARCH_TIMEOUT_MS`), each
  with its own timeout (`SUPPLIER_TIMEOUT_MS`) that wins even if the adapter ignores its abort signal.
- **Circuit breaker per supplier and vertical**: opens when at least 50% of at least 5 calls in a
  60-second window fail, fails fast while open (reported as `circuit_open`), and lets one probe
  through after 30 seconds. State is per process.
- **Partial results**: each response lists supplier outcomes (`ok`, `timeout`, `error`,
  `circuit_open`) and `status: partial` when any failed. If every supplier fails the API answers
  `503` with `Retry-After` instead of an empty list.
- **Caching**: identical normalised queries map to the current search for
  `SEARCH_CACHE_TTL_SECONDS` (default 10 minutes; spec 5-15), or 60 seconds when partial, so a failed
  supplier is retried soon. Identical concurrent searches share one supplier fetch per process.
  Pricing happens per request (rules, currency, channel and tier differ), never in the cache.
- **Identity and expiry**: each supplier fetch gets a new random search id, and result ids embed
  it, so an old id can never point at a different offer. Results live 30 minutes; the request
  lives 24 hours, so an expired list, offer or quote answers `410` with the original request and
  clients can re-run the search with every input preserved (edge case from the spec).
- **Quotes**: `POST .../quote` re-prices with the supplier, persists an `Offer` snapshot (the
  booking starting point in phase 5) and returns `priceChange` whenever the total moved, for the
  consent screen.
- Merged offers are de-duplicated by itinerary (flights, times, fare brand, cabin), keeping the
  cheaper supplier. Results are sorted "best" by default (price 60%, duration 30%, stops 10%).
- Searches are logged anonymously (`search_logs`: route, dates, party size, cabin, channel,
  outcome, latency; no user, session or IP) after the response. Supplier latency and outcomes are
  OpenTelemetry metrics.
- Streaming results (spec performance tactic) are not needed yet: the mock answers in milliseconds.
  If real suppliers make the first page slow, an SSE endpoint can stream per-supplier results
  using the same store.

### Hotel provider (owner decision)

The spec asks for one real hotel provider "chosen via ADR". Recommendation: **Duffel Stays**, for
one contract, one integration style and one reconciliation flow with flights. Hotelbeds is the
alternative with deeper African inventory but separate commercial terms. The `HotelSupplier`
interface is ready for either; implementation starts when the owner signs up and provides
credentials.

## Consequences

- Adding Amadeus or a GDS/consolidator is a new adapter plus a flag value.
- Per-process breakers and single-flight mean a cold instance may call a failing supplier a few
  times before learning; acceptable at this scale, revisit with shared state in Redis if needed.
- Mock data is realistic enough for UI work and demos but can never reach production by accident.
