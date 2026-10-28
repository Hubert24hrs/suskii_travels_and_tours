# ADR-078: Company accounts

- Status: Accepted
- Date: 2026-10-28
- Deciders: Claude Code (implementer), pending owner review

## Context

Item 7 of the standards plan: companies book travel for their staff, with rules and one report.
Booking.com for Business, TravelPerk and Wakanow Business share a common core: a company with
members in a few roles, a travel policy, approval of trips outside it, and spend reporting.
Prepaid company funds and invoiced credit are the next layer in all of them.

## Decision

1. **A company and its members.** `companies` (name, country, optional registration number and
   tax id, billing email, `active` or `suspended`). `company_members` link users with one role
   each: `admin` (members, policy, everything), `approver` (approves trips, sees the report),
   `booker` (books for any member) and `traveller` (books for themself). A person belongs to at
   most one company (a unique key on active memberships); it keeps every check a single lookup.
   The creator becomes the first admin; the last admin cannot leave or be demoted.
2. **Invitations.** An admin invites an email with a role. The token is random, stored as an
   HMAC (`company-invitation` purpose), single-use, valid 7 days, and sent by email. Accepting
   needs a signed-in account whose verified email equals the invited one, so a forwarded link
   cannot add someone else.
3. **The travel policy** is one row per company: a hotel nightly cap (minor units and currency),
   the highest flight cabin, a minimum days in advance, and an approval mode (`never`,
   `out_of_policy`, `always`). Fields left empty do not apply.
4. **Booking for the company.** A member books with `company: true`. The server evaluates the
   policy from the quote (cabin of each slice, nightly price converted to the cap's currency with
   the FX snapshot the pricer uses, days before the first travel date) and stores the findings on
   the booking (`policy_findings`) with `company_id` and `booked_by_id`. Bookers may book for any
   member; travellers only for themselves (the lead passenger is not checked against the member:
   companies book guests and family too, and the report shows who booked).
5. **Approval before payment.** When the mode asks for it, the booking is created with
   `approval_status = pending`; starting a payment (card, transfer or wallet) answers 409
   `approval-required` until an approver approves. Rejecting cancels the booking through the state
   machine. The booking's normal payment deadline still applies, so an unanswered request
   expires like any unpaid booking. Decisions are audited and the booker is notified.
6. **Reports** read company bookings only: a list (traveller, booker, product, dates, status,
   total), spend per month and per traveller in each currency, and a CSV export. Amounts stay in
   minor units with their currency; no conversion is invented across currencies.
7. **Privacy and access.** Company routes always resolve the caller's own membership and answer
   404 for anything outside it (as bookings do). Admins see members' names and emails; approvers
   and bookers see names only. Removing a member keeps company bookings with the company. The
   data registry treats companies as reference data of the organisation, memberships as account
   data (deleted with the account; the last admin of a company with members must hand over
   first), and invitations with a retention rule (30 days after expiry).
8. **Console.** Staff with `users:read` see companies; `users:manage` suspends and reinstates
   (a suspended company cannot book for the company; members keep their own accounts).

## Not now

- **Company wallet** (prepaid funds a company tops up and spends) needs a new payment purpose in
  the webhook pipeline and its own ledger account (`company-wallet:{companyId}:{CUR}`); it fits
  ADR-017 and is the next step.
- **Invoiced credit** (pay monthly) needs credit limits and collections the owner has not
  decided.
- **Negotiated rates and a corporate fee** need commercial terms; the pricing engine can target
  them later through a company audience on markup and fee rules.

## Consequences

- Companies can be offered today without new money flows: payment, refunds and receipts are the
  ones every booking uses.
- Two new booking columns are read by payment and reports only; nothing else changes for
  personal bookings.
