# Feature parity: flights, hotels and car rental

The owner sent three feature lists on 2026-11-09 (20 essential features and the advanced ones for
flights, hotels and car rental) and asked that every line be checked and the missing ones built.
The audit is `docs/audits/feature-parity.md`: 48 of 89 lines were built, 22 partly and 19 missing.
This plan covers the 41 lines that are not built. It runs outside the numbered phases, in six
parts, each one pull request with its tests.

## Parts

| Part | Product | What it adds                                                                                                                                                                            | Lines closed                                                   |
| ---- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1    | Flights | A price for each day around the chosen dates when "Flexible dates" is ticked, the cheapest day marked; nearby airports; meal requests; group requests; other flights after a disruption | A9, A16, cheapest dates, nearby airports, alternatives, groups |
| 2    | Flights | Seat selection where the airline sells seats through the supplier                                                                                                                       | A15                                                            |
| 3    | Flights | Live flight status on the day of travel and delay alerts, behind a provider                                                                                                             | Status tracking, delay alerts                                  |
| 4    | Hotels  | Photos, descriptions, property types and room details from the suppliers; the app's filters (price, stars, amenities, breakfast, area)                                                  | B4, B5, B8, B10, B12, B13                                      |
| 5    | Hotels  | A map of the results; collections (family, luxury, honeymoon, last-minute, long stays); hotel deals; things to do near the hotel; suggestions from the traveller's own searches         | B6, B7, B19, B20 and the advanced lines                        |
| 6    | Cars    | Transmission filter; airport branches; weekly and monthly rates and rentals up to 90 days; driver age; child seats, GPS and extra drivers; cross-border terms; return to another branch | C4, C11, C13, C17 and the advanced lines                       |

## Rules for every part

- No parallel flows: flights and hotels stay on the search, quote and booking pipeline; rentals on
  the rental quote and the booking pipeline; group requests are support conversations (ADR-083).
- Supplier data stays behind the adapters. A feature the supplier cannot do is shown as not
  available for that fare, never faked. The mock supplier implements each new capability so the
  test stack and the test app can show it.
- New copy goes in every catalog (ADR-076); new screens follow the accessibility rules (ADR-088).
- Contracts change only by adding fields. A changed contract regenerates the OpenAPI files.
- Anything that needs an account, a contract or a decision from the owner is built behind a
  setting, off or on the mock, and added to `docs/owner/launch-checklist.md`.

## What stays for the owner

- **Videos of hotels.** None of the three hotel suppliers sends videos. Photos are added in part 4.
- **Restaurants near a hotel.** No contracted supplier lists restaurants. Things to do come from
  the activities partner.
- **Live flight status.** It needs a flight-status data provider (a paid account). Part 3 builds
  the tracking and the alerts on a provider interface with the mock; the owner picks the provider.
- **Map tiles.** A map needs a tile provider. Part 5 records the choice in an ADR.
- **Corporate fleet and contract rates.** Company bookings and approvals already cover rentals;
  negotiated rates need the owner's commercial terms.
- **AI recommendations.** AI trip search stays the way a sentence becomes a search (ADR-061).
  Ranking stays a fixed, explainable rule; nothing lets a model choose prices or offers.

## Outcome

Filled in as each part lands.

### Part 1: flights (ADR-093)

Built on the API, the website and the app:

- **Flexible dates.** `POST /v1/flights/date-prices` prices the days around a one-way or return
  search (`FLEXIBLE_DATES_DAYS`, default 3 each side) through the shared search cache. The results
  show the strip when "Flexible dates" was ticked or "See prices on nearby days" is pressed; the
  cheapest day is marked and a day is a link to its search.
- **Nearby airports.** `GET /v1/catalog/airports/{iataCode}/nearby`; under the results, the same
  search from or to an airport within 150 km.
- **Meal requests.** Seven special meals per traveller with a seat, where the offer says the fare
  takes one; refused otherwise. Shown on the booking and the itinerary PDF. The mock airline
  takes them on international flights; Duffel fares say to ask the airline until the sandbox
  check.
- **Group requests.** `/flights/groups` and the app's group screen send 10 to 500 travellers as a
  support conversation with the topic `group_booking`; the console inbox filters by topic and
  the after-hours assistant stays out.
- **Other flights after a disruption.** A significant airline change links to the booked search
  beside the refund offer.

Also fixed on the way: the app's support screens read API problem types in the wrong format, so
"five open conversations", "email needed" and "conversation full" showed the generic error.

Tests: API e2e `flight-extras.e2e-spec.ts` (11), shared unit tests, the app's Jest suites
(results, checkout, trip, search form, group request), the website's `flight-extras.spec.ts`.

The audit now reads 22 built, 6 partly and 1 missing for flights. Left for the owner: the Duffel
sandbox check for special meals, who answers group requests, and counsel's view on meal requests
as sensitive data (`docs/owner/launch-checklist.md`).
