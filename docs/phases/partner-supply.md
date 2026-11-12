# Partner supply (outside the numbered phases)

Owner brief (2026-10-27): build the backend that gets prices for every product from partner APIs,
affiliate programmes and partnerships, like Wakanow or Booking.com; no driver KYC, no vetting of
third parties. Research: [docs/research/partner-supply.md](../research/partner-supply.md).
Decisions: ADR-069 (model), ADR-070 (tracking), ADR-071 (Hotelbeds).

## Plan

| Step | What                                  | Files                                                                                                                                             |
| ---- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Research and decisions                | `docs/research/partner-supply.md`, ADR-069 to ADR-071, this plan                                                                                  |
| 2    | Hotelbeds hotel supplier              | `apps/api/src/suppliers/hotelbeds/*`, `suppliers.module.ts`, `config/env.schema.ts`                                                               |
| 3    | Best price across hotel suppliers     | `apps/api/src/search/results.ts`, `hotel-search.service.ts`                                                                                       |
| 4    | Affiliate tracking and partner offers | `apps/api/src/partners/*`, Prisma models `PartnerClick` and `PartnerConversion` and a migration, privacy registry, retention, export and deletion |
| 5    | Settings, contracts and docs          | `.env.example`, Terraform and Helm examples, `openapi.json`, api-client, security docs, CHANGELOG, CLAUDE.md                                      |

## Risks

- **Unverified vendor shapes.** Documentation hosts do not resolve here; shapes come from search
  results and typed npm packages. Parsers are tolerant (unknown fields ignored, missing ones
  mapped to errors, never crashes) and each ADR lists what the first sandbox run must confirm.
- **Hotelbeds has no idempotency key.** Booking is marked non-idempotent, so ambiguous failures
  go to review (ADR-014).
- **Duplicate hotels across suppliers.** Merging by normalised name and distance can miss or
  over-merge; the 250 m radius and name rule are conservative, and only cross-supplier pairs merge.
- **Open redirects.** The redirect only follows sealed tokens and only to the programme's hosts.
- **Postback abuse.** A shared secret compared in constant time, rate limits, and strict parsing
  of ids, amounts and currencies.

## Outcome

Built and verified locally on 2026-10-27; each partner waits for the owner's account.

| Step | Result                                                                                                                                                     |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Research and ADR-069 to ADR-071 written                                                                                                                    |
| 2    | `HotelbedsHotelSupplier` with signed client, schemas and unit tests; settings and production rules                                                         |
| 3    | `mergeDuplicateHotels` keeps the cheaper copy of a hotel two suppliers return; unit tests                                                                  |
| 4    | `src/partners`: catalogue, sealed links, redirect with clicks, Travelpayouts and Viator adapters (and mocks), postbacks, admin summary; migration; privacy |
| 5    | Settings in `.env.example`, Terraform and Helm examples; OpenAPI and client regenerated; security docs, store forms, CHANGELOG and CLAUDE.md updated       |

Tests: partner unit tests (programmes, sealed links, linkers, Viator mapping, postback parsing),
`test/partners.e2e-spec.ts` (offers, redirect, cross-sell ownership, postbacks, summary,
deletion, flags off), and the retention, accounts, admin matrix, admin audit, platform and
metrics suites pass against Postgres 16 and Redis 7.

**Waiting for the owner** (no sandbox could be reached from here; nothing called a real
provider):

- Hotelbeds evaluation key: run a search, rate check and booking on `api.test.hotelbeds.com`
  and confirm the response shapes in ADR-071, then certification and the live key.
- Viator Basic Access key: confirm the freetext search answer for a Nigerian city.
- Travelpayouts: connect the seven brands, set the token, marker and project id, confirm the
  Partner Links answer (`partner_url`) and set the postback URL with its macros (ADR-070).

Each of these is one run once the keys exist: add them as repository secrets
(`HOTELBEDS_API_KEY` and `HOTELBEDS_API_SECRET`; `VIATOR_API_KEY`; `TRAVELPAYOUTS_TOKEN` and
`TRAVELPAYOUTS_MARKER`, with `VIATOR_CAMPAIGN` and `TRAVELPAYOUTS_TRS` as variables), then run
Actions, Partner sandbox check (`partner-sandbox.yml`, script `sandbox:partners`). It calls each
partner through our adapters and prints real hotels with their cheapest stays and a rate check,
tours with prices, and which programmes got a tracked link. It books nothing, and a partner
without keys is named and skipped.

**Flights with real prices today (2026-10-27, `aac132e`):** the Duffel sandbox workflow found 56
offers from London to New York, and our API booked one from search to a confirmed Duffel order
with an airline reference and e-ticket, cancelled one with a refund, sold a checked bag and booked
two seats from one shared search. Duffel Stays answered 403: Stays is not enabled on the account.

**Partner offers in the clients (2026-10-27):** the website's booking page and `/cars` hub, and the
app's trip screen and Cars screen, show partner offers with the commission disclosure and open
them through the tracked link.

**Follow-ups:** import Viator's campaign report as conversions, a console page for the partner
summary, and RateHawk or Hotelbeds transfers and activities as merchant supply when the accounts
exist.
