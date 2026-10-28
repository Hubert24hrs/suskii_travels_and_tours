# ADR-086: Expedia Rapid hotel adapter

- Status: Accepted (sandbox verification pending)
- Date: 2026-10-28
- Deciders: Claude Code (implementer), pending owner review
- Context: [ADR-071](ADR-071-hotelbeds-hotel-adapter.md), [ADR-062](ADR-062-duffel-stays-hotel-adapter.md), [ADR-069](ADR-069-partner-supply-model.md)

## Context

Item 10 of the roadmap: hotels from Expedia's Rapid API (Expedia Partner Solutions). Rapid is
partner-only: an approved account, sandbox credentials, then production after certification.
Expedia's developer site and the API hosts (`api.ean.com`, `test.ean.com`) are blocked by this
environment's network policy. The shapes below come from Expedia's official Rapid Java SDK 5.4.1
(`com.expediagroup:rapid-sdk`, generated from the Rapid OpenAPI specification), downloaded from
Maven Central and checked against its published SHA-1. No test calls Expedia.

What the SDK settles:

- **Shopping** (`GET /v3/properties/availability`): `checkin`, `checkout`, `currency`,
  `country_code` (the point of sale), `language`, one `occupancy` per room
  (`adults[-age,age]`), 1 to 250 `property_id`, `rate_plan_count`, `sales_channel`,
  `sales_environment`, optional `filter` (`refundable`, `expedia_collect`, ...). Headers
  `Customer-Ip` and `Customer-Session-Id` are optional; `Test` selects canned answers
  (`standard`, `service_unavailable`, `unknown_internal_error`).
- **Geography and content**: `POST /v3/properties/geography?include=property_ids&supply_source=expedia`
  with a GeoJSON polygon returns property ids; `GET /v3/properties/content` (up to 250
  `property_id`, `language`, `supply_source`) returns names, ratings, addresses and coordinates.
- **Rates**: each rate has `refundable`, `cancel_penalties` (`start`, `end`, `amount`, `nights`,
  `percent`), `merchant_of_record`, `amenities` (id to name), `bed_groups` each with a
  tokenised `links.price_check`, and `occupancy_pricing` keyed by occupancy with `totals`
  (`inclusive`, `exclusive`, `property_fees`, each in `billable_currency` and
  `request_currency`, decimal strings).
- **Price check** answers `status` (`available`, `available_no_change`, `price_changed`,
  `sold_out`), fresh `occupancy_pricing` and `links.book`.
- **Booking** (`POST /v3/itineraries?token=…`): `email`, `phone` (`country_code`,
  `area_code`, `number`), `rooms` (`given_name`, `family_name`, `smoking`),
  `affiliate_reference_id`, `hold`, `payments` (`type`: `affiliate_collect` among others, with a
  `billing_contact`). It answers `itinerary_id`. **`Customer-Ip` is required** on booking and on
  every later itinerary call (retrieve, resume, cancel a room).

## Decision

### The adapter

`ExpediaHotelSupplier` (`src/suppliers/expedia`) implements `HotelSupplier`, enabled when
`HOTEL_SUPPLIERS` includes `expedia`:

- **Auth.** `Authorization: EAN APIKey={key},Signature={sha512(key + secret + unix seconds)},timestamp={unix seconds}`,
  `Accept: application/json`, `Accept-Encoding: gzip`, `Customer-Session-Id` (the search id or
  booking item id, never personal data). Redirects are refused, tokenised links are followed only
  on the configured API host, and the key, secret and link tokens never reach logs.
- **Search.** A 16-point polygon of `EXPEDIA_SEARCH_RADIUS_KM` (default 20 km) around the
  city's coordinates gives property ids (cached in memory for a day per city and radius); the
  first `EXPEDIA_MAX_PROPERTIES` (default 250, one availability call) are shopped with
  `filter=expedia_collect` (and `refundable` when the traveller asks for free cancellation),
  `sales_channel=website`, `sales_environment=hotel_only`, `rate_plan_count`
  `EXPEDIA_RATES_PER_PROPERTY` (default 4), the point of sale `EXPEDIA_POINT_OF_SALE` (default
  `NG`) and `EXPEDIA_REQUEST_CURRENCY` (default `USD`). Content is fetched only for properties
  with rates and cached for a day. A city without coordinates returns nothing.
- **Mapping.** One rate per bed group: its id is the price-check link (property, room, rate and
  token). The price is the sum over the searched rooms of their occupancy's
  `totals.inclusive.billable_currency` (what Expedia charges Suskii); taxes and fees are
  `inclusive` minus `exclusive`; `property_fees` become pay-at-property. Amounts are decimal
  strings parsed to minor units, never floats. Refundable means `refundable` and a first
  penalty still ahead (free cancellation ends a minute before it). Boards come from rate amenity
  names (all inclusive and full board, half board, breakfast, else room only). Stars come from
  `ratings.property.rating`; the guest rating (out of 5) is doubled to our 10-point score. Only
  rates whose merchant of record is Expedia are sold.
- **Re-pricing.** The quote re-checks the rate (price check); `price_changed` returns the new
  price for the traveller's consent flow, `sold_out` is `OfferUnavailableError`.
- **Booking.** Right before booking, a fresh price check; a total different from the one the
  traveller paid is refused (`OfferUnavailableError`, so the booking is refunded, never charged a
  different price). Then the book link with the lead guest per room, the contact's email and
  phone (split into country code and number), `affiliate_reference_id` (the booking item id
  without dashes, at most 28 characters), `hold: false` and one `affiliate_collect` payment whose
  billing contact is the lead guest with the point-of-sale country. `itinerary_id` is the
  confirmation number. Rapid takes no idempotency key, so `idempotentBooking` is false. The
  book call runs inside `creating()`: a 5xx, a lost connection or an unreadable answer after it
  was sent is `SupplierAmbiguousError`, so the booking goes to review instead of a second
  itinerary; staff find it by its affiliate reference. A failed price check before it retries.
- **Errors.** 401/403 and other 4xx are `SupplierRequestError`; 404, 409 and 410 on a link
  (expired or sold) are `OfferUnavailableError`; 429 and 5xx `SupplierUnavailableError`;
  aborts `SupplierTimeoutError`. Expedia's error type is logged, never the body. A decimal
  amount that does not parse drops that rate, never the whole search.

### The traveller's IP

Booking calls happen after payment, from the webhook path, not the traveller's request. So
`createBooking` keeps the client IP of the checkout request on each hotel item whose supplier
asks for it (`HotelSupplier.needsCustomerIp`, true only for Expedia), encrypted with the
record-bound context `booking-item:{id}:customer-ip` (`booking_items.customer_ip_encrypted`);
an IPv4-mapped address is kept as plain IPv4 and anything that is not an IP is not kept.
`TicketingService` decrypts it into `HotelBookingRequest.customerIp`; without it the adapter
refuses to book.

This is the one raw IP the platform stores (elsewhere only HMACs), so it lives as briefly as
the booking call allows: cleared when the item is booked, when ticketing gives up
(`ticketing_exhausted`), at account deletion, and by the retention rule `supplier-customer-ip`
after 7 days for checkouts that were never paid. The data export lists it (`checkoutIps`)
while it exists. Searches and price checks never send it. Later itinerary calls (retrieve,
cancel) would send the IP of the traveller making that request, not the stored one.

### Settings

`EXPEDIA_RAPID_API_URL` (default `https://test.ean.com`; production refuses the test host),
`EXPEDIA_RAPID_API_KEY` and `EXPEDIA_RAPID_SHARED_SECRET` (secrets, required when enabled),
`EXPEDIA_POINT_OF_SALE`, `EXPEDIA_REQUEST_CURRENCY`, `EXPEDIA_SEARCH_RADIUS_KM`,
`EXPEDIA_MAX_PROPERTIES`, `EXPEDIA_RATES_PER_PROPERTY`.

## Consequences

- Expedia's inventory joins search results, merged with the other suppliers by ADR-071's rule.
- Three calls per uncached search (geography, availability, content); a cached city costs one or
  two.
- Before production: the sandbox script passes with the owner's test credentials, Expedia's
  certification scenarios pass, and Expedia confirms the commercial model (Expedia Collect rates
  resold under `affiliate_collect`, invoiced to Suskii) and the billing contact it expects.
- Open questions recorded for the sandbox run: whether `occupancy_pricing` lists a shared
  occupancy once for several identical rooms (the adapter adds it once per room), the exact
  error `type` values, and whether price-check links expire before a typical checkout.

## Alternatives considered

- **Region ids instead of polygons.** Rapid's regions API maps cities to region ids, but our
  catalog keys cities by coordinates; a polygon needs no second mapping table.
- **Ingesting the full property catalog file.** The right step at scale (search without the
  geography call, richer content); not needed before certification.
- **Holding the itinerary at checkout and resuming after payment.** Resume also needs the
  traveller's IP, and an unpaid hold would need cancelling on every abandoned checkout.
