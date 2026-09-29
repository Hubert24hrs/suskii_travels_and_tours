# ADR-019: Refunds, maker-checker and automatic refunds

- Status: Accepted
- Date: 2026-09-29
- Deciders: Claude Code (implementer), pending owner review

## Context

The spec requires refunds by an admin role with maker-checker approval above a threshold, all
money movements in the ledger, and, when payment succeeds but ticketing fails after the retry
budget, an automatic refund with notifications to the customer and operations. Phase 5 flagged
unusable money (`requiresRefund`) and parked exhausted ticketing in `REFUND_PENDING` for manual
handling. The owner has not set the approval threshold or the operations process.

## Decisions

1. **One refund per provider charge.** A `refunds` row targets one payment (a wallet payment is
   refunded to the wallet), with amount, destination (`original` or `wallet`), reason, requester,
   approver and provider refund id. Lifecycle: `pending_approval` → `approved` → `processing` →
   `succeeded` or `failed`; also `rejected`, and `needs_review` when the provider outcome is
   unknown.
2. **Automatic refunds** run without approval because they are not discretionary: the system
   computes the amount and the ledger caps it. They cover:
   - money a booking could not take (a second payment, an amount mismatch, a payment after the
     booking closed): the whole payment, back to the original method;
   - ticketing that failed definitively or exhausted its retries: the booking's balance, per
     payment;
   - installment default or cancellation of a partly paid plan: the paid amount minus the policy
     fee (ADR-018).
     Each is audited with the system as actor, and the customer and operations are notified.
3. **Ambiguous ticketing failures never refund automatically.** When the airline may have issued
   tickets (a timeout with a supplier that cannot retry safely, reason `*_needs_review`), a refund
   request is created in `pending_approval` so operations check with the supplier first.
4. **Staff refunds (maker-checker).** Someone with `refunds:request` creates a refund (payment,
   amount, destination, reason, note, whether it cancels the booking). If its value in NGN is above
   `REFUND_APPROVAL_THRESHOLD_NGN` (minor units; default 0, so every staff refund needs a
   checker), a different person with `refunds:approve` must approve it; the requester can never
   approve their own refund. Below the threshold it is approved on creation. Rejections need a
   reason. All of it is audited.
5. **Execution** happens outside database transactions: the API executes right after approval and
   the worker picks up anything approved or processing. Stripe gets the refund id as
   `Idempotency-Key`, so an ambiguous failure is retried. Paystack and Flutterwave have no
   idempotency keys: an ambiguous failure moves the refund to `needs_review`; for Paystack the
   worker then lists the transaction's refunds and settles or fails it from what it finds;
   Flutterwave refunds stay for operations. A definitive failure reverses the ledger posting,
   alerts operations and can be retried by staff as a new refund.
6. **Settlement** comes from refund webhooks (Paystack `refund.processed` and `refund.failed`,
   Stripe `refund.updated`) or polling (Paystack and Stripe refund lookups); Flutterwave refunds
   reported as pending go to operations after `REFUND_REVIEW_AFTER_HOURS` (default 72).
7. **Booking status.** A refund created with "cancel booking" (and every automatic refund of a
   booking balance) moves the booking to `REFUND_PENDING`; when its balance reaches zero and no
   refund is in flight it becomes `REFUNDED`. Partial goodwill refunds leave a confirmed booking
   confirmed.
8. **Notifications.** Customers get "refund on its way" and "refund completed" emails. Operations
   get an email at `OPS_ALERT_EMAIL` (when set) for automatic refunds, refunds needing review,
   failed refunds, amount mismatches, ticketing needing review and installment defaults, besides
   the audit log.

## Consequences

- Refunds of already issued tickets (airline refund or void) need supplier-side tooling that comes
  with the admin console in phase 10; until then staff handle the airline side offline, then refund
  here.
- The threshold default is deliberately strict; the owner can raise it.
- Refund reasons are fixed codes, never free text in the audit metadata; staff notes are stored on
  the refund row, not in logs.
