# Booking as Nigerian travellers know it, and the owner's markups (ADR-124)

Outside the numbered phases. The owner's request of 2026-11-17: use Wakanow's booking system and
logic for bookings on the platform, with a small modification, a markup of 2% on flight fares
and 10% on hotels, cars and everything else.

## Booking logic compared

The left column is Wakanow's public behaviour, from its help pages as search results summarise
them. The pages themselves cannot be read from the build environment.

| Wakanow                                                         | Suskii                                                                           |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Search, choose, travellers' details, extras, pay                | The same flow on the website and in the app                                      |
| Book on hold: reserve now, pay later                            | Reserve now, pay later, while the airline holds the fare (ADR-018)               |
| Pay Small Small: 25% down, the rest in installments             | 25% deposit (was 30%), then installments (this change)                           |
| The traveller chooses the repayment term                        | The traveller chooses how many payments follow the deposit (this change)         |
| Service charge by term                                          | One installment fee, none by default; a charge by term waits for the owner       |
| Paid in full before the travel date, reminders before each due  | Paid before the airline's deadline or the package's balance date, with reminders |
| Bank transfer to an account per booking, exact amount, 24 hours | Transfer, USSD, card, mobile money, cash at an agent (ADR-074)                   |
| Confirmation email with the booking reference and e-ticket      | Confirmation email, airline reference, e-ticket and PDF                          |
| Prices include the agency's margin                              | The owner's default markups (this change)                                        |

## Plan

| Part                  | Where                                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------------- |
| Default markups       | `apps/api/src/pricing/default-markups.ts`, the reference seed, `stableDefaultMarkupId`                |
| 25% deposit           | `INSTALLMENT_DEPOSIT_BPS` (env schema, `.env.example`)                                                |
| Choosing the payments | `installmentSchedule(..., payments)` and `maxInstallmentsBefore()` in `@suskii/shared`                |
| Options and the route | `planOptions()`, `chosenSchedule()`, `installments.choices`, `InstallmentPlanRequest`                 |
| Website and app       | `PlanChoice` in `components/checkout/payment-choice.tsx` and `components/booking/payment-options.tsx` |
| Words                 | `checkout.plan.payments`, `paymentsOption`, `paymentsHint` in five catalogs                           |

## Risks and how they are met

- **A seed overwriting staff's pricing.** Each default is created once under a fixed id and never
  updated. A test switches one off, seeds again and finds it still off.
- **A default beating a specific rule.** Defaults have the lowest precedence the console allows.
- **A chosen number that no longer fits** (the airline granted less time than the offer said).
  The plan is refused with 409 `hold-unavailable` and the airline's hold is released. The client
  says so and offers paying in full.
- **Older app builds.** They send no number and get the plan with as many payments as fit, as
  before.

## Outcome

Built and tested on 2026-11-18:

- **Unit tests:** the defaults and their ids, pricing with them (2% on a flight's fare before
  taxes, 10% elsewhere, none on Prime, a staff rule first), seeding once, and schedules for a
  chosen number of payments.
- **API end to end:** seeding as a release does moves a flight by 2% and a stay by 10%. A
  switched-off default stays off. A route rule comes first. A plan takes a quarter down and the
  number of payments chosen, and a number not on offer is refused.
- **Website and app:** the choice under "Pay in installments", in the booking e2e and the app's
  checkout test.

Waiting for the owner: whether longer plans (months, as Wakanow offers on flights) should be
offered and on what credit terms, and whether the installment fee should grow with the term.
