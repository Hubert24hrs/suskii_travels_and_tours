# ADR-034: Admin route permission matrix and audit coverage

- Status: Accepted
- Date: 2026-10-06
- Deciders: Claude Code (implementer), pending owner review

## Context

Phase 10's acceptance criteria are "every admin route has permission tests" and "all admin
mutations appear in audit log". Hand-written lists of routes go stale as routes are added, so the
tests have to be driven by the routes themselves.

## Decisions

1. **Permissions in the contract document.** The OpenAPI builder reads the `@AdminRoute`
   metadata and publishes `x-admin-permissions` (the required permissions) on every admin
   operation. A route under `/v1/admin` without an `@AdminRoute` permission fails the build of
   the document, so it cannot ship unguarded.
2. **Route matrix test.** An API e2e suite builds the document from the running test app and, for
   every admin operation, sends a request with placeholder path parameters and an empty body as:
   an anonymous caller (401); a customer (403); a staff member whose roles lack one of the
   required permissions (403, chosen from the role catalog); a staff member with the permissions
   but without an MFA session (403 `mfa-required`); the allowed staff member from a foreign
   origin (403); and the allowed staff member from the admin origin, which must get neither 401
   nor 403 (validation errors and 404s show the guard let the request through). Permissions no
   staff role lacks are checked with the other cases.
3. **Declared audit actions.** Admin mutations (POST, PUT, PATCH, DELETE under `/v1/admin`) list
   the audit actions they may record in their contract (`audit: ['pricing.markup_updated']`;
   several when the input decides, such as a catalog edit that changes the status), published as
   `x-audit`. The document build fails when an admin mutation declares none.
4. **Audit coverage suite.** An API e2e suite performs every admin mutation successfully and
   checks that the call recorded one of its declared actions with the staff member as actor (and
   the target where the route has one). It keeps the set of operations it exercised and finally
   asserts that the set equals every admin mutation in the document, so a new mutation without a
   covering test fails the suite.
5. **Domain audits stay in the transaction.** Services keep writing audit entries inside the
   transaction that makes the change (ADR-007); the declarations and tests check that they do,
   rather than adding a generic after-the-fact log.

## Consequences

- Adding an admin route means adding `@AdminRoute`, the `audit` declaration for a mutation and a
  step in the coverage suite; the tests say which is missing.
- The admin console can read `x-admin-permissions` from the generated client types to decide what
  to show.
