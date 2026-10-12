# Payment provider outage

**Alerts:** `PaymentProviderUnavailable`, `PaymentWebhookProcessingFailed`,
`PaymentWebhooksRejected`, `PaymentSuccessRateLow` (ADR-047).
**Dashboard:** Suskii overview: payments by outcome, webhooks by result.
**Background:** ADR-016 (providers, routing, verification), ADR-017 (ledger), ADR-019 (refunds).

## What is at risk

- Travellers cannot pay, so unpaid bookings expire at their payment deadline and fares are lost.
- Payments that did succeed stay `pending` until the platform can confirm them. Nothing is
  ticketed until then.
- No money is lost through the platform: only verified outcomes count, every event is applied
  once, and money that arrives for a booking that can no longer take it is refunded
  automatically.

## 1. Find which failure it is (5 minutes)

| Signal                                                                  | Most likely cause                                            | Go to |
| ----------------------------------------------------------------------- | ------------------------------------------------------------ | ----- |
| `result="provider_unavailable"`; provider status page shows an incident | The provider's API is down or slow                           | 2A    |
| `result="rejected"` or `"unconfirmed"` rising, no provider incident     | Webhook secret rotated or endpoint misconfigured; or probing | 2B    |
| `result="failed"`; errors in Sentry under `/v1/payments/webhooks`       | A bug or database problem on our side                        | 2C    |
| Success rate low, webhooks fine                                         | Cards declined at the provider (bank or fraud rules)         | 2D    |

Check the provider's dashboard as well: its webhook delivery log shows our responses.

## 2A. Provider down

1. **Stop new payments through it** if the outage will last more than a few minutes:
   - Set `PAYMENT_PROVIDERS_PAUSED=<provider>` and redeploy the API.
   - Checkout then offers only the other providers for each currency. If no other provider
     settles a currency, travellers paying in it see "payment unavailable" until you unpause.
   - Webhooks, reconciliation and refunds for the paused provider keep working.
   - Never remove it from `PAYMENT_PROVIDERS` during an outage: that orphans its pending
     payments and refunds.
2. **Leave reconciliation running.** Every minute the worker verifies pending payments older
   than `PAYMENT_RECONCILE_AFTER_MINUTES` (15) with the provider, rechecking each every 5
   minutes. When the provider answers again, confirmed payments go through the normal webhook
   pipeline (`reconcile:{reference}:{status}`) and their bookings move on to ticketing.
3. **Holds and installments:** plans keep their grace period (`INSTALLMENT_GRACE_HOURS`). If
   the outage could make travellers miss a due payment, decide with the owner whether to raise
   the grace period for the duration (config change and redeploy).
4. Unpause when the provider's status is green and a test payment in the staging environment
   succeeds.

## 2B. Webhooks rejected

1. Compare the provider's webhook settings with our configuration:
   - Paystack signs with the secret key.
   - Flutterwave sends the secret hash (`FLUTTERWAVE_WEBHOOK_HASH`).
   - Stripe signs with `STRIPE_WEBHOOK_SECRET`.
   - The endpoint must be `https://<api-host>/v1/payments/webhooks/<provider>`.
2. If someone rotated a secret, update it in the secret manager and redeploy. Providers retry
   failed deliveries, and reconciliation verifies anything still pending.
3. If the rejected requests do not match the provider's delivery log, someone is probing the
   route. Signatures and verification already stop them. Block the source at the edge if the
   volume is a problem, and note it in the incident record.

## 2C. Our processing fails

1. Open the Sentry issue (tag `route=/v1/payments/webhooks/:provider`) and the request ids in
   the logs. Check database health (`/ready`, `DatabaseConnectionsHigh`).
2. Fix forward or roll back the last deploy. Providers retry with backoff for hours to days,
   and duplicates are dropped by event id, so a fix applies to the waiting events.
3. Never edit payments, ledger entries or booking statuses by hand. The database refuses ledger
   edits, and status changes outside `BookingTransitions` skip the audit trail.

## 2D. Declines

Declines are the provider's decision. Look at the failure reasons in the provider dashboard. A
sudden rise from one country or BIN range can be card testing: check that payment start limits
hold (429s in the logs), and that the risk review queue (console, Payment reviews) is being
worked.

## 3. Verify recovery

- `suskii_payment_webhooks_total` shows `processed` again, and `failed` and
  `provider_unavailable` stay flat.
- No pending payment is older than 30 minutes, except checkouts still open.
- The ticketing backlog drains (`suskii_bookings_in_flight{status="TICKETING"}`).
- Console, Refunds: anything in `needs_review` from the incident is assigned to finance.

## 4. Afterwards

- Payments that completed after their booking expired are refunded automatically as late
  payments. Finance checks them in the console, Refunds.
- Pending payments the provider never confirmed expire 24 hours after their checkout closed.
- Write the review. If the provider was down for long, raise a second provider for that
  currency with the owner (open owner question: which providers launch).
