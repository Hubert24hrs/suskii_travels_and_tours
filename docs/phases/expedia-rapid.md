# Expedia Rapid hotels

Item 10 of the roadmap agreed with the owner: hotels from Expedia's Rapid API (Expedia Partner
Solutions), the largest bedbank, beside Duffel Stays and Hotelbeds. Decision: ADR-086.

## Why

Booking.com and Wakanow win on hotel choice. Duffel Stays needs Stays access on the Duffel
account and Hotelbeds is strongest in Europe and resort areas; Rapid adds Expedia's and Vrbo's
inventory (hundreds of thousands of properties, including West and East African cities), Expedia
Collect rates Suskii resells at its own price, and the merge rule of ADR-071 keeps the cheaper
copy when two suppliers return the same hotel.

## Where the platform stands

- `HotelSupplier` (`search`, `rates`, `reprice`, `book`) with mock, Duffel Stays and Hotelbeds
  adapters, the supplier runner (timeouts, circuit breakers) and cross-supplier merging.
- Hotel bookings are confirmed after payment by `TicketingService`, which calls
  `HotelSupplier.book()` from the payment webhook path, not the traveller's request.
- Expedia's developer site and API hosts are blocked by this environment's network policy. The
  shapes come from Expedia's official Rapid Java SDK 5.4.1 (generated from the Rapid OpenAPI
  specification), fetched from Maven Central and checked against its SHA-1. No test calls
  Expedia.

## What Rapid requires

- **Partner access.** An approved Expedia Partner Solutions account, sandbox credentials, then
  production after certification (vendors report 4 to 12 weeks).
- **Signed requests.** `Authorization: EAN APIKey=…,Signature=…,timestamp=…`, the signature a
  SHA-512 hex digest of key, shared secret and the Unix time in seconds.
- **Shopping by property id.** Availability takes 1 to 250 `property_id` values, so a city first
  becomes property ids (`POST /v3/properties/geography` with a polygon) and names, ratings and
  locations come from the content API (`GET /v3/properties/content`).
- **Price check, then book.** Each bed group of a rate carries a tokenised `price_check` link;
  its answer (`available`, `price_changed`, `sold_out`) carries the `book` link that creates the
  itinerary.
- **The traveller's IP on booking calls.** `Customer-Ip` is required on booking, retrieval,
  resume and cancellation ("the customer's IP, not your own"); shopping and price checks accept
  it optionally.

## Plan

| Step | Work                                                                                                                                                                                                                                           | Files                                         |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 1    | Settings: `expedia` in `HOTEL_SUPPLIERS`, API host (test by default), key and shared secret (secrets), point of sale, request currency, search radius, properties per search and rates per property; production refuses the test host          | `src/config`, `.env.example`, Terraform, Helm |
| 2    | Client: signed header, `Customer-Session-Id`, optional `Customer-Ip` and `Test`, tokenised links followed only on the API host, error mapping, no redirects, timeouts                                                                          | `src/suppliers/expedia`                       |
| 3    | Search: geography polygon around the city, availability for the first batch of properties (Expedia Collect rates only), content for the ones with rates; property ids and content cached in memory                                             | `src/suppliers/expedia`                       |
| 4    | Mapping: billable amounts to minor units, taxes and fees inside the total, property fees as pay-at-property, refundability from cancel penalties, boards from rate amenities, stars and guest ratings from content                             | `src/suppliers/expedia`                       |
| 5    | Re-price and book: a price check before the quote, another right before booking (refused if the total moved), the book call with the lead guests, the contact, `affiliate_collect` payment and the booking item id as `affiliate_reference_id` | `src/suppliers/expedia`                       |
| 6    | The traveller's IP for booking calls: kept encrypted on hotel booking items whose supplier needs it (`booking-item:{id}:customer-ip`), passed to `book()`, cleared once booked (or by retention after 7 days)                                  | `prisma`, `src/bookings`, `src/privacy`       |
| 7    | Sandbox check script (read-only shopping and price check with the owner's test key, `Test: standard`) and the `partner-sandbox.yml` step                                                                                                       | `scripts`, `.github`                          |
| 8    | Tests (signature, client errors, search mapping, price check outcomes, booking body, IP handling) and docs                                                                                                                                     | everywhere                                    |

## Risks

- **Unverified against the live API.** The SDK is generated from Rapid's own specification, but
  amounts, penalties and amenity names have not been seen on real responses. The sandbox script
  and Expedia's certification scenarios must pass before `expedia` is enabled in production.
- **Personal data.** The traveller's IP is kept, encrypted, only for Expedia items and only
  until the hotel is booked (7 days at most); names, email and phone go to Expedia as for any
  hotel supplier.
- **Price moves between quote and booking.** The second price check refuses a changed total, and
  the booking goes to the refund path rather than charging a different price.
- **No idempotency key.** Like Hotelbeds, an ambiguous booking failure goes to review; the item
  id as `affiliate_reference_id` lets staff find the itinerary.
- **Cost and latency.** Three calls per search (geography, availability, content); property ids
  and content are cached for a day, and searches stay within the supplier timeout.

## Outcome

Built and tested against a local stand-in; waits for the owner's Expedia Partner Solutions
account.

- **Adapter** (`src/suppliers/expedia`): signed client with links followed only on the API host,
  search by polygon, availability and content, mapping to minor units, price checks before the
  quote and before booking, and the book call inside `creating()` so an unclear answer goes to
  review (ADR-086). Settings default to Rapid's test host, which production refuses.
- **Checkout IP**: kept encrypted on Expedia items only, sent on the booking call and cleared once
  booked, when ticketing gives up, at deletion or after 7 days (`supplier-customer-ip`); listed in
  the data export while held.
- **Tests**: 26 adapter unit tests (signature, headers, link host check, error mapping, search
  mapping and caching, refundability, boards, price checks, booking body, ambiguity) and an e2e
  test of search, quote, booking, payment and ticketing against a local Rapid stand-in (the IP
  header, ciphertext at rest, clearing, a refund when the price moved after payment, retention).
  Disabling the IP storage makes two of its three cases fail.
- **Sandbox**: `sandbox:partners --only expedia` and `partner-sandbox.yml` search and price-check
  on the test host with the owner's keys; they refuse any other host and book nothing.

Before production: one sandbox run, Expedia's certification scenarios, and Expedia's
confirmation of the commercial model and billing contact. The open questions in ADR-086
(shared occupancies, error types, price-check link lifetime) are answered by that run.
