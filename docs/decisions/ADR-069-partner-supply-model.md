# ADR-069: Partner supply model

- Status: Accepted
- Date: 2026-10-27
- Deciders: Owner (model), Claude Code (research and implementer)
- Research: [docs/research/partner-supply.md](../research/partner-supply.md)

## Context

The owner set the model: Suskii is an online travel agency like Wakanow or Booking.com. It does
not run drivers, cars or hotels and does not vet third parties ("we will not do any KYC for
drivers or verify any third party"). Prices for flights, hotels, cars and the rest come from
partner APIs, affiliate programmes and partnerships.

The platform had two kinds of supply that did not fit:

- **Own ride-hailing** (`rides`, `drivers`): driver onboarding needs KYC, payouts and a safety
  operation. Production refuses to start rides without a real KYC provider.
- **Own car rental fleet** (`rentals`): needs vehicles, handover inspections and licence checks.

Everything else already came from partners: flights and hotels from Duffel, buses from operator
partnerships, and the in-house tours, packages and visa products from operators staff enter.

## Decision

Suskii sells two kinds of supply, chosen per product by what partners offer.

### Merchant supply: we sell at our price

The traveller pays Suskii; Suskii pays the supplier its net price and keeps the markup and fees
(`PricingService`, staff-managed rules). Booking, payment, refunds and the ledger are the
existing pipeline.

| Product                        | Supplier                                      | Status                             |
| ------------------------------ | --------------------------------------------- | ---------------------------------- |
| Flights                        | Duffel                                        | Live (ADR-009, ADR-063 to ADR-065) |
| Hotels                         | Duffel Stays                                  | Live, needs Stays access (ADR-062) |
| Hotels                         | **Hotelbeds APItude**                         | **New** (ADR-071)                  |
| Buses                          | Operator partnerships (staff-allocated seats) | Live (ADR-049)                     |
| Tours, packages, visa, add-ons | Local operator partnerships                   | Live (ADR-025)                     |

When the same hotel comes from two hotel suppliers, the search keeps the cheaper one (ADR-071).

### Affiliate supply: the partner sells, we earn commission

Where no API sells net rates to a new agency, the traveller books on the partner's site through
a tracked link and the partner pays Suskii commission (ADR-070).

| Product              | Partners                                                     | Prices shown in Suskii                   |
| -------------------- | ------------------------------------------------------------ | ---------------------------------------- |
| Car rental           | DiscoverCars, Localrent, Economybookings (via Travelpayouts) | No: the partner searches                 |
| Airport transfers    | GetTransfer, Kiwitaxi (via Travelpayouts)                    | No                                       |
| Tours and activities | **Viator** (Partner API, Basic Access)                       | **Yes**: titles, ratings and from-prices |
| eSIM                 | Airalo (via Travelpayouts)                                   | No                                       |
| Travel insurance     | EKTA (via Travelpayouts)                                     | No                                       |

Each programme is one entry in the code catalogue (`src/partners/partner-programs.ts`) with its
category, network and landing page; adding a partner is one entry.

### Own operations retired from the launch model

- **Ride-hailing and the own fleet stay switched off.** `CARS_RIDES_ENABLED` and
  `CARS_RENTALS_ENABLED` are already off in production unless set; they stay unset. With rides
  off, production needs no KYC, maps or payout provider. The code stays dormant and tested, so a
  future partner-operated fleet could use it, but it is not part of the product.
- **Car rental and transfers come from partners** (above). The app and website show the partner
  offers where they showed rides and rentals (client work follows this backend change).
- **Buses stay**: operators are partners and staff allocate their seats; no driver is vetted.

### Earning more

- **Cross-sell on every booking.** `GET /v1/bookings/{id}/partner-offers` turns a booked trip
  (city and dates) into transfer, car, eSIM, insurance and tour offers.
- **Commission is measured.** Clicks and conversions are recorded per programme and reported to
  staff with `reports:read` (ADR-070).
- **Markups stay staff-managed.** No markup or fee is hard-coded or seeded.

## Consequences

- Production can start without KYC, maps and payout providers (rides stay off).
- New settings: Hotelbeds credentials (ADR-071), Travelpayouts and Viator credentials (ADR-070).
  Each is required only when its feature is on in production.
- The owner signs up for Hotelbeds, Viator Basic Access and Travelpayouts; flights for domestic
  Nigerian carriers still need IATA accreditation or a consolidator.
- Affiliate bookings are the partner's: Suskii does not hold the traveller's payment, does not
  handle their changes or refunds, and must say so where it links out.
- Later merchant sources (RateHawk hotels, Hotelbeds transfers and activities, Airalo's Partner
  API) plug into the same supplier interfaces.
