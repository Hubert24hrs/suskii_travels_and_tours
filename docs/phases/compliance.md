# Compliance: PCI DSS SAQ A, NDPA, Kenya DPA and POPIA

Item 13 of the roadmap agreed with the owner (US and European standards for African markets):
keep card payments within SAQ A, and meet Nigeria's, Kenya's and South Africa's data protection
laws in the product, not only on paper (ADR-089).

## Why

Acquirers and payment providers ask for a yearly SAQ and its attestation; a merchant that is not
eligible for SAQ A answers SAQ A-EP, with many more requirements. The NDPC, Kenya's ODPC and
South Africa's Information Regulator now enforce with fines, and each expects breach
notices within days and answers to rights requests within set times (Kenya: access in 7 days).

## Where the platform stood

- Hosted checkout only, no card data, a nonce policy on every page (ADR-010, ADR-016).
- Self-service export and deletion, consent records, retention rules, field encryption, an audit
  log (ADR-029, ADR-032, ADR-039).
- Missing: a check that pages starting a payment cannot run third-party scripts (ad tags could),
  a breach runbook, the per-country obligations, and any tracking of rights requests or breaches
  against their deadlines.

## Plan

| Part | Step | Work                                                                                                                                                                                                  | Files                                                    |
| ---- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 1    | 1    | Payment pages: strict script policy, no ad tags, reload guard; e2e checks of the policy and the script inventory                                                                                      | `apps/web/lib`, `proxy.ts`, `components/payments`, `e2e` |
| 1    | 2    | SAQ A eligibility and inventory; privacy obligations per country with sources; personal data breach runbook                                                                                           | `docs/compliance`, `docs/runbooks`                       |
| 1    | 3    | ADR-089, CHANGELOG, CLAUDE.md                                                                                                                                                                         | `docs`                                                   |
| 2    | 4    | Jurisdiction rules (deadlines per request kind and for breaches, regulators, sources) with unit tests                                                                                                 | `packages/shared`                                        |
| 2    | 5    | Rights request register (self-service export and deletion logged automatically, staff-entered requests) and breach register with deadlines per country; `privacy:manage` permission; audit; retention | `apps/api/src/privacy`, migration                        |
| 2    | 6    | Console pages for both registers; worker sweep and alerts before a deadline passes                                                                                                                    | `apps/admin`, `apps/worker`, `infra/observability`       |
| 2    | 7    | Records of processing and a transfer register generated from `DATA_REGISTRY` and a list of processing activities, checked in CI                                                                       | `apps/api/src/privacy`, `scripts`, `docs/privacy`        |

## Risks

- **Legal interpretation.** Thresholds and some deadlines are not fixed in the texts we could
  reach; those rows say "confirm" and the code uses only confirmed values plus documented internal
  targets.
- **Ad measurement.** Browser checkout events stop on payment pages; Purchase still goes
  server-side.
- **Next.js without `strict-dynamic`.** Payment pages load their chunks by origin (`'self'`); the
  whole web e2e suite runs against the stricter policy.

## Outcome (part 1)

- **Payment pages:** `isPaymentPage()` selects `script-src 'self' 'nonce-…'
https://challenges.cloudflare.com` without `strict-dynamic` or ad hosts; `Marketing` never
  starts the ad tags there; `PaymentPageGuard` reloads a document that already ran them. The ads
  e2e now checks that the tags are gone on checkout and the booking page, that only our scripts
  load there, that nothing reaches an ad network after entering checkout, and the policies of the
  homepage, checkout and the booking page.
- **Docs:** `docs/compliance/pci-saq-a.md` (eligibility, inventory, owner filings),
  `docs/compliance/privacy-obligations.md` (Nigeria, Kenya, South Africa, with GDPR for
  comparison), `docs/runbooks/personal-data-breach.md`, ADR-089.

Waiting for the owner: registration with the NDPC, the ODPC and the Information Regulator; a DPO
and an Information Officer; the yearly SAQ A with the providers' attestations; counsel's view on
the rows marked "confirm"; and the privacy policy and PAIA manual.

## Outcome (part 2)

- **Rules:** `PRIVACY_RULES` in `@suskii/shared` (regulator, breach notice period and request
  deadlines per law, each with its source and whether the law sets it), with
  `privacyRequestDueAt()` and `breachNoticeDueAt()` and unit tests for every deadline.
- **Registers:** `privacy_requests`, `privacy_breaches` and `privacy_breach_notices` (one
  migration, expand only). Self-service exports and deletions are recorded under the law of the
  caller's country; staff record and close the rest under `/v1/admin/privacy` (`privacy:manage`,
  new `privacy_officer` role). Emails and breach details are encrypted per row and listed for
  key rotation; every change is audited with ids and outcomes; retention rules keep closed
  requests three years and closed breaches six.
- **Console:** the Privacy registers page records, completes and refuses requests and opens,
  notifies and closes breaches; the admin e2e journey covers it, with axe, and the audit project
  checks the closing entry.
- **Alerts:** `suskii.privacy_breach_notices.pending` and `suskii.privacy_requests.open` feed
  `PrivacyBreachNoticeDue` (page, `personal-data-breach.md`) and `PrivacyRequestOverdue`
  (ticket, `data-rights-requests.md`). A worker sweep turned out unnecessary: the gauges read
  the registers at each scrape.
- **Records of processing:** 15 activities and 17 recipients in
  `apps/api/src/privacy/processing-records.ts`, rendered to
  `docs/privacy/records-of-processing.md` (`pnpm --filter @suskii/api privacy:records`); a unit
  test fails when a personal data table has no activity, a recipient is unused or the page is
  stale.
- **Tests:** shared rules 10, API unit (records 5), API e2e `privacy-registers` 7 plus the admin
  matrix and audit cases, admin e2e 22 including the privacy journey.

Waiting for the owner, in addition to part 1: who holds the privacy officer role, and counsel's
confirmation of each recipient's location and transfer basis against the signed terms.
