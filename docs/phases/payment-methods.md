# Payment methods at checkout

Item 3 of the standards plan agreed with the owner on 2026-10-27. Decision record:
[ADR-074](../decisions/ADR-074-payment-methods-at-checkout.md).

## Owner's answers this work follows

- African payment methods: cards and bank transfer, mobile money, Apple Pay and Google Pay, and
  paying at an agent.
- US and European travellers: cards through Stripe.

## Where the platform stands

- Three hosted-checkout providers (Paystack, Flutterwave, Stripe), routed by currency in
  `PAYMENT_PROVIDERS` order (ADR-016). Card data never reaches Suskii (SAQ-A).
- Checkout asks the traveller to choose a provider by name when more than one settles the
  currency, and each provider's page then offers whatever its dashboard enables.
- Each provider declares one fixed list of methods, whatever the currency.

## Plan

| Step | Work                                                                                                                                                                                                                         | Files                                                     |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 1    | Method catalogue: card, bank transfer, USSD, mobile money, Apple Pay or Google Pay (`apple_google_pay`), at a bank or POS agent (`agent`)                                                                                    | `src/payments/payment-provider.ts`, `bookings.schemas.ts` |
| 2    | Providers say which methods they offer per currency (`methodsFor`) and narrow their hosted page to the chosen one (Paystack `channels`, Flutterwave `payment_options`); Stripe asks for 3D Secure where the bank requires it | the three adapters and the mock, unit tests               |
| 3    | Routing by method: the first provider in configured order that offers the method for the currency; 422 `payment-method-unavailable` otherwise                                                                                | `payment-providers.ts`, `checkout.service.ts`             |
| 4    | `paymentOptions.methods` on quotes and bookings; `method` on the payment request; audit metadata                                                                                                                             | `bookings.schemas.ts`, payment options                    |
| 5    | Website and app: choose a method (with a hint for agent payments) instead of a provider                                                                                                                                      | `apps/web`, `apps/mobile`, `@suskii/i18n`                 |
| 6    | Tests: unit (routing, adapter request bodies), API e2e (options, method routing, unavailable method), web e2e, app Jest                                                                                                      | tests                                                     |
| 7    | Docs: ADR-074, CLAUDE.md, CHANGELOG                                                                                                                                                                                          | `docs/`                                                   |

## Risks

- **Provider names.** Paystack's and Flutterwave's documentation hosts cannot be reached from
  the build container. Channel names come from their published guides and the Flutterwave v3
  documentation. A wrong name would make the hosted page show nothing for that method, so the
  first sandbox payment per method must confirm them (listed in ADR-074).
- **Dashboard settings win on Flutterwave.** Per-payment options apply only when "Enable
  Dashboard Payment Options" is off in the Flutterwave dashboard (an owner setting).
- **Mobile contract.** `paymentOptions.methods` and `method` are additive. Older app builds keep
  choosing a provider, which still works.

## Outcome

All seven steps are built.

- API: the method catalogue, `methodsFor(currency)` on every adapter, routing by method with 422
  `payment-method-unavailable`, `paymentOptions.methods` on quotes and bookings, and `method` in
  the `payment.created` audit metadata. Paystack gets `channels`, Flutterwave `payment_options`,
  and Stripe Checkout requests 3D Secure automatically. Unit tests cover routing and each
  adapter's request body. The payments e2e suite follows a booking through the options list, a
  Paystack payment opened on USSD and on an agent transfer, a payment with no method (every
  channel, as before), a method routed to the first provider that takes it, a provider that does
  not take the method (422) and an unknown method (400).
- Website: checkout and the booking page list the methods with a hint each and send the chosen
  one (a Playwright journey with axe chooses an agent payment and pays).
- App: checkout lists the methods with the same hints, sends the chosen one and falls back to the
  first when the API refuses it (Jest).
- The method for Apple Pay and Google Pay is `apple_google_pay`, so it is never confused with the
  Suskii wallet balance (`useWallet`, recorded as method `wallet`).

Waiting on the owner:

- the first sandbox payment per method with Paystack and Flutterwave test keys, to confirm the
  channel names;
- whether Apple Pay is enabled on the Paystack account;
- Flutterwave's "Enable Dashboard Payment Options" setting turned off;
- whether to apply for long-lived transfer accounts for agent payments.
