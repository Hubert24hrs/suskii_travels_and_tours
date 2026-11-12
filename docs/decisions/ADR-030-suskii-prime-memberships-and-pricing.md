# ADR-030: Suskii Prime memberships and member pricing

- Status: Accepted
- Date: 2026-10-05
- Deciders: Claude Code (implementer), pending owner review

## Context

Suskii Prime is the paid membership (spec homepage: "member-only fares, fee waivers, priority
support", "price per month/year from CMS"). Its price and exact benefits are an open owner
question. The pricing engine already matches markup and fee rules on a `userTier` of `guest`,
`member` or `prime` (ADR-008), but nothing assigns `prime`. Payments, refunds and the ledger only
know bookings.

## Decisions

1. **Plans are data.** `prime_plans`: slug, name, period (`month` or `year`), prices per currency
   (minor units), benefits (`markupShareBps`, `waivedFeeCodes`, `prioritySupport`), status
   (draft, published, archived) and a `sample` flag. Managed through admin routes
   (`pricing:manage`, audited). None are seeded in production; `db:seed:demo` adds a sample plan.
2. **Buying uses the booking pipeline.** A membership purchase is a booking of a new `prime`
   vertical with a `membership` item (one "traveller": the account holder, no passport). Quotes,
   hosted checkout, signed webhooks, the ledger, refunds and receipts are reused unchanged.
   Fulfilment in the confirming transaction creates the membership or, for a member, extends it
   from the current end date. Guests cannot buy (an account is required).
3. **Who is a member.** `prime_memberships`: user, plan, status, `startsAt`, `endsAt`. A user is
   `prime` while a membership is active and not past `endsAt`. The tier is put in the access
   token at issue (login, refresh, MFA), so searches price members without a database read; a
   client refreshes its session after buying. Quotes and bookings re-read the tier from the
   database, so a membership that ended minutes ago never prices a booking, and the price re-check
   before payment catches any difference (existing consent flow).
4. **Benefits in the engine.** After the markup and fees are found:
   - `markupShareBps` gives back that share of the markup as a lower fare (rounded down in the
     member's favour only to whole minor units of the markup share), so a member price is never
     below supplier cost plus taxes;
   - fees whose code is in `waivedFeeCodes` are dropped;
   - markup and fee rules may target `userTier = prime` directly (member-only fares).
     The breakdown records the saving as `memberSaving` for display ("You save ₦X with Prime"); the
     markup itself stays internal. Promo codes apply after member pricing.
5. **No automatic renewal yet.** Charging stored cards needs a mandate decision (ADR-018).
   Members get reminders before expiry (email and push, per their preferences) and buy again;
   buying while active extends from the current end.
6. **Cancellation and refunds** of a membership go through staff refunds (maker-checker); there is
   no self-service cancellation until the owner sets a cooling-off policy.

## Consequences

- Prime works with zero plans (the Prime pages show "coming soon") and goes live by publishing a
  plan, with no deploy.
- Member savings are visible to members and testable; the markup and supplier cost still never
  leave the API.
- A new vertical touches every exhaustive switch on verticals (emails, documents, summaries);
  the compiler finds them.

## Implementation notes (phase 9)

- A membership is the in-house item kind `membership` (vertical `prime`, supplier `suskii`):
  quoted with `createInhouseQuote` (`kind: "membership"`, signed-in only), booked with one
  `guests` entry (the member's name, no passport) and paid like any booking. The quote belongs to
  the account that asked for it. Holds and installments are not offered, nothing is
  self-cancellable, and no PDF is generated (the confirmation email is the receipt). Prime
  purchases are left out of the Trips list and shown by `GET /v1/me/prime`.
- `InhouseFulfilment` creates the term in the confirming transaction with the user row locked; a
  member buying again gets a term starting at the end of the last one. The term snapshots the
  plan's benefits; plan edits apply to new purchases and to the price re-check before payment.
- Access tokens carry `prm` (paid-up end and benefits) from `currentPrime()` at issue and refresh.
  `clientContext()` gives tier `prime` while that end is in the future. `withCurrentTier()` re-reads
  the database for `GET /v1/quotes/{id}`, booking creation and the payment re-check.
- `priceOffer()` prices twice for members: once with benefits, once as a signed-in non-member.
  `memberSaving` is the difference before promo, so Prime-only markup or fee rules count as
  savings too. The breakdown's internal `markup` is the margin actually kept. Public plan and
  booking views and the data export show `memberFares` (share above zero) instead of the share
  itself (`benefitsView()`).
- Staff manage plans at `/v1/admin/prime/plans` (`pricing:manage`, audited). `db:seed:demo` adds a
  published sample plan (NGN 25,000 or USD 25 a year, half the markup back, `service_fee`
  waived). Its amounts are placeholders until the owner decides them.
