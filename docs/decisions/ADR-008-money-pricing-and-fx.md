# ADR-008: Money, pricing rules and exchange rates

- Status: Accepted (FX source pending owner decision)
- Date: 2026-09-29
- Deciders: Claude Code (implementer), pending owner review

## Context

The spec requires money as integer minor units with an ISO 4217 code (never floats), a pricing
module (markups by vertical, route, airline, channel and user tier; fees; promo codes with caps,
validity, usage limits and eligible verticals), conversion through an `FxProvider` cached in Redis
with a timestamp, a single settled currency per booking, property-based tests for money, and 80%
coverage on pricing and money.

## Decisions

### Money representation

- In code: `Money = { minor: bigint, currency }` (`@suskii/shared`), shared by API, web and mobile.
  bigint makes overflow and float drift impossible; every operation that can create a fraction
  takes an explicit rounding mode (`half-even`, `half-up`, `ceil`, `floor`).
- On the wire: `{ amountMinor: number, currency }`. Amounts are checked to be safe integers when
  serialised (9 x 10^15 minor units, far above any booking). Clients format with `formatMoney`, which
  passes an exact decimal string to `Intl.NumberFormat`.
- ISO 4217 exponents (JPY 0, KWD 3, most 2) come from a table, not from `Intl`, whose display
  digits differ for some currencies.
- Splits (per passenger, instalments later) use largest-remainder allocation, so parts always sum
  to the total and each is within one minor unit of its exact share.
- Exchange rates are exact rationals parsed from decimal strings; cross rates go through the
  provider's base currency; conversion rounds once, at the end.

Property tests (fast-check) cover rounding against exact rational references, allocation
invariants, conversion to the nearest representable amount across exponents, monotonicity,
parse/format round trips and the wire format. The pricing engine has its own property test:
totals always add up, discounts never touch taxes, nothing goes negative, markup caps hold.

### Pricing pipeline

1. **Markup** (hidden margin): the first active matching `MarkupRule` by priority, never stacked.
   Percentage of the supplier base fare or a fixed amount (any currency), clamped to min/max caps.
   Negative markups are allowed (channel discounts) but the fare never goes below zero.
2. **Conversion**: fare (base + markup) and taxes are converted line by line into the display
   currency with one FX snapshot, `half-up`.
3. **Fees** (visible): every matching `FeeRule`, per booking or per passenger (seat-occupying
   travellers for flights, guests for hotels), percentage or fixed, with caps.
4. **Promo**: percentage or fixed off fare + fees, never taxes (government levies), capped by the
   code's maximum and by fare + fees. Eligibility: active, validity window, verticals, account
   required, minimum spend, global and per-user redemption limits.
5. **Total** = fare + taxes + fees - discount, exact by construction. The response shows fare,
   taxes, fees, discount, total and the FX rate used; markup and supplier cost stay internal.

Rules are cached per process for 60 seconds (admin edits apply within a minute; the admin console
will call `invalidate()`). No markup, fee or promo is seeded: they are business decisions made in
the admin console (phase 10).

Promo validation (`POST /v1/pricing/promos/validate`) answers one generic 422 for every failure,
so codes cannot be enumerated, and has strict per-IP and per-user rate limits. Redemptions are
recorded at payment (phase 6).

### Exchange rates

- `FxProvider` interface; a `MockFxProvider` with clearly labelled illustrative rates is the only
  adapter. Production refuses to start with it unless `ALLOW_MOCK_PROVIDERS=true` (staging).
- `FxService`: process memory (1 minute), Redis (`FX_CACHE_TTL_SECONDS`, shared by instances) and a
  last-known-good copy used for up to 24 hours when the provider fails; after that, prices in the
  affected currency answer 503 rather than guess.
- **Owner decision needed**: which source to use for the naira (official CBN rate, a market rate,
  or the payment provider's settlement rate) and whether to add an FX margin. The right adapter
  then implements `FxProvider`; nothing else changes.

### Channel and tier

`X-Suskii-Client: web/<version>` or `mobile-<platform>/<version>` sets the sales channel for
channel-specific rules. It is not a security control: spoofing it only reveals another channel's
price. User tier is `guest` or `member` from authentication; `prime` arrives with Suskii Prime
(phase 9).

## Consequences

- Prices are reproducible: the same rules, FX snapshot and supplier price always give the same
  breakdown, which is what bookings will store.
- A settled booking currency (phase 5/6) is simply the display currency at quote time; the quote
  stores both the supplier total and the customer breakdown.
