# ADR-119: Paystack's test mode on the testing backend, and Duffel in the mode of the payments

- Status: Accepted
- Date: 2026-11-14
- Deciders: the owner (asked to see a customer's payment reach Suskii on the testing backend),
  Claude Code (implementer)
- Amends: ADR-111 (the backend on one machine), ADR-116 (Duffel's test mode)

## Context

The testing backend's payments were fixed to the stand-in page (`PAYMENT_PROVIDERS: mock` in
the machine's compose file), which completes every payment through the signed webhook
(ADR-014). That proves the booking pipeline, but not that a payment made through a real
provider reaches Suskii: the provider's hosted checkout, its signed webhook, the verification
call before a payment counts (ADR-016), and the channel name of each payment method (ADR-074
left them to one sandbox payment per method).

The Paystack adapter is built and tested against a fake server. Paystack's test mode moves no
money: test keys (`sk_test_`), test cards, simulated transfers and USSD, and a dashboard that
lists each test transaction.

Two gaps stood in the way:

- **Currencies.** The adapter routed every currency it can take (NGN, GHS, ZAR, KES, USD) to
  Paystack, but an account settles only some: a Nigerian account takes naira, and US dollars
  once Paystack enables them. A booking in any other currency would reach Paystack's checkout
  and fail there.
- **Mixed modes.** ADR-116 refused a live Duffel token beside the mock page. With Paystack's
  test mode a supported setup, the same danger had another door: the API accepted a Paystack
  test key beside a live Duffel token, which would book real tickets for payments that moved no
  money (its test even named that combination "real payments"). The reverse, live payments
  beside Duffel's test token, would sell tickets that do not exist.

## Decision

1. **One setting on the machine.** `payment_providers` (`mock` or `paystack`, a Terraform
   variable in `infra/terraform/vm`) is given to the deploy as `PAYMENT_PROVIDERS`, remembered
   like the others, and reaches the API through the settings, `compose.env` and the compose
   file. With `paystack` the API gets `PAYMENT_PROVIDERS=paystack,mock` and
   `PAYSTACK_CURRENCIES=NGN`: naira goes to Paystack first, and every other currency, and any
   method Paystack does not take in naira (mobile money), stays on the stand-in page, so every
   journey can still be paid.
2. **The key is the owner's, in Secret Manager, and only a test key.** Terraform creates
   `PAYSTACK_SECRET_KEY` empty, readable by the machine alone; nothing generates or prints it.
   The deploy stops when Paystack is chosen and the secret is empty, and says where to paste
   the key. The machine reads it only while Paystack is chosen and refuses a key that does not
   start with `sk_test_`, with the reason in its console: a testing backend never takes real
   money.
3. **The currencies an account settles are a setting.** `PAYSTACK_CURRENCIES` (default: the
   five the adapter takes) limits what the adapter offers; routing sends the rest to the next
   provider in `PAYMENT_PROVIDERS` (ADR-074). Production sets the currencies of its own account.
4. **Duffel runs in the mode of the payments.** The env schema reads the payments' mode: test
   when a listed provider is the mock page or holds a test key (Paystack and Stripe `sk_test_`,
   Stripe `rk_test_`, Flutterwave `FLWSECK_TEST-`), live when one holds any other key. Beside
   test payments Duffel takes only a `duffel_test_` token (ADR-116's rule, widened from the
   mock page to test keys); beside live payments it takes only a live token. A configuration
   with Duffel and payments of both kinds does not start.
5. **Webhooks as in production.** Paystack sends its events to
   `/v1/payments/webhooks/paystack` on the API's address, set as the Test Webhook URL on the
   Paystack dashboard (the deploy prints the address). Each is checked by its signature
   (HMAC-SHA512 of the raw body with the secret key), and each success is verified with Paystack
   before it counts. Without the webhook address a payment is still confirmed, about 15 minutes
   later, when the worker asks Paystack about payments still pending
   (`PAYMENT_RECONCILE_AFTER_MINUTES`).

## Consequences

- With `PAYMENT_PROVIDERS=paystack`, a naira booking on the website or in the app opens
  Paystack's test checkout. Paystack's test card (4084 0840 8408 4081, CVV 408, any future
  expiry) pays it; Paystack signs a `charge.success` webhook, the API verifies the transaction,
  and the booking is paid and fulfilled as usual. The payment appears in Paystack's dashboard in
  test mode. No money moves.
- A combined trip (ADR-099) is one Paystack transaction, as on the stand-in.
- Card, bank transfer and USSD go to Paystack's checkout; Apple Pay only once it is enabled on
  the account. Each test payment confirms one channel name (ADR-074).
- Refunds go to Paystack's test refunds and follow its refund webhooks.
- Moving back is the same deploy with `PAYMENT_PROVIDERS=mock`; the key stays in its secret.
- A live Duffel token can never run on the testing backend: both of its payment modes are test
  modes.
- Production gives `PAYSTACK_CURRENCIES` the currencies its account settles.

## Alternatives considered

- **Paystack alone (`PAYMENT_PROVIDERS=paystack`).** Bookings in other currencies, and methods
  Paystack does not take, could not be paid on the testing backend at all.
- **Paystack's live mode on the testing backend.** Real money for sample products and test
  tickets. The machine refuses it.
- **Refusing only `sk_live_`.** As in ADR-116: accepting only the test prefix is the same rule
  and survives a new prefix.
- **A separate flag for "test payments".** Each key already says which mode its provider runs
  in; a flag could disagree with the key.
