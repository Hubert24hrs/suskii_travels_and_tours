# Feature parity: flights, hotels and car rental

The owner sent three feature lists on 2026-11-09 (20 essential features and the advanced ones for
flights, hotels and car rental) and asked that every line be checked and the missing ones built.
The audit is `docs/audits/feature-parity.md`: 48 of 89 lines are built, 22 partly and 19 missing.
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
