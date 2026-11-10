# ADR-098: Car rental rates by the week and month, airport branches and rental options

- Status: Accepted
- Date: 2026-11-10
- Deciders: the owner (asked for airport rentals, a transmission filter, weekly and monthly
  rates, driver age requirements, child seats, GPS, additional drivers, cross-border rentals,
  long-term rentals and other return locations in `docs/audits/feature-parity.md`), Claude Code
  (implementer)

## Context

A rental was a car, a period at the daily rate up to 30 days, an optional chauffeur and delivery.
A branch was a name and an address, so nothing found the cars at an airport; the search could not
filter by transmission; nothing said how old a driver must be; and a renter could add nothing to
the car, take it nowhere abroad and return it only where it was collected. This record covers
part 6 of `docs/phases/feature-parity.md`. The own fleet stays off in production until the owner
turns it on (ADR-069).

## Decision

### Rates by the week and by thirty days

A car may carry a weekly rate (the price of seven days) and a monthly rate (the price of thirty
days) beside its daily rate. `rentalVehicleCost()` in `@suskii/shared` prices a rental's days in
thirty-day blocks, then seven-day blocks, then single days, and **a part never costs more than
the next longer block**: six days cost no more than a week, four weeks no more than thirty days.
So a price never falls when a rental gets longer and never exceeds the daily rate times the
days. The longest rental is now 90 days (`RENTAL_MAX_DAYS`). The chauffeur stays per day.

The search estimate and the quote say how the days were priced (`blocks` / `rate`: months, weeks,
days), and clients print it ("Priced as 1 week and 3 days") only when a longer rate applied.

### Airport branches

A car's branch may name the airport it is at (`airport_code`, IATA). The search takes
`airport=true` (only those cars) and every card, page, quote and booking carries
`branch.airportCode`. There is still no branch table: a branch remains the car's own place, which
is how staff enter the fleet today.

### The driver's age

Each car has a minimum driver age (`min_driver_age`, default 21, 18 to 99). The search takes
`driverAge` and leaves out self-drive cars that ask for more; a quote takes `driverAge` and
answers `quote-invalid` with `driver_too_young` below the car's minimum.

- **It is the renter's word.** Nothing verifies an age online; the licence is still reviewed by
  staff before the car leaves (ADR-050), which is the real check.
- **A chauffeur drives a chauffeured car**, so the age is not asked, not filtered on and stored
  as null there.
- **Optional on the wire.** App builds that predate the field send none: their quotes are
  accepted, and the licence review catches an under-age driver. New clients always send it for
  self-drive.

### Extras, a return to another branch and cross-border cover

Staff enter each with the car; all are stored as JSON on the vehicle and read through
`rentalOptions()`, which validates what is stored and leaves out anything unreadable.

| Option       | Stored                                                       | Charged                  |
| ------------ | ------------------------------------------------------------ | ------------------------ |
| Extras       | `[{ code, dailyMinor, max }]`: child seat, GPS, added driver | Per day and per unit     |
| Other return | `[{ code, name, address, lat, lng, feeMinor, airportCode }]` | The branch's one-way fee |
| Cross-border | `{ countries, feeMinor }` or null                            | One flat fee per rental  |

- A quote takes `extras`, `returnBranch` (a branch's code) and `crossBorder`; what the car does
  not offer is refused (`extra_not_offered`, `extra_too_many`, `return_branch_unavailable`,
  `cross_border_unavailable`). An additional driver beside a chauffeur is refused
  (`extra_with_chauffeur`).
- **Priced again before payment.** `InhouseCatalog.reprice` reads the car's options as they are
  that day (`rentalOptionCharges()`): a dearer extra is a price change the renter must accept,
  and a withdrawn extra, branch or border fails the booking unpaid. An option is never sold at
  an old price or after it has gone.
- **No markup and no deposit change.** The fees join the rental's base price beside the car, the
  chauffeur and delivery; taxes and service fees follow the same rules as before. The deposit
  stays the car's.
- **Lines of their own.** The price breakdown gains `rental_extras`, `rental_one_way` and
  `rental_cross_border`.
- **A one-way rental does not move the car in our records.** The fee pays for bringing it back;
  the turnaround buffer (`RENTAL_TURNAROUND_HOURS`) is unchanged. A fleet that keeps cars where
  they were returned needs a branch table and transfers, which is not built.
- **Cross-border is permission and a fee, not paperwork.** The page lists the countries the car
  may enter. The papers a border asks for (an ECOWAS Brown Card, the owner's letter) are the
  rental desk's to hand over at check-out; the reservation shows staff the countries chosen.

### What staff and clients see

- **Search and car pages** (website and app): filters for transmission, airport branches and the
  driver's age; weekly and thirty-day rates, the minimum age, extras with their daily price, the
  cross-border terms and the return branches on the car's page; the driver's age, extras, the
  return branch and cross-border cover on the booking form. The website's form gets its labels
  written by the server page, so the browser formats no money or country name.
- **Checkout and bookings**: the airport branch, the extras, the return branch and the countries.
- **Console**: the new-car form takes every option; the reservations table lists what to prepare.

## Consequences

- **API contract.** Additive: new optional query parameters and quote fields, new response
  fields. Three new price-line codes: an app build that predates them shows the code's key for
  those lines, and only on a rental quoted with options, which that build cannot choose.
- **Migration.** Expand-only: nullable or defaulted columns on `rental_vehicles` and an index on
  `airport_code`.
- **Stored quotes and bookings** from before have none of the fields; every reader defaults
  them, and the re-check prices them as a rental with no options.
- **Personal data.** The driver's age is kept in the booking item's snapshot. It is in the data
  export's rentals section and cleared with the delivery address on deletion and retention
  (`redactCarsBooking`); the cars data map names it.
- **A 40-day rental that was refused is now accepted.** `too_long` starts above 90 days.

## For the owner

- The weekly and monthly rate of each car, its minimum driver age and whether a young-driver
  surcharge should exist (not built: under the minimum is refused).
- Which extras the fleet has and their daily prices; how many of each a car can take.
- The countries each car's insurance covers, the flat fee, and who prepares the border papers.
- Which branches accept returns from which, and the one-way fees.
- Whether returned cars should stay at the branch they came back to (needs branches and
  transfers as records of their own).
