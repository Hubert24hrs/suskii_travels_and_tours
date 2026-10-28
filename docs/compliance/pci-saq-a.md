# PCI DSS: staying eligible for SAQ A

Suskii never sees card numbers. Every card payment happens on a payment provider's hosted page
(Paystack, Flutterwave, Stripe Checkout), reached by a redirect from the website or opened in the
system browser by the app (ADR-016, ADR-021, ADR-074). That makes Suskii a card-not-present
merchant that has fully outsourced account data, the case Self-Assessment Questionnaire A covers
(PCI DSS v4.0.1). This page records how each eligibility criterion is met and what the owner must
file. It is not a substitute for the SAQ form the acquirer issues; answer that form from this page
and check every answer with the acquirer or a QSA.

## Eligibility criteria

| Criterion                                                                                       | How Suskii meets it                                                                                                                                                                                                                                                                                                                               | Evidence                                                                                       |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Card-not-present (e-commerce or mail/telephone order) only                                      | Bookings are made online; cash at an agent (ADR-074) is not a card payment. Staff must never take card details by phone, chat or WhatsApp; the console has no field for them.                                                                                                                                                                     | ADR-074; console                                                                               |
| All processing of account data is outsourced to PCI DSS compliant third-party service providers | Paystack, Flutterwave and Stripe host the payment page and process the card. Each provider's Attestation of Compliance is collected every year (owner action below).                                                                                                                                                                              | `apps/api/src/payments/*`; provider AOCs                                                       |
| No electronic storage, processing or transmission of account data on Suskii systems             | The API receives references, amounts and statuses only; provider payloads are parsed inside the adapters and card fields never reach the domain (`PaymentProvider`). Logs redact payment fields (`SENSITIVE_LOG_FIELDS`).                                                                                                                         | `docs/security/data-classification.md`; `log-redaction.ts`                                     |
| Every element of the payment page comes from the provider                                       | Redirect (website) or system browser session (app, never a WebView). No iframe or field of the provider is embedded in a Suskii page.                                                                                                                                                                                                             | `checkout.tsx`, `booking-view.tsx`; `openHostedCheckout()`                                     |
| The site is not susceptible to attacks from scripts that could affect the e-commerce system     | Pages that start a payment (`/checkout/*`, `/bookings/*`) run only Suskii's own scripts and Cloudflare Turnstile: their policy has no `strict-dynamic` and no other script origin, ad tags never start there, and a document that already ran ad tags reloads clean before checkout (ADR-089). Every other page uses the nonce policy of ADR-010. | `apps/web/lib/payment-pages.ts`, `lib/csp.ts`, `e2e/ads.spec.ts` (script inventory and policy) |
| Paper records with account data are not kept, or are kept securely                              | None are created.                                                                                                                                                                                                                                                                                                                                 | -                                                                                              |

The January 2025 revision of SAQ A dropped requirements 6.4.3 (payment page script inventory)
and 11.6.1 (payment page tamper detection) and added the script-attack criterion above. Suskii
meets the criterion with controls equivalent to 6.4.3: the scripts allowed on payment pages are
listed (`script-src 'self'`, the per-request nonce and Turnstile), each has a reason (the
website's own bundle; bot protection on guest checkout), and the browser enforces the list. The
web e2e suite fails if any other script appears on checkout or the booking page.

## Pages that start a payment

| Page                     | Why                                                                | Scripts allowed                    |
| ------------------------ | ------------------------------------------------------------------ | ---------------------------------- |
| `/checkout/{quoteId}`    | Creates the booking and redirects to the provider's hosted page    | Suskii bundle (nonce, same origin) |
| `/checkout/mock-payment` | The mock provider's page (development and test stacks only)        | Suskii bundle                      |
| `/bookings/{bookingId}`  | Pays a balance, an installment or an expired hold; resumes payment | Suskii bundle                      |
| Guest checkout           | Turnstile challenge before the booking is created                  | Suskii bundle and Turnstile        |

A new page that starts a payment must match `isPaymentPage()` (`apps/web/lib/payment-pages.ts`)
and appear in this table. The app has no payment page of its own: it opens the provider's page in
the system browser.

## What the owner files

- **The SAQ A and its Attestation of Compliance** every year, with the acquirer or each payment
  provider's merchant programme.
- **Each provider's Attestation of Compliance** (Paystack, Flutterwave, Stripe) every year, and a
  written agreement that the provider is responsible for the security of the card data it
  handles (requirement 12.8).
- **External vulnerability scans** by an Approved Scanning Vendor if the acquirer asks for them for
  the website's hosts.
- **An incident response plan** that covers a suspected compromise of the payment hand-off: the
  [personal data breach runbook](../runbooks/personal-data-breach.md) and
  [key rotation](../runbooks/key-rotation.md).

## Changes that would end SAQ A eligibility

- Embedding a provider's card fields or iframe in a Suskii page (SAQ A then needs the iframe
  criteria; any field Suskii renders itself means SAQ A-EP).
- Taking card details by phone, chat, WhatsApp or email, even to "help" a traveller.
- Any third-party script on a payment page beyond Turnstile, including analytics and chat widgets.
- Storing a provider's raw payload with card fields, or logging it.
