# Phase 6: Payments, flexible payment and refunds

Status: done, awaiting review

## Goal

Replace the mock-only payment path with real provider adapters, keep every money movement in a
double-entry ledger, let travellers reserve a flight and pay later or pay in installments where a
supplier hold covers the gap, and return money safely: automatic refunds when Suskii cannot deliver,
staff refunds with maker-checker approval, and notifications to the customer and operations.

## Acceptance criteria (from PROJECT_SPEC.json)

1. Webhook replay does not double-credit.
2. Amount tampering fails safely.
3. Payment succeeds but ticketing fails: the booking ends refunded, and the customer and operations
   are notified.

## Scope decisions

- **Providers** (ADR-016): Paystack, Flutterwave (v3) and Stripe (Checkout), all hosted checkout
  (SAQ-A). They are written from the providers' published API references and SDK type definitions
  and tested against recorded payload fixtures and their signature schemes; no test keys exist yet,
  so each must pass a test-mode run before go-live. The mock provider stays for development and
  tests. Several providers can be enabled at once; the checkout offers those that support the
  booking currency.
- **Ledger and wallet** (ADR-017): a double-entry ledger with database-enforced invariants (append
  only, balanced per transaction and currency, no negative customer balances). The wallet is a
  ledger account per user and currency: refunds can go to it and it can pay a booking or an
  installment in full. Partial wallet plus card, referral rewards and the wallet UI arrive with
  accounts in phase 9.
- **Holds and installments** (ADR-018): flights only in this phase (packages, tours and visas are
  phase 8; hotels have no supplier holds). "Reserve now, pay later" when the offer can be held;
  installments only when the hold and the price guarantee cover the whole schedule. Tickets are
  issued only after full payment, and the UI says so. Holds and installments are not offered with
  paid extras.
- **Installment charges** use payment links (the booking page, reached from reminder emails), never
  stored card authorisations: off-session charges cannot enforce 3-D Secure and need a mandate the
  owner has not defined (ADR-018).
- **Guests** paying later get an expiring access link by email (token in the URL fragment, stored
  as an HMAC), because the booking token from checkout lives only in that browser tab (ADR-018,
  extends ADR-015).
- **Refunds** (ADR-019): automatic, non-discretionary refunds (money a booking could not take,
  failed ticketing, installment default) run without approval; staff refunds need a second approver
  above a threshold (default: always). Refunds of already issued tickets need airline-side handling
  that arrives with the admin console (phase 10); staff can still refund money after handling the
  airline offline.
- **Admin UI** is phase 10: this phase ships the admin API (refund request, approve, reject, retry,
  list) with RBAC, MFA and IP allowlist like the existing admin routes.
- **Mobile** is phase 7; it will use the same API.

## Plan

### Shared (`packages/shared`)

- Installment schedule calculator (deposit, equal installments via `allocate`, due dates within
  the hold window) with property tests; refund policy calculation (amount paid minus a basis-point
  fee, capped); payment plan and refund constants.
- Permissions exist already (`refunds:request`, `refunds:approve`).

### API (`apps/api`)

- **Migration 5**: `ledger_accounts`, `ledger_transactions`, `ledger_entries` (triggers: append
  only; balanced per transaction at commit; cached balances; non-negative check), `payment_plans`
  and `installments`, `refunds`, `booking_access_links`; `payments` gains the provider transaction
  id, installment link, method and kind (`checkout` or `wallet`); `booking_items` gains the
  supplier order id and hold deadlines.
- **Ledger** (`ledger/`): `LedgerService.post()` in the caller's transaction, idempotent by key;
  account codes; wallet balance and history (`GET /v1/me/wallet`).
- **Payment providers** (`payments/`): interface gains server-side verification, refunds and
  refund lookup; `PaystackPaymentProvider`, `FlutterwavePaymentProvider`,
  `StripePaymentProvider`; a registry with currency routing; `PAYMENT_PROVIDERS` replaces
  `PAYMENT_PROVIDER`; provider keys in the env schema, required when enabled.
- **Webhooks**: one route per provider (existing path), signature check over the raw body,
  server-to-server confirmation for Paystack and Flutterwave, dedupe by provider event id, ledger
  postings idempotent by payment; payment, refund and checkout-expired events.
- **Reconciliation**: pending payments whose session ended are verified with the provider; a
  confirmed success goes through the same pipeline as a webhook.
- **Payment options**: the quote (and booking) response lists providers and plans (full, hold,
  installments with schedule, fees and total). `POST /v1/bookings/{id}/hold`,
  `POST /v1/bookings/{id}/installment-plan`, payment start takes `provider`, `installmentId` and
  `useWallet`.
- **Suppliers**: `hold()`, `payHeld()`, `cancelHold()` and `getHeld()` on `FlightSupplier`
  (mock, Duffel `pay_later` orders, `air/payments`, `air/order_cancellations`); ticketing pays the
  held order instead of creating a new one.
- **Plans**: partial payments move a booking to `PARTIALLY_PAID`; full payment to `PAID` and
  ticketing. Reminders 3 days and 1 day before each due date (email and SMS); default after the
  grace period cancels the hold and refunds per policy; unpaid holds expire and are released.
- **Refunds** (`refunds/`): refund records per payment, automatic refunds, execution with the
  provider (idempotency key where supported), settlement by webhook or polling, maker-checker
  admin API, customer and operations notifications.
- **State machine**: `partial_payment` from `HELD`; `default` (`PARTIALLY_PAID` to
  `REFUND_PENDING`); `cancel` from `PARTIALLY_PAID` when nothing is refundable;
  `request_refund` from `REFUND_PENDING`-eligible states unchanged; the 100% transition test grows
  with it.

### Worker (`apps/worker`)

- Sweeps every minute: payment reconciliation, due reminders and defaults, refund execution and
  polling (internal routes, as in phase 5).

### Web (`apps/web`)

- Checkout: payment method (enabled providers), payment plan (pay now, reserve and pay later,
  installments) with the full schedule, fees and total before commitment; honest copy about
  ticketing only after full payment.
- Booking page: amount paid, schedule with next due date, pay the next installment or the balance,
  hold deadline, refund status; access links from emails (fragment token to session storage).

## Tests

- Unit: signature verification (valid, tampered body, wrong secret, stale timestamp), payload
  mapping and amount conversion for each provider; ledger invariants (balanced, idempotent,
  non-negative, append only); schedule and refund-policy property tests; state machine matrix.
- API e2e: webhook replay (same event, and a new event for the same payment) leaves the ledger
  unchanged; tampered amount and tampered signature; ticketing failure to automatic refund with
  notifications; hold, pay later and expiry; installments to ticketing; default to policy refund;
  maker-checker (same user cannot approve, threshold); wallet refund and wallet payment; no
  over-refund under concurrency; lost webhook recovered by reconciliation.
- Web e2e: reserve and pay later; installments with the schedule shown before commitment.

## Risks and mitigations

- **Adapters untested against live sandboxes.** Mitigation: official SDK type definitions as the
  reference, fixture tests for every payload and signature, strict parsing that fails closed, and a
  go-live checklist in ADR-016.
- **Double refunds on providers without idempotency keys** (Paystack, Flutterwave). Mitigation:
  an ambiguous refund call is never retried blindly; it is reconciled by listing the transaction's
  refunds (Paystack) or sent to manual review (Flutterwave).
- **Money leaks between ledger and provider state.** Mitigation: every posting is idempotent by
  a business key, balances are checked by the database, refunds are capped by the source account.
- **Hold abuse (seat spinning).** Mitigation: at most two active holds per contact email or
  account, rate limits, Turnstile for guests, holds released on expiry.
- **Installments on flights are rare** because airline holds are short. Mitigation: the plan is
  generic and offered only when it is safe; packages and tours (phase 8) use the same engine.

## Outcome

All three acceptance criteria are met, each by a named test in `apps/api/test/payments.e2e-spec.ts`:

1. "a replayed webhook never credits twice": the same event, and a new event id for the same
   payment, leave the ledger and the booking unchanged (`ledger.e2e-spec.ts` also replays postings
   by key).
2. "tampered amounts fail safely": a tampered signature is rejected; a validly signed event whose
   amount differs from the provider's verified amount, or from the payment, never credits the
   booking, and money that did arrive is refunded automatically.
3. "payment succeeds but ticketing fails": the booking goes through REFUND_PENDING to REFUNDED
   once the automatic refund settles, and both the customer and operations get emails.

The web flows are covered by `apps/web/e2e/booking.spec.ts` ("flexible payment": reserve and pay
in full, installments from the schedule shown before commitment to a cancelled, refunded plan).

### Deviations from the plan

- Refunds live in `src/bookings` (`refunds.service.ts`, `admin-refunds.controller.ts`) next to the
  booking funds and transitions they share, not in a separate `refunds/` module.
- A success for the wrong amount is refunded automatically (phase 5 only flagged it), and
  exhausted ticketing now ends REFUNDED rather than waiting in REFUND_PENDING.
- The booking page can pay from the wallet when the balance covers the amount due; the full
  wallet page is still phase 9.
- Running installment plans show the next payment and its due date on the booking page rather
  than only the final deadline.
- Unplanned: the web error boundary imported the whole message catalog on every page, which the
  new copy pushed over the homepage JavaScript budget; it now gets only its own strings from the
  root layout (216.7 kB to 200.9 kB gzip).
