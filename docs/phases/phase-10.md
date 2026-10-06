# Phase 10: Admin console

Status: in progress

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
