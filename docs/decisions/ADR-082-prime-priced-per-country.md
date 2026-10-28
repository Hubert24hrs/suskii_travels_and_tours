# ADR-082: Suskii Prime priced per country

- Status: Accepted
- Date: 2026-10-28
- Deciders: Claude Code (implementer), pending owner review

## Context

The owner asked for Suskii Prime "yearly, priced per country" (standards plan item 8). A Prime
plan stores one price per currency (ADR-030). Members in different countries who pay in the same
currency (US dollars in Ghana and Kenya, euros across Europe) cannot be charged different amounts,
and a lower introductory price in one market is impossible without a second plan.

The edge (Cloudflare) reports the visitor's country on every request; the API reads it through
`CLIENT_COUNTRY_HEADER` into `requestContext().country` (payment risk already uses it, ADR-040).

## Decision

1. **Price entries may name a country.** A plan's `prices` is a list of
   `{ amountMinor, currency, country }`, where `country` is an ISO 3166-1 alpha-2 code or null.
   There is at most one entry per currency and country. Existing entries have no country and keep
   working unchanged; no migration is needed (the column is JSON, validated on read).
2. **Resolution.** `resolvePlanPrice(prices, currency, country)` returns the entry for that
   currency and country, else the currency's entry without a country, else nothing (the plan is
   not sold in that currency there). The same function serves the API and the console preview.
3. **Which country.** The API uses the edge's country of the request (`requestContext().country`),
   never a value from the client body. Without `CLIENT_COUNTRY_HEADER`, every request resolves to
   the currency's entry, as today.
4. **Quotes keep their entry.** The membership payload records the country it was priced for.
   The re-check before payment resolves with that recorded country, so a traveller who quoted in
   Ghana pays the Ghana price even if the payment request arrives through another edge location.
   A removed or changed entry follows the usual re-check: the new price needs the traveller's
   consent.
5. **Website.** The Prime page renders on the website's server, whose API call carries no visitor
   country. The page reads the visitor's edge country from its own request (the same header name)
   and passes `country` with the plans request. That parameter changes only the displayed price;
   the quote, made from the visitor's browser through the edge, decides what is charged.
6. **App.** The app calls the API through the edge, so its prices resolve without any change.
7. **Console.** Price lines accept an optional country (`USD 20 GH`); the plans table marks
   country prices.

## Consequences

- The owner can set a price per market (for example NGN in Nigeria; USD with a Ghana price and a
  Kenya price; a default USD price elsewhere).
- Anyone can see every country's price by changing the display parameter; prices are not secret,
  and what is charged always follows the edge.
- A traveller using a VPN is priced for the VPN's country; this is the usual trade-off of
  edge-based pricing and is not treated as fraud.

## Alternatives considered

- **One plan per country.** Works today but multiplies plans, memberships reports and benefits to
  keep in step; a single plan with country prices keeps the member experience the same.
- **The billing country of the payment card.** Known only after payment; the price must be known
  at the quote.
- **A client-supplied country.** Trivially changed; the edge's country is the only server-side
  signal before payment.
