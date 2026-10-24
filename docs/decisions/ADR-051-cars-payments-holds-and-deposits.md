# ADR-051: Cars payments, seat holds and rental deposits

- Status: Accepted
- Date: 2026-10-24
- Deciders: Claude Code (implementer), pending owner review
- Spec name: ADR-cars-payment-holds

## Context

The task asks for three payment patterns:

- bus seats held for 10 minutes, then confirmed on payment;
- rides charged at completion for the final amount;
- rental deposits pre-authorised and released after return.

The platform takes payments only through hosted checkout (SAQ-A) and confirms them only from
verified webhooks (ADR-016). It never charges a stored card without the customer present: that
needs a mandate (ADR-018).

Card pre-authorisation in NGN differs by provider (to be confirmed with each provider on the
owner's merchant accounts):

- Paystack's standard checkout has no separate authorise and capture;
- Flutterwave offers card pre-authorisation only where it is enabled for the merchant;
- Stripe supports manual capture, but NGN payments are routed to Paystack and Flutterwave
  (ADR-016).

## Decisions

### Bus seat holds

1. **Redis is the source of truth for a hold.**
   - A hold is a `SET key value NX PX ttl` per seat (`bus:hold:{tripId}:{seat}`), written in one
     Lua script for all requested seats. Either every seat is taken or none, so 50 parallel
     requests for one seat give exactly one success.
   - A `bus_seat_holds` row records each hold for audit and lets the worker release expired
     holds.
   - Seats already sold are `bus_seat_assignments` rows. A partial unique index
     `(trip_id, seat_number) WHERE active` backs sales up.
2. **The booking converts holds into assignments** in its creation transaction. The holds must
   still be live and belong to the caller.
   - The booking's payment deadline is the earliest hold expiry, never later than
     `BUS_SEAT_HOLD_MINUTES` (10).
   - The existing expiry sweep moves unpaid bookings to `EXPIRED`. That releases the
     assignments (the same hook as `settleSeats`) and deletes the Redis keys.
3. **Late payments.** A payment that arrives after expiry is flagged `requiresRefund` and
   refunded automatically. This already happens for every vertical (ADR-019).

### Rides

1. **Upfront fixed fare.**
   - The rider pays the quoted total before matching: hosted checkout, bank transfer or wallet
     (ADR-017).
   - The quote stores the breakdown (base, distance, time, tolls, booking fee, surge capped at
     `RIDE_SURGE_CAP_BPS`), so the price charged is the price shown.
2. **At completion** the fare is the quoted fare. The pickup and drop-off cannot change
   mid-trip in this version, so the final fare never exceeds the quote by more than 10%. The
   price-change consent path (ADR-014) is therefore never reached.
   - Lower outcomes are settled by an automatic refund of the difference: a cancellation before
     the driver waited past the grace period, `no_driver_found`, a driver cancellation.
3. **Cancellation fees** come from the policy table (data, not code). Once the driver has waited
   longer than the grace period, the fee is kept and the rest refunded.
4. **Driver earnings.** Completion posts the fare split to the ledger: the driver's earnings
   less platform commission, on a new driver-earnings account per driver.
   - Payouts are batched by the worker through `PayoutProvider`, which has a mock
     implementation only.
   - Implemented in P6 (`DriverPayoutsService`): daily, approved drivers with bank details and
     at least `DRIVER_PAYOUT_MIN_MINOR`, the whole balance per driver and currency in one
     provider batch. `payout_sent` moves earnings to payouts-in-flight under a row lock on the
     earnings account, and a partial unique index allows one pending payout per driver and
     currency. The bank's answer posts `payout_settled` (out of the provider balance) or
     `payout_failed` (back to earnings). Pending payouts are followed up by status and resent
     with the same reference when the provider never received them. After `account_rejected`
     the next attempt waits for new bank details; suspended drivers are held.
5. **Cash is off at launch** (decision gate default) and is not implemented. Enabling it later
   needs an owner decision and an ADR: cash fares bypass the provider and need a
   driver-collects ledger flow.
6. **Reconciliation (P6).** Hourly, `LedgerReconciliationService` compares each captured
   payment, settled refund and finished payout once with its ledger postings, and checkout
   payments with the provider's record. Capture postings of the last seven days whose payment
   is not captured are flagged as orphans. Differences become `reconciliation_discrepancies`
   for staff with `finance:reconcile` and an operations alert; nothing is corrected
   automatically. `corrected` makes the next sweep check the record again (and reopen it);
   `accepted` closes it.

### Rental deposits

1. **The deposit is a refundable charge, not a pre-authorisation.**
   - The rental booking's total is rental charge + delivery + chauffeur + deposit. The deposit
     is shown as its own line ("refundable deposit") in the breakdown.
   - The customer pays once, through any enabled provider.
2. **Release.** After check-in, staff with `ground:manage` release the deposit from the
   console. The release is an automatic refund of the deposit, less any recorded damage or fuel
   charge, against the original payment.
   - The refund runs through the existing refund path, ledger postings included.
   - A release of the full deposit is non-discretionary. A deduction needs a reason and is
     audited.
3. **Trade-off.** The customer's money is taken, not just held, so the refund takes the
   provider's refund time (days) instead of releasing at once.
   - Revisit when a provider offers NGN pre-authorisation on our merchant account. The
     `PaymentProvider` interface would then gain `authorize`/`capture`/`void`.

## Consequences

- No new provider capabilities, webhook routes or card-on-file flows are needed.
- Riders can't be charged more after the trip. Fares therefore have to be accurate at quote
  time; the maps fallback caps quotes when routing fails (see ADR-053).
- Rental deposits appear in the customer's statement as a charge and a later refund. The
  checkout page and the confirmation say so.
