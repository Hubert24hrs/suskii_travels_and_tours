# Company wallet: prepaid funds a company tops up and spends

The next layer of company accounts (ADR-078 named it "the next step"; decision in ADR-090). A
company admin adds funds by hosted checkout; members pay their approved company trips from the
company's balance in one step; refunds of those trips go back to it.

## Why

Business travel buyers (Booking.com for Business, TravelPerk, Wakanow Business) pay from a
company balance so travellers never use personal cards, finance tops up once, and every trip
draws from one statement. For Suskii it means money received before travel, fewer abandoned
checkouts on company trips, and a reason for companies to keep booking here.

## Where the platform stood

- The ledger already has per-user wallets (`wallet:{userId}:{CUR}`); money enters them only by
  refunds and referral rewards, and `payFromWallet` pays a booking from one in a single
  transaction (ADR-017). Refunds of wallet payments go back to the wallet.
- Every hosted payment is a `payments` row tied to a booking; webhooks and reconciliation find
  it by provider reference (ADR-016).
- Company bookings carry `company_id` and an approval status; payment refuses a pending approval
  (ADR-078).

## Plan

| Step | Work                                                                                                                                                                                                                                                                                           | Files                                                    |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 1    | Shared: who tops up and who sees the balance, top-up statuses, the top-up input schema; copy in every catalog                                                                                                                                                                                  | `packages/shared`, `packages/i18n`                       |
| 2    | Database: `company_wallet_top_ups`; payment kind `company_wallet`; refund destination `company_wallet`; discrepancy subject `company_topup`; privacy registry and retention                                                                                                                    | `apps/api/prisma`, `src/privacy`                         |
| 3    | Ledger: account `company-wallet:{companyId}:{CUR}` (liability, never negative); kinds `company_topup_captured`, `company_wallet_payment`, `refund_to_company_wallet`                                                                                                                           | `src/ledger`                                             |
| 4    | Top-ups: an admin starts one (limits per currency, a daily count per company, active company, Idempotency-Key); hosted checkout from `PaymentProviders`; webhooks and the mock page find the top-up by reference; the received amount is credited once; lost webhooks reconciled like payments | `src/companies`, `src/bookings/payment-*`                |
| 5    | Paying a company trip: `useCompanyWallet` at payment start, only for the booker of an approved (or not-to-approve) trip of an active company; one transaction; payment options say whether the wallet covers the trip without showing the balance                                              | `src/bookings/checkout.service.ts`, `payment-options.ts` |
| 6    | Refunds of those trips credit the company wallet; ledger reconciliation checks top-ups and company-wallet refunds                                                                                                                                                                              | `src/bookings/refunds.service.ts`, `src/finance`         |
| 7    | Wallet view for admins and approvers (balances, movements, top-ups); console company detail shows balances and recent top-ups                                                                                                                                                                  | `src/companies`, `src/admin`, `apps/admin`               |
| 8    | Website: Wallet in the Company section (balances, add funds, history, the return page) and "Pay from the company wallet" at checkout; app: the same choice at checkout                                                                                                                         | `apps/web`, `apps/mobile`                                |
| 9    | Tests (unit, API e2e with roles and IDOR, reconciliation, refunds, web e2e, app Jest) and docs (ADR-090, security docs, CHANGELOG, CLAUDE.md)                                                                                                                                                  | everywhere                                               |

## Not in this item

- **Withdrawing unused funds** (a company closing its account) goes through support for now: a
  refund to the top-up's original payment needs refund rows that are not tied to a booking.
- **Invoiced credit** (pay monthly) still waits for the owner's credit limits and collections
  (ADR-078).
- **Paying installments or holds** from the company wallet: a wallet pays the whole amount, as
  the personal wallet does.

## Risks

- **Stored value.** A closed-loop balance spent only on Suskii's own services is a prepayment,
  not e-money; counsel should confirm for Nigeria (CBN) before launch. Funds cannot be
  transferred between companies or withdrawn to another account.
- **Card fraud through top-ups.** Limits per top-up and per day, admins only, audit, and the
  ledger reconciliation with the provider; a chargeback on a spent top-up is a loss as on any
  card payment.
- **Concurrency.** Two trips paid at once cannot overdraw the wallet: the database refuses a
  negative balance and the second payment answers `wallet-insufficient`.

## Outcome

Built as planned (ADR-090), with two changes made while building:

- **No separate wallet page.** The Wallet card sits in Account, Company for admins and approvers,
  and the provider sends the admin back to `/account/company?topUp=…`, where the card follows the
  top-up until the webhook lands.
- **Problem slugs start with `company-`** (`company-top-up-limit`, `company-top-up-amount`,
  `company-top-up-currency`): the website's class guard, like Tailwind, read `top-up-*` as the
  `top` utility.

What was built:

- **API:** top-ups (`CompanyWalletService`, `CompanyTopUps`) through the payment webhook pipeline
  and reconciliation; paying company trips from the wallet in one transaction with the ledger
  refusing an overdraft; refunds back to the wallet; ledger reconciliation of top-ups; the wallet
  routes, payment options (`companyWallet.covers`), the console company detail and dashboard
  figures. Concurrent payments from one personal wallet now answer 409 instead of 500.
- **Database:** `company_wallet_top_ups`, new enum values (expand-only migration
  `20261111120000_company_wallet`); data registry, export, retention and the records of
  processing.
- **Website:** the Wallet card (add funds, return status, movements, top-ups), "Pay from the
  company wallet" at checkout and on the booking page. **App:** the same choice at checkout and on
  the trip screen. **Console:** balances and recent top-ups on the company detail.

Verification on this branch (local, after merging the base with compliance parts 1 and 2):

| Check                               | Result                                                                                 |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| Typecheck and lint, every workspace | 13 of 13 and 14 of 14 tasks                                                            |
| Unit tests, every workspace         | 11 of 11 tasks: API 679, mobile 273, shared 286, ui-web 152, worker 50, ui-native 45   |
| API e2e, company wallet             | 3 of 3 (top-ups, replay, mismatch, lost webhook, daily cap, roles, overdraft, refunds) |
| API e2e, full                       | 610 of 615; the 5 S3 tests need a Docker Hub image this container cannot pull (429)    |
| Console e2e                         | 23 of 23                                                                               |
| Website e2e, company accounts       | 3 of 3, including adding funds on the mock page and paying a trip from them            |
| Migration guard, checklist, format  | backwards-compatible, up to date, clean                                                |

What waits for the owner: counsel on stored value (CBN), the limits per currency and the daily
count, how support closes a wallet and returns unused funds, and whether top-ups should go
through the payment risk review.
