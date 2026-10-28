# ADR-090: Company wallet

- Status: Accepted
- Date: 2026-10-28
- Deciders: Claude Code (implementer), pending owner review

## Context

Company accounts (ADR-078) let members book under a travel policy, but each trip is still paid
by the booker's own card or transfer. Business travel buyers expect a company balance: finance
adds funds once, travellers never use a personal card, and every trip draws from one statement
(Booking.com for Business, TravelPerk and Wakanow Business all offer one). For Suskii it means
money received before travel and fewer abandoned company checkouts.

The platform already has the pieces: a double-entry ledger with per-user wallets that pay a
booking in one transaction (ADR-017), hosted checkout with verified webhooks and reconciliation
(ADR-016), and refunds that go back where the money came from (ADR-019). What it lacked was a
payment that is not tied to a booking.

## Decision

1. **One ledger account per company and currency:** `company-wallet:{companyId}:{CUR}`, a
   liability that may never go negative (the database refuses it). Money enters only through a
   captured top-up or a refund of a trip it paid; it leaves only by paying a company trip. There
   is no transfer between companies and no withdrawal to another account.
2. **Top-ups are their own records** (`company_wallet_top_ups`), not `payments` rows: a payment
   belongs to a booking, and a top-up does not. Admins of an active company start one (role
   check from `@suskii/shared`), with `Idempotency-Key`, within per-currency limits
   (`COMPANY_WALLET_TOPUP_LIMITS`, default NGN 10,000 to 5,000,000 and USD 10 to 5,000) and a
   daily count per company (`COMPANY_WALLET_TOPUPS_PER_DAY`, default 5). The provider is chosen
   as for bookings (`PaymentProviders.choose`), and its page names the top-up (`W-` reference),
   not a booking.
3. **Credited only by the provider.** The webhook pipeline (`PaymentEventsService`) looks a
   reference up as a booking payment first and then as a top-up (`CompanyTopUps`), so signature
   checks, server-side verification, event dedupe and reconciliation (`reconcile:{ref}:{status}`)
   stay in one place. The capture posts `psp → company-wallet` once (`company-topup:{id}:captured`).
   A provider that charged a different amount or currency is credited what it charged and the
   difference is audited: a top-up is the company's own money, so refunding it would only make
   the admin pay again.
4. **Paying a trip.** `useCompanyWallet` at payment start pays the whole amount in one
   transaction, only for the booking's owner (the booker) while they are a member of that active
   company, only for a trip that needs no approval or was approved, and never with a payment plan
   (as the personal wallet). Payment kind and provider `company_wallet`; ledger kind
   `company_wallet_payment`; audit `company_wallet.paid`. A balance spent by another payment in
   the meantime makes the ledger refuse the posting, which answers 409
   `company-wallet-insufficient`, never a negative balance. The booking's payment options carry
   `companyWallet: { covers }` and never the balance, which only admins and approvers see.
5. **Refunds go back to the wallet.** A refund of a trip paid from it has destination
   `company_wallet` (ledger kind `refund_to_company_wallet`), automatic or staff-made alike; staff
   cannot send it elsewhere from the console.
6. **The ledger reconciliation checks top-ups** as it checks payments: each succeeded top-up
   against its capture posting and the provider's own record, and every capture posting against
   a succeeded top-up (`company_topup` discrepancies). It never corrects anything.
7. **Who sees what.** Admins and approvers: balances, the latest movements and top-ups
   (`GET /v1/me/company/wallet`). The payment page link is shown only to the admin who started
   the top-up. The console's company detail shows balances and recent top-ups (`users:read`).
8. **Privacy.** Top-ups carry the requester, a hashed IP and its country (risk signals, as
   payments), are exported to the requester, survive account deletion (financial records), and
   are purged after 90 days unpaid or after `FINANCIAL_RECORDS_RETENTION_YEARS` paid.

## Not decided here

- **Withdrawals** (a company closing its wallet) go through support: a refund to a top-up's
  original payment needs refund rows that are not tied to a booking.
- **Invoiced credit** (pay monthly against a limit) waits for the owner's credit decisions.
- **Card fingerprint checks on top-ups** wait for the payment risk work to cover non-booking
  payments; until then the limits, admins only, audit and reconciliation are the controls.

## Consequences

- Companies keep funds with Suskii before travelling; the wallet is a closed-loop prepayment
  for Suskii's own services. Counsel should confirm for Nigeria (CBN) that it is not e-money
  before launch, and the owner should confirm the limits.
- A chargeback on a spent top-up is a loss, as on any card payment.
- Mobile contract: the booking DTO gains an additive `paymentOptions.companyWallet` (older app
  builds ignore it) and the refund destination enum a value (`company_wallet`). An older build
  showing a refund of a trip paid from the company wallet (paid on the website) prints the raw
  catalog key for the destination in that one line; nothing else changes. Raising
  `MOBILE_MIN_VERSION` past this release removes it once enough phones have updated.
