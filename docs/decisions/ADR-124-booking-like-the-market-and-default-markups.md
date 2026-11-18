# ADR-124: Booking as Nigerian travellers know it, and the owner's default markups

- Status: Accepted
- Date: 2026-11-18
- Deciders: the owner (asked for bookings to follow Wakanow's booking logic with a small
  modification: a markup of 2% on flight fares and 10% on hotels, cars and everything else),
  Claude Code (implementer)
- Amends: ADR-018 (book on hold and installments), ADR-035 (pricing rules are entered in the
  console and none was seeded)

## Context

The owner asked for booking on the platform to follow Wakanow's booking system and logic, with
their own markups: 2% on flight fares, 10% on hotels, 10% on cars, 10% on everything else.

The spec forbids the Wakanow name, logo, imagery, copy and trademarks (`PROJECT_SPEC.json`, brand
guardrails). Wakanow's systems are not ours to connect to: there is no agreement or API access,
and their pages cannot be read from the build environment either. So "their logic" means the
public behaviour of their booking, as their help pages describe it and search results summarise
it:

- **Book on hold:** reserve now and pay later, before a deadline.
- **Pay Small Small:** a 25% down payment, the rest in installments. The traveller chooses the
  repayment term, from 24 hours to 6 months, with a service charge that depends on the term.
  Everything is paid before the travel date, with reminders before each due date.
- **Bank transfer:** to an account issued for each booking, valid 24 hours, for the exact
  amount, confirmed automatically, with the ticket issued after.
- **Cards** (Mastercard, Visa, Verve) and other channels.
- **Confirmation:** by email, with a booking reference and the e-ticket.

Suskii already does most of this:

- Reserve now, pay later (ADR-018).
- Deposits and installments (ADR-018), for flights while the airline holds the fare, and for
  packages until their balance is due (ADR-028).
- Transfers, USSD, cards, mobile money and cash at an agent (ADR-074). The provider's checkout
  issues the transfer account for each payment.
- Reminders before each due date (ADR-018).
- Confirmation emails with the airline reference and the ticket.

Three things differed: no markup was set (ADR-035 left every rule to the console), the deposit
was 30%, and the traveller could not choose how many payments to make.

## Decision

1. **The owner's markups are default markup rules, one per vertical** (`DEFAULT_MARKUP_BPS` in
   `apps/api/src/pricing/default-markups.ts`):
   - 2% on flights;
   - 10% on hotels;
   - 10% on Cars: buses, rides and rental cars;
   - 10% on everything else Suskii sells: packages, tours, visa assistance, travel add-ons and
     assisted quotes.

   A Suskii Prime membership takes none: its price is already the owner's own, per country
   (ADR-082).

   **What a percentage applies to:** the supplier's price before its taxes, as every markup rule
   does. Taxes are passed on as they are, which is the travel trade's convention for airline
   taxes in particular.

   **How the rules are created:** the reference seed creates each rule once, under an id fixed per
   vertical (`stableDefaultMarkupId`), at the lowest precedence the console allows (priority
   10,000).
   - Any rule staff add, for a route, a supplier, a channel or a cabin, comes first.
   - A release never updates or re-creates a default, so staff can change its value or switch it
     off in the console (audited, with step-up) and keep that.
   - Markup rules are never deleted, only switched off.

   The record over every vertical makes a new vertical a compile error until it has a decision.

2. **Installments follow the same terms as Pay Small Small, within our own limits:**
   - **Deposit:** 25% (`INSTALLMENT_DEPOSIT_BPS` now defaults to 2500, rounded up to whole units
     as before).
   - **Number of payments:** the traveller chooses how many follow the deposit, like a repayment
     term. Fewer payments are spread over the same time, so each comes later.
   - **What clients get:** the payment options list one schedule per number that fits, fewest
     first (`installments.choices`). The installment plan route takes the chosen number
     (`payments`). A number no longer on offer answers 409 `hold-unavailable`, and nothing is
     held.
   - **Older clients:** they still get the plan with as many payments as fit (`schedule`).
   - **The clients:** the website and the app show the choice under "Pay in installments" with
     the schedule for it, before anything is committed.
3. **What stays as it is, on purpose:**
   - **Plan length:** plans still end before the airline's own ticketing deadline (flights) or
     the balance due date (packages). Wakanow's six-month terms on flights would mean issuing
     tickets before full payment, or holding fares the airline does not guarantee. That is a
     credit decision for the owner, not a booking rule.
   - **Installment fee:** one fee whatever the number of payments, set by `INSTALLMENT_FEE_BPS`
     (none by default). A charge that grows with the term waits for the owner's amounts.
   - **Transfer accounts:** they stay the payment provider's.
   - **Naming:** nothing a traveller reads names Wakanow or uses its product names.
     "Pay in installments" stays our own words.

## Consequences

- **Prices go up:** from the first release after this change, every price a traveller sees
  carries the markup. That covers search, deals, hotel destinations, metasearch partners,
  quotes and the re-check before payment. Prime members still get their plan's share of the
  markup back (ADR-030).
- **Where the markup goes:** it is margin, so tax rules on Suskii's service (`margin`, ADR-072)
  count it. A driver's share of a ride is still taken from the metered fare before any markup
  (ADR-051).
- **Test suites:** the API e2e suites empty the pricing rules before each test, so their
  supplier figures are unchanged. `default-markups.e2e-spec.ts` seeds the defaults as a release
  does and checks a flight at 2% and a stay at 10%. The website and console suites run on a
  seeded stack, so their prices include the defaults. The console's markup test now adds 20%
  over the default 10%.
- **Smaller deposits:** a 25% deposit lowers the amount the platform holds if a plan defaults.
  The missed-payment fee (`INSTALLMENT_DEFAULT_FEE_BPS`) is unchanged.
- **Owner decisions:** whether longer plans should be offered and on what credit terms, and
  whether a charge should grow with the number of payments.

## Alternatives considered

- **Connecting to Wakanow:** there is no agreement or access, and the brand guardrails forbid
  presenting their product as ours.
- **Markups as settings, outside the console:** they would apply where staff cannot see or change
  them, and two places would decide a price.
- **A markup on the whole price, taxes included:** it would mark up airport and government taxes,
  which the trade passes on as they are, and change what every existing rule means.
