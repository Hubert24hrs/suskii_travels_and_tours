# Failed webhook replay

**Alerts:** `LedgerDiscrepanciesRaised` (reconciliation found money that does not match),
`PaymentWebhookProcessingFailed` once its cause is fixed (see
[Payment provider outage](payment-provider-outage.md), section 2C).
**Dashboard:** Suskii operations, Cars row: ledger discrepancies and driver payouts; Suskii
overview: webhooks by result.
**Background:** ADR-016 (providers and verification), ADR-017 (ledger), ADR-051 (Cars money).

## Why replaying is safe

- A webhook is stored and applied in one database transaction, keyed by provider and event id.
  If applying fails, nothing is stored, so the provider's next delivery is applied as new.
- Once applied, the same event id is a `duplicate` and changes nothing. Ledger postings carry
  business idempotency keys (`payment:{id}:captured`, ...), so a second application cannot post
  twice either.
- Every outcome still needs the provider's own verification (`verify()`), so a replayed or
  forged payload cannot mark a payment paid by itself.

## 1. Find what was not applied

1. Console, **Finance**, Discrepancies: each open row names the subject (payment, refund or
   payout), the kind and the amounts. `ledger_missing` on a succeeded payment is the usual sign
   of a webhook that never applied.
2. The API logs for the provider's request ids (`payment event processed`, or errors on
   `/v1/payments/webhooks/<provider>`), and Sentry for the failure.
3. The provider's dashboard: its delivery log shows each event, our response code and retries.

## 2. Replay

Fix the cause first (section 2C of the payment outage runbook), then, in this order:

1. **Let the provider retry.** Providers redeliver failed events with backoff for hours to days.
   Most discrepancies clear on their own once the fix is live.
2. **Resend from the provider's dashboard** for events that ran out of retries (Paystack,
   Flutterwave and Stripe each offer a resend on the event or delivery page).
3. **Let reconciliation confirm pending payments.** Every minute the worker calls
   `/v1/internal/bookings/reconcile-payments`, which verifies pending payments older than
   `PAYMENT_RECONCILE_AFTER_MINUTES` with the provider and applies the outcome through the
   same pipeline under a synthetic event id (`reconcile:{reference}:{status}`). To run one pass
   by hand from a secured operations shell:

   ```bash
   curl -fsS -X POST -H "Authorization: Bearer $INTERNAL_API_TOKEN" \
     "$API_INTERNAL_URL/v1/internal/bookings/reconcile-payments"
   ```

4. Never insert webhook events, payments or ledger rows by hand. The ledger tables refuse
   updates, and a status changed outside the transitions skips the audit trail.

## 3. Close the discrepancy

1. Run the ledger check again (it runs on its own every `LEDGER_RECONCILE_INTERVAL_MINUTES`):

   ```bash
   curl -fsS -X POST -H "Authorization: Bearer $INTERNAL_API_TOKEN" \
     "$API_INTERNAL_URL/v1/internal/finance/reconcile-ledger"
   ```

2. Console, Finance, Discrepancies, **Resolve**:
   - `corrected` once the replay applied it: the record is checked again on the next run and
     the discrepancy reopens if it is still wrong.
   - `accepted` only for a difference finance has explained and recorded elsewhere (for
     example a provider fee settled outside the ledger). It closes for good.

## 4. Verify

- No new `suskii_reconciliation_discrepancies_total` in the next run.
- The affected bookings moved on (paid, confirmed or refunded) in the console.
