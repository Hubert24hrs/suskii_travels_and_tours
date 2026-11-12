# ADR-018: Book on hold and installments

- Status: Accepted
- Date: 2026-09-29
- Deciders: Claude Code (implementer), pending owner review

## Context

The spec offers two flexible modes: reserve where the supplier allows a hold and pay in full before
the hold deadline, and deposit plus installments for inventory Suskii controls (packages, tours,
visa services). Airline tickets may only be issued after full payment, and installment flights only
when a supplier hold or a Suskii fare guarantee covers the gap. The full schedule, total and fees
must be shown before commitment, with reminders 3 days and 1 day before each due date, a
configurable grace period and a policy applied on default. Packages, tours and visas arrive in
phase 8; the owner has not set deposit, fee or default rules.

## Decisions

1. **Flights only in this phase.** Hotels have no supplier holds in our adapters. The engine is
   generic (a payment plan with installments on a booking) so phase 8 inventory reuses it.
2. **One model for both modes.** A `payment_plans` row of kind `hold` has one installment (the full
   amount, due by the deadline); kind `installments` has a deposit due now and up to
   `INSTALLMENT_MAX_COUNT` further installments. Reminders, deadlines and defaults work the same
   way for both.
3. **Holds.** Offered when the offer's `hold.available` is true, its payment deadline is at least
   `HOLD_MIN_WINDOW_HOURS` (default 6) away and no paid extras are selected. Choosing it creates
   the supplier hold immediately (Duffel `type: 'pay_later'` order; mock equivalent), stores the
   supplier order id, and moves the booking to `HELD` with our deadline set to the supplier's minus
   `HOLD_SAFETY_MARGIN_MINUTES` (default 120). Paying later re-prices the held order first; a
   changed price goes through the existing consent step. Ticketing then pays the held order
   (Duffel `POST /air/payments`) instead of creating a new one.
4. **Installments** are offered only when the hold exists and the airline guarantees the price
   until the last due date plus the grace period (Duffel `price_guarantee_expires_at`; the mock
   guarantees long holds on refundable fares). Schedule: deposit `INSTALLMENT_DEPOSIT_BPS`
   (default 3000, rounded up to whole currency units), the rest split evenly (the remainder goes to
   the first installment), due dates evenly spaced and at least 24 hours apart, the last one no
   later than the deadline minus the grace period. A schedule that cannot fit at least one payment
   after the deposit is not offered. The deposit must be paid within the normal checkout expiry,
   or the hold is released.
5. **Fees and default policy are configuration** because the owner has not decided them:
   `INSTALLMENT_FEE_BPS` (default 0, added to the total and shown before commitment) and
   `INSTALLMENT_DEFAULT_FEE_BPS` (default 0: everything paid is refunded on default).
   `INSTALLMENT_GRACE_HOURS` defaults to 24 and never extends past the hold deadline.
6. **Default and expiry.** An installment unpaid after its due date plus grace defaults the plan:
   the supplier hold is cancelled, the booking goes to `REFUND_PENDING` and the paid amount minus
   the policy fee is refunded automatically (ADR-019), or `CANCELLED` when nothing is refundable.
   A hold with nothing paid past its deadline goes to `EXPIRED` and is released. Customer
   cancellation of a partly paid plan follows the default policy.
7. **Payment links, not stored cards.** Each installment is paid through a hosted checkout started
   from the booking page. Off-session charges on stored authorisations cannot enforce 3-D Secure,
   need a recurring mandate the owner has not defined, and would put card tokens in scope.
   Revisit once a provider and mandate wording are chosen.
8. **Reaching the booking later.** Guests only hold their booking token in the checkout tab
   (ADR-015), which is not enough to pay next week. Plan emails (confirmation of the hold or plan
   and every reminder) carry an access link `…/bookings/{id}#access={token}`: a random 256-bit
   token stored as an HMAC in `booking_access_links`, valid until the plan ends plus one day. The
   token sits in the URL fragment, so it never reaches server logs or `Referer` headers; the page
   moves it into session storage and removes it from the address bar. It grants exactly what the
   checkout token grants.
9. **Reminders** 3 days and 1 day before each due date (skipped when already inside that window at
   plan creation), by email and SMS (mock SMS until a provider is chosen), and on the due date for
   holds. Each reminder is sent once per installment.
10. **Abuse.** At most `HOLD_MAX_ACTIVE` (default 2) active holds per account or contact email;
    the hold endpoint is rate limited and guests have already passed Turnstile at booking
    creation. Unpaid holds are released at expiry.
11. **State machine.** `partial_payment` is allowed from `HELD`; payments on `HELD` and
    `PARTIALLY_PAID` bookings do not pass through `AWAITING_PAYMENT` (the pending payment row shows
    the open checkout); new `default` event (`PARTIALLY_PAID` to `REFUND_PENDING`); `cancel` also
    from `PARTIALLY_PAID` when the policy refunds nothing.

## Consequences

- With real airlines, holds are usually hours to a few days, so installments on flights will be
  rare; they become common with phase 8 inventory.
- UI copy must say that tickets are issued only after the last payment and what happens on a
  missed payment, using the configured values.
- The owner needs to confirm deposit, fees, grace period and default policy before launch.
