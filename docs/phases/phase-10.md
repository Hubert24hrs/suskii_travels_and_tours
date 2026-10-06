# Phase 10: Admin console

Status: done

## Goal

Give staff one console for running the business: bookings, refunds, the in-house catalog, deals,
promo codes, markups and fees, site content and trust signals, users and roles, the audit log,
visa work, Suskii Prime plans, referral review and dashboards. Every screen is backed by an
`/v1/admin` API route that checks the caller's permission, and every change staff make is in the
audit log.

## Acceptance criteria (from PROJECT_SPEC.json)

1. Every admin route has permission tests.
2. All admin mutations appear in the audit log.

## What exists already

- RBAC catalog in `@suskii/shared` (`ROLE_PERMISSIONS`, staff roles) and `@AdminRoute(...)`: a
  staff role, an MFA-verified session, the permission and the IP allowlist
  (`ADMIN_IP_ALLOWLIST`); denials are audited (`rbac.access_denied`).
- Admin API routes for refunds (maker-checker), the in-house catalog and voucher redemption, visa
  applications, documents and rules, Prime plans, referral review, user roles and the audit log.
- Staff cannot turn MFA off; confirming TOTP marks the session MFA-verified.
- `apps/admin` is a placeholder Next.js app on port 3001.

## Scope decisions

- **Staff sessions (ADR-033).** Staff sign in on the console through the same API endpoints
  (password, then the authenticator code); a staff account without TOTP enrols before it gets an
  admin session. The console calls the API from the browser with the session cookies, like the
  website's account area. Because production cookies are shared across subdomains, admin routes
  accept a cookie-authenticated request only when its `Origin` is an admin origin
  (`ADMIN_ORIGINS`), for every method. A script on the public website then cannot read or change
  admin data even when a staff member is signed in on both. Bearer-token callers are unaffected.
- **Permission tests for every admin route (ADR-034).** The OpenAPI document gains
  `x-admin-permissions` per operation from `@AdminRoute`. A route-matrix e2e test reads the
  document and, for every `/v1/admin` operation, checks anonymous (401), customer (403), staff
  without the permission (403), staff with it but without MFA (403), a foreign origin (403) and
  the allowed caller (neither 401 nor 403). A second check fails if any `/v1/admin` route has no
  `@AdminRoute` permission, so a new route is covered automatically.
- **Audit coverage (ADR-034).** Admin mutations declare the audit actions they write in their
  contract (`audit: [...]`, published as `x-audit`). An admin-audit e2e suite performs every
  admin mutation successfully and checks the declared entries with the staff actor and target; it
  then asserts that it covered every admin mutation in the document, so a new mutation without a
  test fails the suite.
- **Managed data (ADR-035).** Markup and fee rules, promo codes, deal routes, destination content,
  CMS blocks, FAQs and trust signals get admin routes. Nothing is hard-deleted where history
  matters: rules, promos and routes are deactivated; CMS blocks and FAQs are unpublished. CMS
  block content is validated against the same schemas the public site reads. Trust signals are
  edited by content managers but only marked verified, with an evidence URL, by a holder of
  `trust-signals:verify` (super admin); editing a verified claim's value clears the verification.
  Public pages pick changes up within their cache window (one minute to a day, documented per
  area).
- **Bookings and users.** Staff search bookings (reference, status, vertical, dates, contact email
  through its HMAC) and see one booking with its items, payments, refunds, plan and status
  history; they add internal notes and resend the confirmation email. Users are searched by email
  or phone, disabled and enabled (sessions revoked), and their MFA reset (staff then re-enrol);
  roles stay super-admin only and nobody changes their own account.
- **Dashboards (ADR-036).** One read-only route (`reports:read`) with counts and sums for a period:
  bookings by status and vertical, money taken and refunded per currency from the ledger (never
  converted), refunds waiting for approval or review, visa applications waiting, new accounts,
  active Prime members and referrals in review.
- **Console.** Next.js App Router, client-rendered behind the staff session, `noindex`, its own
  CSP. Navigation shows only what the staff member's permissions allow (the API still decides).
  Copy comes from `@suskii/i18n` (`admin.*`, English).

## Plan

### API

- `ADMIN_ORIGINS` setting and the origin check in `PermissionsGuard` for cookie sessions.
- Contract metadata: `@AdminRoute` permissions and `audit` actions in the OpenAPI document.
- New admin controllers: bookings (list, detail, note, resend confirmation), users (search,
  disable, enable, reset MFA), pricing (markup and fee rules), promos, deal routes, destinations,
  CMS blocks, FAQs, trust signals (edit, verify, unverify), dashboard. New audit actions for each.
- Migration 10: `booking_notes`; `users.disabled_reason` if needed.

### Admin app

- Staff sign-in with MFA and enrolment, session handling (CSRF, single-flight refresh), layout
  with permission-aware navigation, and pages for every area above plus visa, Prime and
  referrals.

### Tests

- API e2e: the admin route matrix, admin audit coverage, and behaviour tests for the new routes.
- Admin Playwright: staff sign-in with MFA, a refund approved by a second staff member, a markup
  rule changing a price, a trust signal verified with evidence, a promo created, the audit log
  showing those changes; axe on every page.

## Risks and mitigations

- **Session riding from the public site.** Mitigation: origin check on admin routes, CSRF on
  writes, MFA sessions only.
- **Untested new routes.** Mitigation: the matrix and coverage tests are driven by the OpenAPI
  document, not by a hand-written list.
- **Price mistakes from markup edits.** Mitigation: values validated (basis points within limits,
  caps in minor units), markups cannot be negative (discounts are promo codes), every change
  audited with the before and after values.

## Outcome

### Acceptance criteria

1. **Every admin route has permission tests.**
   - The OpenAPI build fails when a `/v1/admin` operation has no `@AdminRoute` permission
     (`x-admin-permissions`) or `@AdminRoute` is used outside `/v1/admin`.
   - API e2e (`admin-matrix.e2e-spec.ts`) reads the document and calls every admin operation
     (71) anonymously (401), as a customer (403), as staff without its permission (403), as
     staff without MFA (`mfa-required`), with a cookie session from a foreign or missing origin
     (403), and as a permitted super admin by bearer token and from the console origin (neither
     401 nor 403). A new route is covered without editing the test.
   - Admin Playwright: navigation and page access per role (a content manager and operations
     staff see only their sections; other sections show the refusal without calling the API) and
     staff sign-in with MFA, enrolment and refusal of customer accounts.
2. **All admin mutations appear in the audit log.**
   - The OpenAPI build fails when an admin mutation declares no audit action (`x-audit`).
   - API e2e (`admin-audit.e2e-spec.ts`) performs all 49 admin mutations successfully, checks a
     declared entry with the staff actor and target for each, and fails if any admin mutation in
     the document was not exercised.
   - Admin Playwright (`audit.spec.ts`, after the journeys): the refund request and approval, the
     markup rule, the trust signal verification and the promo code are each in the audit log
     under the staff member who made them.

### Tests

- Unit: API 375 (including the admin helpers), shared 170, design tokens 179, ui-web 144, mobile
  105, ui-native 44, worker 31, i18n 17, api-client 3.
- API e2e: the full suite, including the admin route matrix, audit coverage and console
  behaviour suites (results recorded with the CI run below).
- Admin e2e (Playwright, 10 tests in two projects): enrolment on first sign-in; a refused code,
  sign-in and sign-out; a customer turned away; a refund requested by support and approved by
  finance (support cannot approve); a tours markup raising the public price; the IATA claim
  verified with evidence and served by the public content API; a promo code created by operations,
  who cannot open pricing; the audit log check; axe on every page (all sections plus booking, user
  and visa application details) and the console at phone width. Stable over repeated local runs.

### CI

Recorded after the final CI run on this phase's last commit.

### Deviations from the plan

- **Catalog details are edited as JSON.** Packages, tours, add-ons and visa products have long
  nested fields (itineraries, policies, checklists, meeting points); the console edits the
  product's editable fields as a JSON document, prefilled from the API, and shows the API's field
  issues. Status changes and departures (capacity, status, per-person prices) have their own
  forms. A field-by-field editor can replace it when content staff ask.
- **Visa documents open in a new tab** through a short-lived signed link requested on click;
  the console never holds document content.
- **Prime plan slug and billing period are fixed after creation**, since running memberships
  refer to them.
- **The admin e2e stack disables rate limiting** (`RATE_LIMIT_ENABLED=false`) because every
  persona signs in from one IP within a minute; the limits are covered by the API e2e suite.
  It creates and drops its own database when given a server URL, so runs never share data.
- **Found by the e2e suite and fixed:** pages started their API query before their permission
  check, so opening a forbidden section sent a request the API refused (the shell now mounts a
  section only for permitted staff, and staff without the dashboard land on their first section);
  the console had no icon (a 404 on every page).
- **Found by CI and fixed:** the detail routes used Next's generated `PageProps` type, which does
  not exist when lint runs before a build.
