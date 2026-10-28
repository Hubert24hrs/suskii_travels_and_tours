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
5. **Part 2 makes the deadlines operational:** one table of rules per jurisdiction in
   `@suskii/shared`, a register of rights requests and a breach register in the console with due
   times from those rules, an alert before a regulator deadline passes, and records of processing
   generated from `DATA_REGISTRY` and checked in CI.

## Consequences

- A consented visitor entering checkout from another page pays one extra page load.
- Fewer browser checkout events reach the ad networks; the server-side Purchase is unchanged.
- A new third-party script on a payment page (chat, analytics, a provider's embedded fields) needs
  a policy change, an inventory entry and a fresh look at the SAQ type.
- Legal positions marked "confirm" (registration tiers, Kenya's sector list, transfer bases) wait
  for the owner's counsel; the code encodes only deadlines confirmed from the texts.
