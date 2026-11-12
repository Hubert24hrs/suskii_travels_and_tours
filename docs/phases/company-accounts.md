# Company accounts

Item 7 of the standards plan agreed with the owner on 2026-10-27: accounts for companies that
book travel for their staff, as Booking.com for Business, Wakanow Business and TravelPerk offer.
Decision record: [ADR-078](../decisions/ADR-078-company-accounts.md).

## Why

Business travel is repeat, planned and less price-sensitive than leisure travel. Companies want
one place to book for their people, rules that stop expensive trips without someone saying yes,
and one report of what was spent, with the VAT on our service. Every trip a company books
through Suskii earns the same markup and fees as any other booking, and companies book again.

## Where the platform stands

- Bookings belong to one user (`bookings.user_id`) or to a guest; nothing groups people.
- Roles (`ROLE_PERMISSIONS`) are platform roles (customer, staff, drivers); there is no notion of
  a role inside a customer organisation.
- The ledger has per-user wallets (`wallet:{userId}:{CUR}`, ADR-017); paying from a wallet and
  refunding to it already exist.
- Receipts print the booking's stored tax lines (ADR-072), which is what a company's accountant
  needs per trip.
- Notifications (`NotificationService`) and signed, single-use links (`VerificationToken`) exist.

## Plan

| Step | Work                                                                                                                                                                             | Files                              |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 1    | Shared: company roles, policy schema (hotel nightly cap, highest cabin, advance days, approval mode), approval statuses; copy in every catalog                                   | `packages/shared`, `packages/i18n` |
| 2    | Database: `companies`, `company_members`, `company_invitations`, `company_policies`; booking columns for the company, the booker, policy findings and approval; privacy registry | `apps/api/prisma`, `src/privacy`   |
| 3    | API: create a company, invite by email (hashed single-use token), accept, change roles, remove; the policy; one company per person                                               | `apps/api/src/companies`           |
| 4    | Booking for the company: a member books with `company: true`; the policy is checked from the quote; out-of-policy (or every) trip waits for an approver before payment; audit    | `src/companies`, `src/bookings`    |
| 5    | Approvals: approvers see waiting trips, approve or reject with a reason; the booker is told; payment opens only after approval; an unapproved booking expires as any unpaid one  | `src/companies`, `src/messaging`   |
| 6    | Reports: company bookings with traveller, booker, status and total; spend by month and by traveller; CSV export (amounts in minor units with the currency)                       | `src/companies`                    |
| 7    | Website: a Company section in the account area (members, invitations, policy, approvals, bookings, report) and "Book for my company" at checkout                                 | `apps/web`                         |
| 8    | App: company trips in the trips list, approvals for approvers, "Book for my company" at checkout                                                                                 | `apps/mobile`                      |
| 9    | Console: companies list and detail (members, bookings), suspend and reinstate                                                                                                    | `apps/admin`, admin routes         |
| 10   | Tests (unit, API e2e with IDOR, admin matrix and audit cases, web e2e, app Jest, admin e2e) and docs                                                                             | everywhere                         |

The company wallet (prepaid funds a company tops up and spends) and invoiced credit are left for
a later item: the first needs a new payment purpose through the webhook pipeline, the second
credit decisions the owner has not made (ADR-078).

## Risks

- **Someone else's company.** Every company route loads the member's own company; ids from the
  path are checked against it and answer 404 otherwise, as bookings do.
- **Policy bypass.** The policy is evaluated on the server from the quote (never from what the
  client says) and stored on the booking; payment refuses a booking whose approval is missing.
- **Invitation abuse.** Invitations are single-use, expire after 7 days, are stored as an HMAC of
  the token, and are rate limited; accepting needs a signed-in account whose verified email is
  the invited one.
- **Personal data.** Members' names and emails are shown to the company's admins only; reports
  carry ids, names and amounts, never passport or contact details of travellers.
- **Leaving a company.** A removed member keeps their own bookings; company bookings stay with
  the company for its reports.

## Outcome

Built as planned. The company wallet and invoiced credit stay for a later item, as the plan said.

- **API** (`apps/api/src/companies`): companies, members in four roles, emailed single-use
  invitations (HMAC-stored, 7 days, matched to the verified email), the travel policy, the
  check at booking (`CompanyPolicyEvaluator`, from the quote), approval before payment and
  payment plans, decisions claimed once with notifications both ways, reports (committed spend
  by month and traveller per currency, CSV), console routes to list, inspect, suspend (step-up)
  and reinstate. Decisions taken while building are recorded in ADR-078: nobody decides their
  own trip, memberships and rides are never company trips, and `GET /v1/me/company` answers
  `{ company: null }` instead of 404 so a signed-in checkout logs no error.
- **Database**: `companies`, `company_members`, `company_invitations`, `company_policies` and
  booking columns for the company, the findings and the approval (expand-only migration
  `20261101120000_company_accounts`).
- **Privacy**: data registry entries, memberships in the export and deleted with the account,
  invitations purged 30 days after expiry, the `company_admin` deletion blocker, security docs
  and store forms updated.
- **Website**: Account > Company, `/company/join`, "Book for {company}" at checkout and the
  approval state on the booking page.
- **App**: Account > Company (trips to approve, company trips), "Book for {company}" at checkout,
  the approval state on the trip screen, push notifications that open the company screen.
- **Console**: the Companies page.

Verification on this branch (local):

| Check                                     | Result                                                                              |
| ----------------------------------------- | ----------------------------------------------------------------------------------- |
| Lint and typecheck, every workspace       | 14 of 14 and 13 of 13 tasks                                                         |
| API unit tests with coverage gates        | 585 passed (50 suites)                                                              |
| API e2e (full, without the S3 suite)      | 518 of 519; the one failure (the step-up route list) fixed, its suite re-run 6 of 6 |
| Shared, i18n, worker                      | 239, 33 and 49 passed                                                               |
| App (Jest)                                | 250 passed (44 suites)                                                              |
| Admin e2e                                 | 17 of 17, including the suspend and reinstate journey                               |
| Website e2e (CI settings, fresh database) | 116 of 116: main and slow-3G projects 115, then the Lighthouse homepage gate        |
| Security checklist, format                | up to date, clean                                                                   |

The Lighthouse gate first missed total blocking time (233 and 249 ms against 200 ms) while this
container ran slowly: Lighthouse's CPU benchmark read 1,296 then, against 1,529 for a passing run
of the base branch on the same machine. The homepage ships the same JavaScript as the base
(182,207 bytes in 11 scripts), and the branch passed once the machine was as fast again (benchmark
1,582, 154 ms).

What waits for the owner: whether to offer a company wallet and invoiced credit, negotiated
rates or a corporate fee, and who at Suskii supports company admins.
