# ADR-071: Hotelbeds hotel adapter and best-price merging

- Status: Accepted (sandbox verification pending)
- Date: 2026-10-27
- Deciders: Claude Code (implementer), pending owner review
- Context: [ADR-069](ADR-069-partner-supply-model.md), [ADR-062](ADR-062-duffel-stays-hotel-adapter.md)

## Context

Hotels come only from Duffel Stays, which needs Stays enabled on the Duffel account. A bedbank
adds inventory and net rates Suskii can mark up. Hotelbeds (HBX Group) offers a free,
self-serve evaluation key: the test host is identical to production but books nothing, and the
key allows 50 requests a day. Production keys follow certification.

Hotelbeds' documentation host does not resolve from this environment. The shapes come from two
typed npm packages: `hotelbeds.ts` 1.0.2 (types generated from the Hotelbeds OpenAPI) and
`@otaip/adapter-hotelbeds` 0.7.4 (written and demonstrated against the Hotelbeds sandbox:
search, book, confirm, cancel). No test calls Hotelbeds.

## Decision

### The adapter

`HotelbedsHotelSupplier` (`src/suppliers/hotelbeds`) implements `HotelSupplier`:

- **Auth.** Every request sends `Api-key` and `X-Signature`, the hex SHA-256 of key, secret and
  the Unix time in seconds; `Accept: application/json`, `Accept-Encoding: gzip`. Redirects are
  refused; the key and secret never reach logs.
- **Search.** `POST /hotel-api/1.0/hotels` with the stay, one occupancy per room (children as
  `CH` paxes with ages) and a `geolocation` circle around the city's coordinates
  (`HOTELBEDS_SEARCH_RADIUS_KM`, default 20 km). A city without coordinates returns no Hotelbeds
  results rather than guessing a destination code. Only `AT_WEB` rates are sold (paid to
  Hotelbeds from our account, like Duffel Stays' balance rule); `AT_HOTEL` rates are dropped.
- **Mapping.** Amounts are decimal strings parsed to minor units (`parseMoney`, never floats).
  `net` is the cost to Suskii (taxes inside unless `taxes.allIncluded` is false and listed
  taxes are not `included`, which become pay-at-property). Stars come from the leading digit of
  `categoryCode` (`4EST` → 4). Refundable means not `NRF` and a future free-cancellation time:
  the earliest cancellation policy's `from` minus one minute. Boards map from `boardCode`
  (`RO`, `BB`, `HB`, `FB`/`AI`). A rate expires 30 minutes after search.
- **Re-pricing.** Before a quote, `POST /hotel-api/1.0/checkrates` confirms every rate (a
  `RECHECK` rate must be checked; a `BOOKABLE` one is checked anyway so the price is current).
  A missing rate is `OfferUnavailableError`.
- **Booking.** `POST /hotel-api/1.0/bookings` with the holder (the first room's lead guest), one
  `AD` pax per room with the lead guest's name, `clientReference` (the first 20 characters of the
  booking item id, without dashes) and `tolerance` 0. Status `CONFIRMED` returns the Hotelbeds
  reference. Hotelbeds has no idempotency key, so `idempotentBooking` is false: an ambiguous
  failure goes to review, never a blind retry (ADR-014).
- **Errors.** 401/403 and 4xx map to `SupplierRequestError`; 429 and 5xx to
  `SupplierUnavailableError`; aborts to `SupplierTimeoutError`; booking errors that say the rate
  or allotment is gone to `OfferUnavailableError`.

### Best price across hotel suppliers

With two hotel suppliers, one hotel can appear twice. After each search, hotels from different
suppliers with the same normalised name (case, accents, punctuation and words such as "hotel"
removed) within 250 metres are merged: the one with the cheaper cheapest rate is kept, and its
rates are the ones sold. Booking stays with that hotel's supplier, so nothing downstream changes.

### Settings

`HOTEL_SUPPLIERS` accepts `hotelbeds`. `HOTELBEDS_API_KEY` and `HOTELBEDS_API_SECRET` (secrets)
are required when it is enabled; `HOTELBEDS_API_URL` defaults to the test host
`https://api.test.hotelbeds.com` and must be https in production; `HOTELBEDS_SEARCH_RADIUS_KM`
defaults to 20.

## Consequences

- To verify on the first evaluation-key run: the search shapes for Lagos and Abuja, `checkrates`
  for a `RECHECK` rate, a test booking and its cancellation (the evaluation host books nothing).
- Cancellation through Hotelbeds (`DELETE /bookings/{ref}?cancellationFlag=...`) is not wired
  into self-service cancellation yet; staff cancel Hotelbeds stays with Hotelbeds and refund
  through the console.
- Hotel names and images come from the Content API in a later change; search shows names and
  stars from availability.
- New outbound host: `api.test.hotelbeds.com` / `api.hotelbeds.com`.
