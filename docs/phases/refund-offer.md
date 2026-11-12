# Refund offer for airline changes

Item 2 of the standards plan agreed with the owner on 2026-10-27. Decision record:
[ADR-073](../decisions/ADR-073-refund-offer-for-airline-changes.md).

## Owner's answer this work follows

"Automatic refund offer": when the airline cancels or significantly changes a flight, the traveller
is offered a full refund to the original payment, or the new schedule, in one tap, with no support
call (the US DOT standard).

## Where the platform stands

- Airline changes are found by the six-hourly check and shown on the booking page and in the app
  (ADR-065). The traveller can accept a change online.
- Declining a change means online cancellation under the fare's refund rules (ADR-064), which
  refunds little or nothing on non-refundable fares, or a call to support.
- A change that removes a flight with no replacement waits for support.

## Plan

| Step | Work                                                                                                                                                                                | Files                                                   |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 1    | `significantChange()`: a flight removed with no replacement, another airport, more connections, or times moved by the domestic or international threshold; unit tests               | `src/bookings/schedule-changes.ts`, spec                |
| 2    | `significant` and `refund_offer_withdrawn_at` on `flight_schedule_changes` (expand-only migration); thresholds as settings                                                          | `prisma/`, `src/config/env.schema.ts`, infra examples   |
| 3    | Supplier contract: the cancellation request names the airline change; the mock refunds an involuntary cancellation in full                                                          | `src/suppliers/supplier.types.ts`, mock                 |
| 4    | `POST /v1/bookings/{id}/schedule-changes/{changeId}/refund`: the airline cancels first, then everything the traveller paid goes back; support when the airline's refund falls short | `schedule-changes.service.ts`, controller, schemas      |
| 5    | Booking: `scheduleChange.significant` and `scheduleChange.refundOffer`; the email names the refund choice                                                                           | `bookings.service.ts`, `bookings.schemas.ts`, templates |
| 6    | Website and app: "Get a full refund" beside "Accept new times", with a confirmation showing the amount                                                                              | `apps/web`, `apps/mobile`, `@suskii/i18n`               |
| 7    | Tests: unit, API e2e (refund, repeat, not significant, airline refund short, airline down), web e2e, app Jest                                                                       | tests                                                   |
| 8    | Docs: ADR-073, CLAUDE.md, CHANGELOG, access control, settings                                                                                                                       | `docs/`, `infra/`                                       |

## Risks

- **Money out before the airline refunds.** Nothing is refunded until the supplier has cancelled
  the order, and the offer is only kept when the airline's refund covers what we paid it, to our
  balance and in the same currency. Anything short goes to support with an alert, so Suskii
  never funds an airline's refund.
- **Our margin.** The traveller gets everything they paid, our markup, fees and service tax
  included: the trip they bought is no longer on offer.
- **Duffel behaviour.** Whether Duffel quotes an involuntary refund in full after an airline
  change could not be checked from the build container (its documentation is out of reach). If
  it quotes less, the offer falls back to support, which is safe; the Duffel sandbox run with an
  airline change settles it.
- **Mobile contract.** The new fields are additive; older app builds keep showing the change
  banner with the accept button.

## Outcome

All eight steps are built.

- API: `significantChange()` (unit tests for every rule and both thresholds), the two columns
  (expand-only migration; a fresh database migrated from scratch has no drift against the
  schema), the supplier contract and mock, and the refund route.
- `schedule-changes.e2e-spec.ts`:
  - a four-hour move on a non-refundable fare offers everything back, where online cancellation
    would refund nothing;
  - the refund cancels with the airline first and repeats safely;
  - the booking ends `REFUNDED` once the refunds run;
  - a 90-minute move offers no refund;
  - an airline refund of half what we paid withdraws the offer, alerts operations and leaves
    the booking confirmed and acceptable;
  - an airline outage answers 503 and keeps the offer;
  - a changed amount answers 409;
  - another booking's change answers 404.
- Website: the booking page's refund button and confirmation (Playwright, with axe).
- App: the trip screen's refund button and confirmation (Jest).

Waiting on the owner: one Duffel sandbox run with an airline change, to confirm that Duffel quotes
the full involuntary refund (otherwise every offer goes to support, which is safe).
