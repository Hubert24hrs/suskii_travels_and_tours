# ADR-073: Refund offer for airline changes

- Status: Accepted
- Date: 2026-10-27
- Deciders: owner (refund approach), Claude Code (design)
- Context: [ADR-019](ADR-019-refunds-maker-checker-and-automatic-refunds.md), [ADR-064](ADR-064-online-flight-cancellation.md), [ADR-065](ADR-065-airline-schedule-changes.md)

## Context

The owner chose the US standard for airline changes: when the airline cancels a flight or changes
it significantly, the traveller may take the new schedule or a full refund to the original
payment, in one tap and without calling support. The US DOT rule on refunds (2024) requires this
of airlines and ticket agents. EU 261 gives a refund on cancellation. Nigerian NCAA rules give
similar rights on cancellations.

Today a traveller can accept a change online (ADR-065). Declining it means online cancellation
under the fare's refund rules (ADR-064), which keeps a non-refundable fare, or a call to support.

## Decision

1. **What counts as significant.** A change is significant when, for any changed flight:
   - it is removed with no replacement (the airline cancelled it);
   - it leaves from or arrives at another airport;
   - it has more connections than before; or
   - its departure or arrival moves by at least `SIGNIFICANT_CHANGE_DOMESTIC_HOURS` (3) for a
     flight within one country, or `SIGNIFICANT_CHANGE_INTERNATIONAL_HOURS` (6) otherwise. These
     are the US DOT thresholds.

   It is decided once, when the change is found, and stored on the change
   (`flight_schedule_changes.significant`). A change whose flights cannot be read is not
   significant; support handles it as before.

2. **The offer.** An open, significant change on a confirmed flight, with a supplier that
   cancels online and before departure, carries `refundOffer` on the booking. The amount is
   everything the traveller paid: fare, our fees and service tax. There is no fee and no
   discretion, because the trip they bought is not on offer.
3. **Supplier first.** `POST /v1/bookings/{id}/schedule-changes/{changeId}/refund` asks the
   supplier for a cancellation quote that names the airline change, then:
   - The offer is kept only when the airline's refund covers what we paid it, to our balance and
     in the same currency. If it falls short, or the supplier will not cancel online, the offer
     is withdrawn (`refund_offer_withdrawn_at`), operations are alerted
     (`airline.refund_offer_blocked`) and the traveller is told support will contact them.
     Suskii never funds an airline's refund.
   - If it covers it, the supplier confirms the cancellation. Then, in one transaction:
     - the booking moves to `REFUND_PENDING`;
     - its whole balance is refunded through the refund pipeline (`supplier_cancellation`,
       approved at once, to the original payment);
     - the change closes as `cancelled`;
     - the action is audited (`booking.schedule_change_refunded`).
   - The route takes an `Idempotency-Key`. It also takes the amount the traveller saw: a
     different amount answers 409 `refund-offer-changed`.
   - A supplier that cannot be reached answers 503 and the offer stays.
4. **No refund without the traveller's choice.** The traveller may prefer the new flights, or
   may already have been rebooked by the airline. Every significant change is emailed and pushed
   with both choices. A change the airline resolves elsewhere still alerts operations
   (ADR-065).
5. **Concurrency.** The refund takes the schedule-change lock and the cancellation lock, so it
   never runs alongside an acceptance or an online cancellation of the same booking.
6. **Supplier contract.** `FlightCancellationRequest.airlineChangeId` names the change. The mock
   refunds an involuntary cancellation in full. The Duffel adapter sends the same order
   cancellation; whether Duffel quotes the full involuntary refund could not be checked here
   (its documentation is out of reach from the build container). A short quote falls back to
   support (decision 3), so the safe outcome holds either way.

## Consequences

- Travellers on non-refundable fares get their money back when the airline breaks the booking,
  without a call.
- Suskii gives up its margin on those bookings. That is the cost of the standard, and the
  airline's refund covers the fare.
- `scheduleChange.significant` and `scheduleChange.refundOffer` are additive. Older app builds
  keep the accept button and the support note.
- Open: a Duffel sandbox run with an airline change, to confirm the involuntary refund quote.
