# ADR-074: Payment methods at checkout

- Status: Accepted
- Date: 2026-10-27
- Deciders: owner (methods to offer), Claude Code (design)
- Context: [ADR-016](ADR-016-payment-providers-routing-and-verification.md)

## Context

Travellers choose how to pay (card, bank transfer, USSD, mobile money, Apple Pay or Google Pay),
not which payment company processes it. Checkout today asks for a provider by name when more than
one settles the currency. Each provider's hosted page then shows every method its dashboard
enables, including ones that do not suit the currency. The owner asked for cards and bank
transfer, mobile money, Apple Pay and Google Pay and paying at an agent in Africa, and cards
through Stripe in the US and Europe.

## Decision

1. **A method catalogue.** The methods are:
   - `card`;
   - `bank_transfer`;
   - `ussd`;
   - `mobile_money`;
   - `apple_google_pay` (Apple Pay or Google Pay; named apart from the Suskii wallet balance,
     which `useWallet` spends and payments record as method `wallet`);
   - `agent` (pay at a bank or POS agent).

   `agent` is a bank transfer the traveller makes in cash through a bank teller or a POS agent
   (common in Nigeria). It uses the provider's transfer channel and its own instructions.
   Long-lived dedicated accounts would need each provider's approval, and are an owner
   decision.

2. **Methods per provider and currency.** `PaymentProvider.methodsFor(currency)` replaces the fixed
   list:

   | Provider    | Card | Bank transfer, agent, USSD | Mobile money | Apple / Google Pay |
   | ----------- | ---- | -------------------------- | ------------ | ------------------ |
   | Paystack    | all  | NGN                        | GHS, KES     | NGN (`apple_pay`)  |
   | Flutterwave | all  | NGN                        | GHS, KES     | not per payment    |
   | Stripe      | all  | no                         | no           | all (Checkout)     |

   Flutterwave offers Apple Pay and Google Pay only by currency, with no per-payment value, so
   Stripe carries `apple_google_pay`.

3. **The hosted page shows the chosen method.** Paystack gets `channels` (`card`,
   `bank_transfer`, `ussd`, `mobile_money`, `apple_pay`). Flutterwave gets `payment_options`
   (`card`, `banktransfer`, `ussd`, `mobilemoneyghana`, `mpesa`). Without a method, both show
   their full page as before. Stripe Checkout shows cards and wallets together and sets
   `payment_method_options[card][request_three_d_secure]=automatic`: 3D Secure is requested
   whenever the card's bank or the EU's strong customer authentication rules (PSD2) require it.
4. **Routing by method.** `POST /v1/bookings/{id}/payments` takes an optional `method`. The
   first provider in `PAYMENT_PROVIDERS` order that is not paused and offers the method for the
   booking's currency takes the payment. A named provider must also offer it; otherwise the API
   answers 422 `payment-method-unavailable`. The webhook pipeline is unchanged; the payment's
   `method` still records what the provider says was used.
5. **Options on the wire.** `paymentOptions.methods` lists each available method with the
   providers that offer it, in catalogue order. `paymentOptions.providers` stays for older app
   builds.
6. **Clients choose a method.** The website's checkout and booking page, and the app's
   checkout, list the methods with a hint each (the agent hint explains the account number and
   its expiry) instead of provider names. The first method is chosen until the traveller picks
   another, and the chosen one is sent as `method`. With a single method there is nothing to
   choose: no list is shown and no method is sent, so the provider's page shows everything it
   offers. Payments started elsewhere (the app's trip screen, Suskii Prime) send no method.

## Consequences

- Travellers see only methods that work for their currency, and the hosted page opens on the
  one they chose.
- Choosing by method means the traveller no longer picks between two providers that take the
  same method; the configured order decides, and `PAYMENT_PROVIDERS_PAUSED` still moves traffic
  away from a failing one. Older app builds keep sending `provider`, which still works.
- The mock provider takes every method in every currency, so test stacks (and the hosted test
  server) show the whole list and exercise each choice through the mock payment page.
- Paystack's and Flutterwave's documentation could not be reached from the build container.
  Their channel names come from their guides and the Flutterwave v3 documentation. The first
  sandbox payment per method confirms them; a wrong name shows an empty page for that method
  only.
- Flutterwave applies per-payment options only when "Enable Dashboard Payment Options" is off
  in its dashboard (owner setting).
- Open for the owner: dedicated long-lived transfer accounts for agent payments, and whether
  Apple Pay on Paystack is enabled on the account.
