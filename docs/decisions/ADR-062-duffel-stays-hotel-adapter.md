# ADR-062: Duffel Stays hotel adapter

- Status: Accepted (sandbox verification pending)
- Date: 2026-10-26
- Deciders: Claude Code (implementer), pending owner review

## Context

Hotels have run only on `MockHotelSupplier` since phase 3. ADR-009 recommended Duffel Stays as
the first real hotel provider: it uses the account and token that already serve flights. The
phase 12 production blockers list a real hotel adapter, because production refuses the mock.

Three constraints shaped the work:

- **No credentials.** There is no Duffel token in this repository, and no test may call a real
  provider.
- **No documentation access.** Duffel's documentation and API hosts are blocked by this
  environment's network policy.
- **The SDK as the source.** The request and response shapes come from the types in Duffel's
  official SDK, `@duffel/api` 4.30.1 (`Stays/StaysTypes`), read from npm. The fixtures follow
  those types; none were captured from a live API.

Unlike Duffel flights, Stays works in two steps. A search returns each hotel's cheapest price.
The hotel's full room and rate list comes from a second call, `fetch_all_rates`, on that search
result.

## Decision

### Plan

1. Extend the `HotelSupplier` contract for suppliers whose search returns only some rates. The
   mock is unchanged.
2. Add `DuffelHotelSupplier` with loose Zod schemas, behind `HOTEL_SUPPLIERS=duffel`.
3. Add unit tests on SDK-shaped fixtures, plus an API e2e test against a local fake Duffel
   server.
4. Update the documentation, settings and Terraform example.

### Two-step rates in the search service

- `SupplierHotel` gains two optional fields:
  - `ratesComplete: false`, set when search sent only some rates;
  - `supplierResultId`, the supplier's id for the hotel within its search.
- `HotelSupplier.rates(hotel, query, signal)` loads the full list. By default it returns the
  hotel's search rates, so the mock and future one-step suppliers need nothing.
- `HotelSearchService.hotel()` loads the full list once per hotel per search, through the
  supplier runner (timeout and circuit breaker).
- The list is stored beside the search results as `search:hotels:full:<searchId>`, which expires
  30 minutes after it is first written. The first writer wins, so concurrent page loads agree.
- Rate ids name their list:
  - `.r<n>` is a rate search returned;
  - `.f<n>` is a rate from the full list.

  The `rateId` path pattern accepts both. Ids already handed to a client keep pointing at the
  same rate.

- If the supplier cannot load rates (an error or timeout), the page shows the search rates, which
  quote normally. A later visit tries again. If the supplier says the offer is gone, or returns
  no rate we can sell, the API answers 410 `offer-unavailable`.

### What the adapter sells

- **Fully paid rates only.** We offer a rate only when:
  - `payment_type` is `pay_now`;
  - the available payment methods include `balance`;
  - it is not loyalty-only.

  The traveller pays Suskii through our payment providers, and Suskii pays Duffel from its
  balance. Pay-at-hotel, deposit and guarantee rates would need card details passed to the hotel
  (outside SAQ-A) or a different settlement model, so they are left out.

- **Boards.** `room_only`, `breakfast`, `half_board` and `full_board` map one to one.
  `all_inclusive` is shown as full board, because our boards stop there. A rate with an unknown
  board is left out.
- **Free cancellation** means a full refund, in the rate's currency, before a deadline that is
  still ahead. When there are several such deadlines, the latest one counts.
- **Price.** The total is the rate's total. Taxes are its tax plus fee, counted only when they
  are in the total's currency. The base is the total minus taxes. Amounts are parsed with
  `parseMoney`, never floats.
- **Stand-in rate.** A search result without rooms lists one stand-in rate,
  `cheapest:<search result id>`, priced from the result's cheapest price.
  - Quoting the stand-in first loads the hotel's rates and quotes the cheapest one we can sell.
    If that price differs, the quote shows a price change, as for any supplier.
  - Booking refuses a stand-in that was never quoted.
- **Location.** The search runs 10 km around the city's coordinates, which come from the seed.
  The SDK does not state the radius unit; kilometres is assumed until the sandbox confirms it. A
  city without coordinates gets a request error, so that supplier is skipped and the search
  still answers.
- **Hotel data.**
  - Stars come from `rating` (1 to 5, clamped).
  - The review score comes from `review_score`, on the same 1 to 10 scale we use.
  - Amenities are mapped to our vocabulary, and unknown ones are dropped.
  - The area is left empty.

### Booking

- Duffel Stays takes no idempotency key, so `idempotentBooking` is `false`. An ambiguous failure,
  such as a timeout, goes to REFUND_PENDING for review and is never retried blindly (ADR-014).
- Before booking, the adapter quotes the rate again. If the total no longer matches what the
  traveller paid, the booking is refused with a request error, and the booking pipeline then
  refunds. We never charge a different amount.
- The booking request sends:
  - the quote id;
  - each room's lead guest name;
  - the booking contact's email and phone;
  - `metadata.suskii_booking_item`, the booking item id, so support can match a Duffel booking
    to ours.
- Any status other than `confirmed` goes to review. The confirmation number is Duffel's
  `reference`, or the booking id when there is none.

### Data shared

- **Search:** dates, guest count, child ages and the city's coordinates.
- **Booking:** lead guest names, plus the contact's email and phone.

Both are recorded in `docs/security/external-communications.md` and the release privacy answers.

## Not yet verified (needs a Duffel sandbox run)

The manual `duffel-sandbox.yml` workflow puts these questions to Duffel's test mode, using the
`DUFFEL_API_TOKEN` repository secret. It refuses a live token and sends only made-up travellers.
It runs two things:

- **`pnpm --filter @suskii/api sandbox:duffel`** checks the adapters directly, for flights and
  for hotels. Flights get a search, a re-check and error codes, and with `book` a paid order and
  a hold. Hotels get the checks above. With `book` it books, then cancels what it booked.
- **`pnpm --filter @suskii/api test:sandbox`**, the `journey` input, runs our API in-process as
  the website and the app call it:
  - search, quote and a guest booking;
  - payment on the mock provider;
  - the order or stay booking Duffel confirms.

  It lives in `test/sandbox`, outside the e2e suite, because no test may call a real provider.

For trying Duffel on a phone or in a browser, the local stack (`e2e:stack`) switches to Duffel
with `E2E_FLIGHT_SUPPLIERS` / `E2E_HOTEL_SUPPLIERS=duffel`. It takes only a test token.

1. **Error codes.** Which Stays error codes mean the rate is gone. The client maps
   `offer_no_longer_available`, `offer_expired` and `not_found` to `OfferUnavailableError`.
   Others become request or availability errors.
2. **Rates in search results.** Whether search results ever include rooms and rates. Both cases
   are handled.
3. **Radius unit.** Assumed to be kilometres.
4. **Quote lifetime and balance payment.** How long a quote lives, and whether a balance booking
   needs an explicit `payment` object. The SDK marks it optional.
5. **Duplicate bookings.** Whether a repeated booking request for one quote is refused, which
   would make retries safe.
6. **`instant_payment: true`.** Whether the search's preview filter is worth sending. It would
   make the listed cheapest price a pay-now rate. It is not sent today, because a preview
   parameter the account lacks could fail every search.

## Sandbox results (2026-10-26)

These come from `duffel-sandbox.yml` runs against Duffel's test mode, with the repository secret.

**Flights: confirmed working.**

- **Search.** LHR to JFK returned 52 offers (Lufthansa, BA, AA, Iberia and Duffel Airways). The
  adapter mapped all 52, and every one could be held.
- **Re-check.** The price on re-check matched the listed price. Offers live for 30 minutes.
- **Order and hold.** An order paid from the balance came back with an airline reference and an
  e-ticket number. Duffel cancelled it on request. A hold was granted with payment due in 3
  days, then released.
- **API journey.** Our API went search, quote, guest booking and mock payment, then `CONFIRMED`
  with the airline reference and an e-ticket.
- **Error codes.** An unknown offer answers 404 `not_found`, which our client maps to
  `OfferUnavailableError`. A malformed order answers 422 `validation_required`, mapped to
  `SupplierRequestError`.

**Duffel takes one order per offer request.** A second order or hold on any offer from the same
search is refused with 422 `offer_request_already_booked`. This matters because our search cache
shares one search between travellers who ask the same question within
`SEARCH_CACHE_TTL_SECONDS` (10 minutes by default).

- **The failure.** If two travellers book from the same cached search, the second order is
  refused after payment.
- **What happens today.** The booking fails as a definite supplier error and the payment is
  refunded. No money is lost, but the traveller has a bad experience.
- **Before real traffic.** A follow-up should give each quote its own offer request for Duffel,
  or stop sharing cached Duffel searches. That needs the owner's call.

**Hotels: not checked yet.** Stays answers 403, because Stays is not enabled on the account.
The client now maps a non-JSON error page by its status (403 becomes `SupplierRequestError`),
rather than reporting invalid JSON. The hotel checks above wait for Stays access.

## Consequences

- Setting `HOTEL_SUPPLIERS=duffel` with `DUFFEL_API_TOKEN` enables real hotels. The env schema
  requires the token, and production no longer needs the mock for hotels.
- The hotel page can make one extra supplier call per hotel per search. That call is cached, has
  a timeout and is covered by the breaker.
- **Result-list filters see only the stand-in rate.** The stand-in is room only, and refundable
  only when the search itself asked for free cancellation. So the free-cancellation and board
  filters on the list can hide a Duffel hotel that does have such a rate. The hotel page shows
  every rate. A search made with free cancellation only passes that filter to Duffel. If
  travellers miss hotels this way, the fix is to load full rates for the first page of results.
- **Destination refresh.** The worker's destination refresh now runs one Duffel search per
  published destination every `DESTINATIONS_REFRESH_INTERVAL_MINUTES` (worker setting). Watch
  Duffel's rate limits once real traffic starts.
- Before staging uses it, the owner provides a Duffel account with Stays enabled. Stays access is
  granted by Duffel separately from flights. Someone then runs the items above against the
  sandbox, which needs `api.duffel.com` allowed in this environment's network policy.
