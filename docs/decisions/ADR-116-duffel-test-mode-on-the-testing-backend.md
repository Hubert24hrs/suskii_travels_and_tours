# ADR-116: Duffel's test mode on the testing backend, and no live token beside the mock payment page

- Status: Accepted
- Date: 2026-11-13
- Deciders: the owner (asked for real flights on the testing backend, with payments left for
  last), Claude Code (implementer)
- Amends: ADR-111 (the backend on one machine)

## Context

Everything a traveller searches on the testing backend comes from the stand-ins: the mock
flight and hotel suppliers invent their offers, and the mock payment page completes every
payment through the signed webhook (ADR-014). The owner wants the testing backend to show real
flight content, for demonstrations and to prove the Duffel connection before launch, while
payments stay on the stand-in until the end.

The Duffel adapter is built and checked against Duffel's test mode (ADR-062, ADR-063): the
sandbox workflow searches, quotes and books with a test token, which is held as a repository
secret. The machine's compose file fixed `FLIGHT_SUPPLIERS` and `HOTEL_SUPPLIERS` to `mock`,
and the machine had no place for Duffel's token.

One combination is dangerous. With a **live** Duffel token beside the mock payment page, a
traveller would "pay" on the stand-in and ticketing would then book a real order against the
company's Duffel balance: real tickets that nobody paid for.

## Decision

1. **Two settings on the machine.** `flight_suppliers` and `hotel_suppliers` (`mock` or
   `duffel`, Terraform variables in `infra/terraform/vm`) are given to the deploy as
   `FLIGHT_SUPPLIERS` and `HOTEL_SUPPLIERS`, remembered like the others, and reach the API
   through the settings, `compose.env` and the compose file. Both start at `mock`. Hotels are
   separate because Duffel switches Stays on per account.
2. **The token is the owner's, in Secret Manager.** Terraform creates the secret
   `DUFFEL_API_TOKEN` empty, readable by the machine alone. Nothing generates or prints it. The
   deploy stops before it builds anything when Duffel is chosen and the secret is empty, and
   says where to paste the token. The machine reads it into the API's keys only while flights
   or hotels come from Duffel.
3. **Only a test token beside the mock payment page.** The API refuses to start when Duffel is
   a supplier, `PAYMENT_PROVIDERS` includes `mock` and the token does not start with
   `duffel_test_` (the env schema), in every deployment shape. The machine refuses such a token
   before the API sees it, with the reason in its console. A live token belongs only where
   payments are real, which is how production runs.

## Consequences

- With `FLIGHT_SUPPLIERS=duffel`, searches on the testing backend go to Duffel's test mode.
  Test mode carries test copies of real airlines' offers on busy routes (London to New York
  answered with Lufthansa, British Airways, American Airlines, Iberia and Duffel Airways) and
  Duffel's own test airline, Duffel Airways (ZZ), almost everywhere; routes from Lagos may show
  only Duffel Airways. Duffel Airways is the most predictable fare to book.
- A booking pays on the stand-in page; ticketing then books a Duffel test order, which costs
  nothing. Use made-up traveller details: they go to Duffel's test environment.
- Searches take as long as Duffel does (seconds, not milliseconds), and the worker's deal
  refresh asks Duffel for each deal route every three hours.
- What the adapter withholds until its own sandbox checks pass stays withheld: seats
  (`DUFFEL_SEAT_SELECTION`, ADR-094) and meal requests (ADR-093).
- Moving back is the same deploy with `FLIGHT_SUPPLIERS=mock`; the token stays in its secret.

## Alternatives considered

- **Both suppliers at once (`mock,duffel`).** Invented and real offers side by side would
  confuse a demonstration and the tests a person makes. The API takes it; the machine's setting
  does not offer it.
- **Checking only the prefix `duffel_live_`.** The repository's other test-mode paths (the
  sandbox workflow, the e2e stack) accept only `duffel_test_`; refusing everything else is the
  same rule and survives a new prefix.
- **A live token on the testing backend with real payments.** That is a production rehearsal,
  not a testing backend, and comes with the payment providers (`docs/owner/launch-checklist.md`).
