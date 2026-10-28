# ADR-089: Payment pages without third-party scripts, and privacy obligations per country

- Status: Accepted
- Date: 2026-10-28
- Item 13 of the standards plan agreed with the owner (PCI DSS SAQ A, Nigeria's NDPA, Kenya's
  DPA, South Africa's POPIA)

## Context

Card payments happen on the providers' hosted pages, so Suskii can self-assess with SAQ A. Since
the January 2025 revision, SAQ A eligibility requires the merchant to confirm its site "is not
susceptible to attacks from scripts" that could affect the payment hand-off; requirements 6.4.3
and 11.6.1 left the questionnaire, and implementing them is the accepted way to meet the
criterion.

The website's policy (ADR-010) is strict, but it uses `strict-dynamic`: any script our bundle
inserts runs. After a visitor allows marketing, the Meta and TikTok tags (ADR-079) are such
scripts, and they stay in the document through client-side navigation into checkout. A
compromised tag on the page that redirects to the provider could change where the traveller pays.

The three African laws now in force (the GAID took effect in September 2025; POPIA's regulations
were amended in April 2025) share the obligations GDPR has (rights, breach notice, transfers,
records) with different deadlines and filings, and the platform had no breach runbook.

## Decision

1. **Payment pages hold only our scripts.** `isPaymentPage()` (`/checkout/*`, `/bookings/*`)
   selects a policy with `script-src 'self' 'nonce-…' https://challenges.cloudflare.com` and no
   `strict-dynamic`, and with no ad hosts in `connect-src` or `img-src`. The browser then refuses
   any script that is not ours or Turnstile's, whoever inserts it.
2. **Ad tags never start there.** `Marketing` skips the tags on payment pages; a document that
   already ran them reloads once on entering one (`PaymentPageGuard`), so the stricter policy of
   a fresh document applies. Browser `InitiateCheckout` and `Purchase` events raised there wait in
   memory and leave from the next page that runs the tags, if any; the Purchase also goes
   server-side as before (ADR-079), which is the copy the networks keep.
3. **An inventory with a test.** `docs/compliance/pci-saq-a.md` lists each payment page and the
   scripts allowed there with their reasons; `e2e/ads.spec.ts` fails if checkout or the booking
   page carries another script or a looser policy.
4. **Obligations are written down per country**, with sources and what only the owner can do, in
   `docs/compliance/privacy-obligations.md`; the breach runbook follows it.
5. **Deadlines come from one table.** `PRIVACY_RULES` (`@suskii/shared`) holds, per jurisdiction
   (NG, KE, ZA, EU, GB, other), the regulator, the breach notice period and the answer period for
   each request kind, each with `statutory` and its source row. `privacyRequestDueAt()` and
   `breachNoticeDueAt()` are the only ways to compute a due time; calendar months clamp to the
   month's last day. Where a law gives no number we keep an internal target (`statutory: false`).
6. **A register of rights requests.** Every request is a `privacy_requests` row with its law,
   channel, due time and outcome. Self-service exports and deletions are recorded closed as they
   happen, under the law of the caller's edge country; staff record emailed, phoned, posted and
   support requests in the console and close them as completed or refused with a reason from a
   fixed list (never free text). Closing claims the row with a conditional update. The person is
   an account id or an encrypted email shown masked.
7. **A breach register.** A breach is opened with its awareness time, categories, the laws that
   apply and encrypted details shown only on the breach itself; each law gets a notice due 72
   hours after awareness. A notice is recorded as sent (time, regulator reference, when people
   were told) or not required; the breach closes only when no notice is pending. Audit entries
   carry ids, laws, decisions and whether a step was late, never the details.
8. **Alerts before a deadline.** The API exports `suskii.privacy_breach_notices.pending` (overdue,
   due within 12 hours, later) and `suskii.privacy_requests.open` (due, overdue);
   `PrivacyBreachNoticeDue` pages and `PrivacyRequestOverdue` opens a ticket. No worker job is
   needed: the gauges read the registers at each scrape.
9. **A role for it.** `privacy:manage` belongs to the new `privacy_officer` role (with
   `users:read` and `audit:read`) and to super admins.
10. **Records of processing are code.** `PROCESSING_ACTIVITIES` and `RECIPIENTS`
    (`apps/api/src/privacy/processing-records.ts`) give each activity its purpose, lawful basis,
    people, data, tables and recipients, and each recipient its role, location and transfer
    basis. `docs/privacy/records-of-processing.md` is rendered from them and the data registry;
    a unit test fails when a table holding personal data belongs to no activity, a recipient is
    unused or the page is stale.

## Consequences

- A consented visitor entering checkout from another page pays one extra page load.
- Fewer browser checkout events reach the ad networks; the server-side Purchase is unchanged.
- A new third-party script on a payment page (chat, analytics, a provider's embedded fields) needs
  a policy change, an inventory entry and a fresh look at the SAQ type.
- Legal positions marked "confirm" (registration tiers, Kenya's sector list, transfer bases) wait
  for the owner's counsel; the code encodes only deadlines confirmed from the texts.
- Requests that arrive outside the product (email, phone, post) count only once staff record
  them; the runbook (`docs/runbooks/data-rights-requests.md`) says to do so on the day they arrive.
- A new table holding personal data, or a new provider that receives it, fails the records test
  until it has an activity or a recipient entry, so the records cannot silently fall behind.
