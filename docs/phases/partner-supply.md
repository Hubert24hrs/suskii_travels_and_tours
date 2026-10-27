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

Filled in when the work merges.
