# ADR-017: Double-entry ledger and wallet

- Status: Accepted
- Date: 2026-09-29
- Deciders: Claude Code (implementer), pending owner review

## Context

The spec requires every money movement in a double-entry ledger, a wallet usable at checkout,
refunds capped by what was paid, and immutable financial records. Phase 5 tracked money only on
`payments` rows with a `requiresRefund` flag.

## Decisions

1. **Three tables.** `ledger_accounts` (unique code, type, currency, `allow_negative`, cached
   balance), `ledger_transactions` (unique idempotency key, kind, booking, payment and refund
   references, memo) and `ledger_entries` (account, debit or credit, positive amount). Amounts are
   `BIGINT` minor units with an ISO-4217 code, as everywhere else.
2. **The database enforces the invariants**, so no code path can break them:
   - entries and transactions are append-only (row triggers reject UPDATE and DELETE);
   - a deferred constraint trigger checks at commit that each transaction's debits equal its
     credits per currency, and that every entry's currency matches its account's;
   - balances are updated in the same statement batch as the entries, and a check constraint
     rejects a negative balance on accounts without `allow_negative`.
3. **Idempotency.** `LedgerService.post()` takes a business key (`payment:{id}:captured`,
   `refund:{id}:initiated`, `refund:{id}:settled`); posting the same key again returns the
   existing transaction. Retried webhooks, workers and API calls cannot double-post.
4. **Chart of accounts** (balances are kept in each account's normal direction):

   | Code                                 | Type      | Negative | Meaning                                      |
   | ------------------------------------ | --------- | -------- | -------------------------------------------- |
   | `psp:{provider}:{CUR}`               | asset     | allowed  | Money held by a payment provider for Suskii  |
   | `booking:{bookingId}:{CUR}`          | liability | never    | Customer money held for a booking            |
   | `unapplied:{CUR}`                    | liability | never    | Money no booking could take, awaiting refund |
   | `wallet:{userId}:{CUR}`              | liability | never    | Customer wallet credit                       |
   | `refunds-in-flight:{provider}:{CUR}` | liability | never    | Refunds sent to a provider, not yet settled  |
   | `fees:cancellation:{CUR}`            | income    | never    | Fees kept on installment default, per policy |

5. **Postings.**

   | Event                                 | Debit                    | Credit                   |
   | ------------------------------------- | ------------------------ | ------------------------ |
   | Payment applied to a booking          | `psp`                    | `booking`                |
   | Payment the booking cannot take       | `psp`                    | `unapplied`              |
   | Booking or installment paid by wallet | `wallet`                 | `booking`                |
   | Refund sent to the original method    | `booking` or `unapplied` | `refunds-in-flight`      |
   | Refund settled by the provider        | `refunds-in-flight`      | `psp`                    |
   | Refund failed                         | `refunds-in-flight`      | `booking` or `unapplied` |
   | Refund to wallet                      | `booking`                | `wallet`                 |
   | Cancellation fee kept on default      | `booking`                | `fees:cancellation`      |

   Revenue recognition (supplier cost, markup, fulfilment) is a finance reporting concern for the
   admin console (phase 10); the booking account keeps what the customer paid until refunded.

6. **Refund caps come from balances.** A refund debits its source account; the non-negative
   constraint makes an over-refund fail atomically, even when two staff members refund at once.
7. **What a booking has paid** is its booking account balance plus what left it as a kept fee;
   partial and full payment decisions read the ledger inside the webhook transaction.
8. **Wallet scope in this phase.** A wallet is the `wallet:{userId}:{CUR}` account. Staff can
   refund to it (account bookings only), and it can pay a booking or an installment when it covers
   the whole amount due in the booking's currency. `GET /v1/me/wallet` returns balances and
   recent movements. Partial wallet plus card, referral rewards and the web wallet page come with
   accounts in phase 9.

## Consequences

- Ledger rows are never corrected in place; mistakes are reversed with new transactions.
- The e2e reset truncates ledger tables (row triggers do not fire on TRUNCATE); production roles
  must not have TRUNCATE on them.
- Reports can be built from entries alone; cached balances can be re-derived and compared.
