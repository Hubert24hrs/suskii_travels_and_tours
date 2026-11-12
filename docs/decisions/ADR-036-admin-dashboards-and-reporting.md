# ADR-036: Admin dashboards and reporting

- Status: Accepted
- Date: 2026-10-06
- Deciders: Claude Code (implementer), pending owner review

## Context

The spec lists dashboards for the admin console without defining metrics. Money figures must be
right by construction (ADR-017: the ledger is the source of truth) and must not mix currencies.

## Decisions

1. **One read-only route.** `GET /v1/admin/dashboard?from&to` (`reports:read`), defaulting to the
   last 30 days, at most 366 days.
2. **Metrics.**
   - Bookings created in the period, by status and by vertical.
   - Money taken (captured payments, wallet payments) and money refunded, per currency, summed
     from ledger entries on the customer-funds accounts in the period. Never converted to one
     currency.
   - Work queues now: refunds waiting for approval, refunds needing review, bookings in
     `REFUND_PENDING`, visa applications submitted or in review, referrals in review.
   - Accounts created in the period and active Suskii Prime members now.
   - The ten most booked flight routes in the period.
3. **No personal data.** The dashboard returns counts and sums only.
4. **Performance.** Queries use existing indexes and run in parallel; if they get slow, a daily
   rollup table is the next step (phase 11).

## Consequences

- Finance and operations get a first view without a BI tool; deeper reporting can read the same
  ledger later.
