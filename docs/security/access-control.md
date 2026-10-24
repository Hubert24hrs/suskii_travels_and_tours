# Access control

The rules that decide who may call what, see which records, and read or write which fields
(ASVS V8.1). The API enforces all of them. The web, app and console only hide what a person
cannot use. Designs: ADR-007 (authorisation), ADR-015 (guest access), ADR-033 and ADR-034 (admin).

## Function level

- **Authenticated by default.** Every route needs a session unless it is marked `@Public()`.
  Public routes are search, catalog and content reads, sign-up and sign-in, guest checkout,
  webhooks, health probes and web-vitals beacons.
- **Permissions, not roles, in code.** Routes declare `@RequirePermissions(...)`. Admin routes
  declare `@AdminRoute(permission)`, which also requires a staff role, an MFA session, an
  allowlisted IP and, for cookies, an allowlisted origin. The riskiest admin mutations add
  `@StepUp()`.
- **One catalog.** `ROLE_PERMISSIONS` (`packages/shared/src/rbac.ts`) maps the nine roles
  (`customer`, `super_admin`, `operations`, `finance`, `support`, `content_manager`,
  `visa_officer`, and the Cars roles `driver` and `operator_agent`) to 24 permissions. The seed
  syncs it to the database for the console. Drivers and operator agents are not staff
  (`NON_STAFF_ROLES`): no console, no MFA requirement, and their routes also check the record
  (the driver assigned to a ride, the agent's operator) (ADR-049, ADR-050).
- **Switched-off products.** A disabled Cars product (`CARS_*_ENABLED`) answers 404 on all its
  routes, before authentication (`CarsFeatureGuard`).
- **Checked automatically.** The OpenAPI build fails for an admin route without a permission or
  audit list. `admin-matrix.e2e-spec.ts` calls every admin route as every role and expects 403
  unless the role holds the permission. Denials are audited (`rbac.access_denied`) or logged
  (`authorization denied`).
- **Internal routes** (`/v1/internal`) accept only the worker's service token.

## Data level

| Resource                                                                                         | Who may access it                                                                                                         |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Bookings, their documents, payments, refunds                                                     | The owner's session, or a guest holding the booking token (`X-Booking-Token`, an HMAC lookup). Staff with `bookings:read` |
| Saved travellers, price alerts, sessions, devices, notifications, wallet, memberships, referrals | Their owner only                                                                                                          |
| Visa applications                                                                                | The owner; staff with `visa:process`                                                                                      |
| Visa document content                                                                            | Only through a signed link issued to the owner or an officer, valid for 5 minutes, and audited                            |
| Add-on purchase for an existing booking                                                          | A short-lived signed link, or the booking reference with the lead passenger's surname (rate limited)                      |
| Bus seat holds                                                                                   | The account that made it, or a guest with its hold token (an HMAC lookup); 404 for anyone else                            |
| Bus manifests and ticket scans                                                                   | Operator agents (`tickets:scan`) of the departure's own operator; other agents get 404 or `not_found`                     |
| Bus inventory (operators, terminals, routes, layouts, departures, agents)                        | Staff with `ground:manage`                                                                                                |
| Accounts                                                                                         | The owner; staff with `users:read` (view) or `users:manage` (disable, sign out, reset MFA)                                |
| Audit log, dashboards                                                                            | Staff with `audit:read` or `reports:read`                                                                                 |

Anything a caller may not access answers **404**, never 403, so ids cannot be probed. Ownership
is checked in the service that loads the record (`BookingsService.load()` and the like), not in
the client.

## Field level

**Read.** Each response is filtered through the route's response schema. Fields not in the
schema never leave the API.

| Field                                   | Rule                                                                                    |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| Markup, supplier cost, pricing rule ids | Never in any response, for any role                                                     |
| Booking contact (email, phone)          | Masked for everyone. Staff with `bookings:read` can reveal it with a reason, audited    |
| Passport numbers                        | Last three characters only, for everyone, staff included                                |
| Voucher codes                           | The owner sees their own; staff redeem by code and see the redemption state             |
| Payment details                         | Provider, status, amounts and references; never card data (the platform has none)       |
| Account details in the console          | Profile, roles, status, MFA state and sessions; never password hashes, secrets or codes |

**Write.** Each request body is parsed by a schema listing the fields that action may set. Zod
drops unknown fields before the handler runs, which prevents mass assignment.

| Field or change             | Rule                                                                                                      |
| --------------------------- | --------------------------------------------------------------------------------------------------------- |
| Booking status              | Only through `BookingTransitions.apply()` under the state machine; never set from a request               |
| Prices and totals           | Only computed by the API from the offer, pricing rules and the ledger                                     |
| Roles                       | Only `roles:manage` with step-up, never on one's own account                                              |
| Trust signal `verified`     | Only `trust-signals:verify` with an https evidence URL; any edit clears it                                |
| Markups, fees, Prime plans  | Only `pricing:manage` with step-up                                                                        |
| Refund approval             | Only `refunds:approve` with step-up, and never by the staff member who requested the refund               |
| Catalog and content records | The merged record is re-validated with the public schema (`checkMerged`); changed field names are audited |

**State.** Some rights depend on the record's state:

- Self-cancellation follows the product's tiers. Visa assistance and memberships cannot be
  self-cancelled.
- Payment plans take no paid extras.
- Refunds never exceed what the source still holds.
- A booking held for a risk review is not fulfilled until finance approves it.

## Changing the rules

1. Add the permission to `PERMISSIONS` and the roles that hold it to `ROLE_PERMISSIONS`.
2. Declare it on the route. Admin routes also list their audit actions.
3. Add an admin console navigation entry whose permissions match the route.
4. Run the admin e2e matrix and audit suites; a new admin mutation needs a case in
   `admin-audit.e2e-spec.ts`.
5. Update this page if a data or field rule changed.
