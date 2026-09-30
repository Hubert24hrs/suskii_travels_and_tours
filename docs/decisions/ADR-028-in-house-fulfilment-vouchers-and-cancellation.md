# ADR-028: In-house fulfilment, vouchers and cancellation

- Status: Accepted
- Date: 2026-09-30
- Deciders: Claude Code (implementer), pending owner review

## Context

Flight and hotel bookings move PAID → TICKETING → CONFIRMED when the supplier books them, then
get an e-ticket or hotel voucher PDF. In-house products have no supplier call, tours need a
voucher that guides can check (spec: "QR voucher"), and products carry cancellation rules.

## Decisions

1. **Fulfilment.** After payment, the ticketing step fulfils in-house items without a supplier:
   seats move from reserved to sold, a voucher row and PDF are created and, for visa assistance,
   the applications are opened. The booking goes to CONFIRMED in the same transaction, so the
   existing retries, notifications and push messages apply unchanged.
2. **Vouchers.** Each confirmed tour, package and add-on item gets a random voucher code (20
   characters without look-alikes); only its HMAC is stored for lookup. The PDF shows the code and,
   for tours, a QR code encoding `SUSKII-V1:{code}`: no name, reference or other personal data.
   Operations redeem a code once through an admin route (`bookings:manage`), which answers with the
   product, date and traveller count and records who redeemed it.
3. **Cancellation policy.** Products carry tiers `[{ daysBefore, refundBps }]` evaluated on the
   start date in the product's time zone. A confirmed package, tour or add-on can be cancelled by
   its owner: the refund for the matching tier is created with `RefundsService.createAutomatic()`
   (non-discretionary, so no maker-checker) and the seats are released. A new state machine event
   `withdraw` moves CONFIRMED to CANCELLED when the tier refunds nothing; otherwise the existing
   `request_refund` path leads to REFUNDED. Visa assistance is cancelled through support, because
   work and government fees may already have started.
4. **Package payment plans.** Packages accept the reserve-now and installment plans (ADR-018): the
   seats reserved on the departure act as the hold, and the plan's deadline is the balance-due
   date (`PACKAGE_BALANCE_DUE_DAYS` before departure). Deposit, fee and grace come from the
   existing plan configuration.

## Consequences

- Guides can check vouchers with any QR reader and the admin route; a leaked QR code reveals no
  personal data and can be redeemed only once.
- Refunds for cancellations are automatic and bounded by the policy and by what was paid.
