# ADR-016: Payment providers, routing and verification

- Status: Accepted
- Date: 2026-09-29
- Deciders: Claude Code (implementer), pending owner review

## Context

The spec names Paystack and Flutterwave for NGN and African payment methods (cards, bank transfer,
USSD) and Stripe for international cards, behind a `PaymentProvider` interface, with hosted
checkout only (SAQ-A), verified and deduplicated webhooks as the source of truth, and server-side
amount checks. The owner has not chosen which provider comes first and no test keys exist. The
providers' documentation sites are unreachable from the build environment; their official SDK
packages (Stripe, Flutterwave v3, Duffel) are available from npm and were read for endpoint paths,
field names and signature schemes.

## Decisions

1. **Adapters, not SDKs.** Each provider is a small `fetch` client in `src/payments/<vendor>`
   mapping vendor payloads to the domain `PaymentEvent` and refund types; vendor types never leave
   the adapter (same rule as suppliers, ADR-009). No vendor SDK becomes a dependency.
2. **Hosted checkout only.** Paystack `POST /transaction/initialize`, Flutterwave
   `POST /v3/payments` (standard checkout link, `session_duration` from our expiry), Stripe
   `POST /v1/checkout/sessions` (`mode=payment`, one line item with the booking total). Card data
   never reaches Suskii. Only the payment id and booking reference go into provider metadata;
   the contact email is shared because providers require it for receipts and fraud checks.
3. **Enabling and routing.** `PAYMENT_PROVIDERS` is an ordered list (`mock`, `paystack`,
   `flutterwave`, `stripe`); it replaces `PAYMENT_PROVIDER`. Each enabled provider requires its
   keys at boot, and production refuses `mock` unless `ALLOW_MOCK_PROVIDERS=true`. Adapters declare
   the currencies they settle: Paystack NGN, GHS, ZAR, KES, USD; Flutterwave NGN, GHS, KES, ZAR,
   USD, EUR, GBP; Stripe every supported currency. The checkout lists the enabled providers that
   support the booking's currency in configured order, the first being the default; the traveller
   may pick another. A booking is still charged in its single settled currency.
4. **Webhook verification** over the exact raw body:
   - Paystack: `x-paystack-signature`, HMAC-SHA512 of the body with the secret key (Paystack has no
     separate webhook secret, so `PAYSTACK_WEBHOOK_SECRET` from the spec's example is not used).
   - Flutterwave v3: `verif-hash` must equal `FLUTTERWAVE_WEBHOOK_HASH` (constant-time compare).
   - Stripe: `Stripe-Signature` `t=...,v1=...`, HMAC-SHA256 of `{t}.{body}` with
     `STRIPE_WEBHOOK_SECRET`, any matching `v1`, timestamp within 5 minutes.
     A missing or wrong signature answers 400 and is logged without the body.
5. **Server-to-server confirmation.** Flutterwave's hash is a static shared secret, so a success
   is applied only after `GET /v3/transactions/{id}/verify` reports `successful` with our
   reference, amount and currency. Paystack successes are confirmed the same way with
   `GET /transaction/verify/{reference}`. Stripe's per-endpoint HMAC with a timestamp already binds
   the payload, so no extra call. If the confirmation call fails the webhook answers 503 and the
   provider retries later; a contradicting answer is treated as an invalid webhook.
6. **Deduplication, two layers.** `webhook_events` is unique per provider event id (Stripe
   `evt_...`; Paystack and Flutterwave have no event id, so `{event}:{transaction id}`). Ledger
   postings are idempotent by business key (`payment:{id}:captured`), so even a new event for an
   already credited payment cannot credit twice.
7. **Amount checks** stay as in ADR-014: a success is applied only when its amount and currency
   equal the server-computed amount stored on that payment. Anything else is never applied: it is
   recorded as unapplied money and refunded automatically (ADR-019).
8. **Reconciliation.** Webhooks can be lost. Every minute the worker verifies pending payments
   whose checkout has expired or that are older than 15 minutes with the provider
   (`verifyPayment`); a confirmed outcome is fed through the same pipeline as a webhook with the
   event id `reconcile:{reference}:{status}`, so it is processed once.
9. **Checkout expiry.** Our payment deadline stays authoritative. Stripe requires 30 minutes to 24
   hours, so its session gets at least 31 minutes; a success after our deadline is refunded
   automatically. Abandoned Stripe sessions are expired through the API when possible.
10. **Refund APIs.** Paystack `POST /refund` (subunits), Flutterwave
    `POST /v3/transactions/{id}/refund` (major units), Stripe `POST /v1/refunds` with an
    `Idempotency-Key`. Only Stripe supports idempotency keys, which shapes refund retries
    (ADR-019).
11. **Amounts on the wire.** Paystack and Stripe use minor units; Flutterwave uses major units and
    is converted with `parseMoney` (which rejects more decimals than the currency allows) and
    `toDecimalString`. Floats never enter money code.

## Go-live checklist (per provider)

1. Owner supplies test keys; set them in the secret store, never in `.env` files in git.
2. Register the webhook URL `https://api.<domain>/v1/payments/webhooks/<provider>` (Flutterwave:
   set the secret hash; Stripe: subscribe to `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
   `checkout.session.expired`, `refund.updated`).
3. Run the booking flow in test mode: success, failure, abandoned checkout, refund, duplicate
   webhook (the provider's resend button) and a lost webhook (reconciliation).
4. Compare recorded payloads with the adapter fixtures and adjust mappings before enabling live
   keys.

## Consequences

- The three adapters are verified against fixtures only until test keys exist.
- Traveller-facing method labels ("Card, bank transfer or USSD", "International card") come from
  the adapter, so the checkout does not hardcode providers.
- Adding a provider means one adapter file, its env keys and a routing entry.
