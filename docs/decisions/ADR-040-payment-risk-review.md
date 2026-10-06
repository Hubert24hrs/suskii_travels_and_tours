# ADR-040: Payment risk signals and manual review

- Status: Accepted
- Date: 2026-10-06
- Deciders: Claude Code (implementer), pending owner review

## Context

The spec asks for fraud controls on payments: velocity checks, card country against IP country,
many cards per account, high-risk routes, and a manual review in admin. Hosted checkout keeps card
data away from us (SAQ-A). Providers still report a card's issuing country and an opaque card id.
A fraudulent booking costs the most once the ticket is issued, so the check has to run between
capture and fulfilment.

## Decisions

1. **Signals.** All of them are computed in the capture transaction from data the platform
   already holds.

   | Signal                  | Fires when                                                                                                      | Weight |
   | ----------------------- | --------------------------------------------------------------------------------------------------------------- | -----: |
   | `velocity_account`      | the account had `PAYMENT_RISK_MAX_PAYMENTS_PER_DAY` (5) other card payments in 24 h                             |     40 |
   | `velocity_contact`      | the same contact email did                                                                                      |     40 |
   | `velocity_ip`           | more than `PAYMENT_RISK_MAX_ATTEMPTS_PER_IP` (10) payments started from the IP in 24 h                          |     30 |
   | `card_country_mismatch` | the card's issuing country differs from the connection's country                                                |     30 |
   | `many_cards`            | more than `PAYMENT_RISK_MAX_CARDS` (3) distinct cards on the account (or contact) in 30 days                    |     40 |
   | `high_risk_route`       | a flight touches a pair in `PAYMENT_RISK_ROUTES` or a country in `PAYMENT_RISK_COUNTRIES`, or a trip goes there |     30 |
   - At or above `PAYMENT_RISK_REVIEW_SCORE` (60) the payment is held. By default one signal
     alone never holds a payment; two do.
   - Wallet payments are not scored.

2. **What is stored.** These go on the payment row, and never raw card data:
   - An HMAC of the payer's IP.
   - The country the edge reported. It is read only when `CLIENT_COUNTRY_HEADER` names a header
     the edge overwrites, such as `cf-ipcountry`.
   - The card's issuing country.
   - An HMAC (`card-fingerprint`) of the provider's card id: Paystack's authorization
     `signature`. Flutterwave sends no token, so its adapter hashes the truncated number and
     expiry, and the digits never leave the adapter.

   Stripe's webhook carries no card details, so those two signals stay off for Stripe.

   Account deletion and the retention sweep clear all four fields (ADR-039).

3. **Hold.**
   - A held booking stays PAID, with an open `PaymentRiskReview` (score and signal codes only).
   - The background ticketing call is skipped. The ticketing sweep ignores PAID bookings with an
     open review, and `TicketingService` refuses them as well.
   - Operations get an alert (`payment.risk_review`).
   - The capture is audited (`payment_risk.held`).
4. **Review.**
   - Finance (`payments:review`, a new permission held by finance and super admins) works the
     queue at `/v1/admin/payment-reviews` and the console's "Payment reviews" section. The queue
     shows the earliest supplier hold, because a held fare can lapse.
   - **Approve** releases the booking to fulfilment.
   - **Reject** takes a reason code (`confirmed_fraud`, `customer_unverified`, `card_reported` or
     `other`; no free text). It moves the booking to REFUND_PENDING (`request_refund`, reason
     `risk_rejected`) and refunds its whole balance automatically. `finalizeBooking` then closes
     it as REFUNDED.
   - Both decisions are step-up actions (ADR-037). Each is claimed with a conditional update, so
     only one person can decide, and is audited (`payment_risk.approved`, `payment_risk.rejected`).
5. **Fraud-prevention data** is not in the data export. The registry records why.

## Consequences

- With the defaults most payments are never held. A held booking is fulfilled once approved,
  which may be too late for a fare whose supplier hold lapses; the review screen shows that
  deadline.
- Device and BIN-level signals, provider risk scores (Stripe Radar, Paystack fraud data) and
  3-D Secure outcomes can be added as further signals behind the same review. The weights are
  code constants, reviewed like any change.
- Open for the owner:
  - The review score, the limits and the watched routes and countries.
  - Who staffs the queue.
  - Whether payment providers may share card fingerprints (already listed for referral checks).
