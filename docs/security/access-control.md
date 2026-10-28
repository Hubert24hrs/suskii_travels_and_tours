# Access control

The rules that decide who may call what, see which records, and read or write which fields
(ASVS V8.1). The API enforces all of them. The web, app and console only hide what a person
cannot use. Designs: ADR-007 (authorisation), ADR-015 (guest access), ADR-033 and ADR-034 (admin).

## Function level

- **Authenticated by default.** Every route needs a session unless it is marked `@Public()`.
  Public routes are search, catalog and content reads, sign-up and sign-in, guest checkout,
  webhooks, health probes, web-vitals beacons, AI trip search (`/v1/flights/natural-search`,
  which fills a form and reads nothing private; ADR-061), partner offers for a place, the
  sealed partner redirect (`/v1/go/{token}`) and network postbacks, which need the network's
  secret (ADR-070), published reviews (`/v1/reviews`, ADR-077), route facts, city hubs and
  airline pages (`/v1/deals/...`, priced fares only, ADR-080), the metasearch price API, which
  needs a partner key instead of a session, metasearch landings, which need a sealed deep
  link (`/v1/metasearch/...`, ADR-081), and starting a support conversation, which needs
  Turnstile or a device attestation without a session (`/v1/support/conversations`, ADR-083).
- **Permissions, not roles, in code.** Routes declare `@RequirePermissions(...)`. Admin routes
  declare `@AdminRoute(permission)`, which also requires a staff role, an MFA session, an
  allowlisted IP and, for cookies, an allowlisted origin. The riskiest admin mutations add
  `@StepUp()`.
- **One catalog.** `ROLE_PERMISSIONS` (`packages/shared/src/rbac.ts`) maps the nine roles
  (`customer`, `super_admin`, `operations`, `finance`, `support`, `content_manager`,
  `visa_officer`, and the Cars roles `driver` and `operator_agent`) to 25 permissions. The seed
  syncs it to the database for the console. Drivers and operator agents are not staff
  (`NON_STAFF_ROLES`): no console, no MFA requirement, and their routes also check the record
  (the driver assigned to a ride, the agent's operator) (ADR-049, ADR-050).
- **Switched-off products.** A disabled Cars product (`CARS_*_ENABLED`) answers 404 on all its
  routes, before authentication (`CarsFeatureGuard`).
  AI trip search with `AI_SEARCH_ENABLED` off answers 404 on its parse route; its status route
  says it is off. Partner offers with `PARTNER_OFFERS_ENABLED` off answer 404, and postbacks
  answer 404 while the network has no postback secret.
- **Checked automatically.** The OpenAPI build fails for an admin route without a permission or
  audit list. `admin-matrix.e2e-spec.ts` calls every admin route as every role and expects 403
  unless the role holds the permission. Denials are audited (`rbac.access_denied`) or logged
  (`authorization denied`).
- **Internal routes** (`/v1/internal`) accept only the worker's service token. Behind
  Cloudflare the edge also blocks them, and blocks the console and `/v1/admin` from addresses
  outside `admin_allowed_ips` (ADR-059).
- **Database roles.** The API connects as `suskii_app`, which may only read and write rows;
  migrations run as the schema owner from the migrate job only (`apps/api/src/infra/app-role.ts`,
  ADR-059). A SQL injection could not change the schema, truncate tables or create roles.
- **The first super admin.** Roles change only in the console (step-up, audited), which needs a
  super admin. A new environment gets its first one from `staff:bootstrap` (the `ops` job in a
  deployed environment): it grants `super_admin` to an existing account with a verified email,
  records `rbac.roles.changed` as a system action, signs the account out, and refuses once any
  super admin exists (`test/staff-bootstrap.e2e-spec.ts`). `SEED_ADMIN_*` stays local only.

## Data level

| Resource                                                                                         | Who may access it                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bookings, their documents, payments, refunds                                                     | The owner's session, or a guest holding the booking token (`X-Booking-Token`, an HMAC lookup). Staff with `bookings:read`                                                                                                                                                                                                                                               |
| Saved travellers, price alerts, sessions, devices, notifications, wallet, memberships, referrals | Their owner only                                                                                                                                                                                                                                                                                                                                                        |
| Visa applications                                                                                | The owner; staff with `visa:process`                                                                                                                                                                                                                                                                                                                                    |
| Visa document content                                                                            | Only through a signed link issued to the owner or an officer, valid for 5 minutes, and audited                                                                                                                                                                                                                                                                          |
| Add-on purchase for an existing booking                                                          | A short-lived signed link, or the booking reference with the lead passenger's surname (rate limited)                                                                                                                                                                                                                                                                    |
| Partner offers for a booking (`/v1/bookings/{id}/partner-offers`)                                | As the booking: the owner's session or the guest's booking token; 404 for anyone else. The offers' links carry the viewer sealed, never readable                                                                                                                                                                                                                        |
| Reviews of a booking (`/v1/bookings/{id}/reviews`, `.../items/{itemId}/review`)                  | As the booking: the owner's session or the guest's booking token; 404 for anyone else. Written only for a finished, confirmed item (ADR-077)                                                                                                                                                                                                                            |
| Review moderation (`/v1/admin/reviews`)                                                          | Staff with `reviews:moderate` (content managers, support, super admins); publish and reject audited; nobody edits a traveller's words                                                                                                                                                                                                                                   |
| Company account (`/v1/me/company/*`)                                                             | The caller's own company only (no company id in the path; member, invitation and booking ids answer 404 outside it). Admins: details, policy, members; admins and approvers: approvals and reports; never one's own trip (ADR-078)                                                                                                                                      |
| Company wallet (`/v1/me/company/wallet*`, `useCompanyWallet` at payment)                         | Admins and approvers see the balance, movements and top-ups; only admins of an active company start a top-up, and the payment page is shown only to the admin who started it; only the booker of a company trip, while still a member of the active company, pays it from the wallet, and the booking's payment options say only whether the wallet covers it (ADR-090) |
| Companies in the console (`/v1/admin/companies`)                                                 | Staff with `users:read` view; `users:manage` (super admins) suspends with step-up and reinstates; both audited                                                                                                                                                                                                                                                          |
| Support conversations (`/v1/support/conversations/*`)                                            | The account's own, or a guest's with its access token or emailed link token (`X-Support-Token`); 404 for anyone else. A conversation about a booking needs access to that booking (owner session or booking token) (ADR-083)                                                                                                                                            |
| Support inbox (`/v1/admin/support`)                                                              | Staff with `support:manage` (support staff, super admins); replies, notes and changes audited; internal notes never reach the traveller; only active staff holding `support:manage` can be assigned                                                                                                                                                                     |
| Status page incidents (`/v1/admin/status/incidents`)                                             | Staff with `status:manage` (operations, support, super admins); open, update and resolve are audited with names only; resolved incidents take no updates. `GET /v1/status` is public and carries no personal data                                                                                                                                                       |
| WhatsApp webhook (`/v1/webhooks/whatsapp`)                                                       | Meta only: the verify token for the handshake, the app secret's signature on every delivery; replies to WhatsApp conversations go out only from the console (`support:manage`), never internal notes (ADR-084)                                                                                                                                                          |
| Bus seat holds                                                                                   | The account that made it, or a guest with its hold token (an HMAC lookup); 404 for anyone else                                                                                                                                                                                                                                                                          |
| Bus manifests and ticket scans                                                                   | Operator agents (`tickets:scan`) of the departure's own operator; other agents get 404 or `not_found`                                                                                                                                                                                                                                                                   |
| Bus inventory (operators, terminals, routes, layouts, departures, agents)                        | Staff with `ground:manage`                                                                                                                                                                                                                                                                                                                                              |
| Rides (live view, PIN, cancel, rate, share, SOS)                                                 | The rider's account only (rides need an account); SOS also the assigned driver; 404 for anyone else                                                                                                                                                                                                                                                                     |
| Ride socket subscriptions (`/v1/ws/rides`)                                                       | The rider, the assigned driver, or a driver holding an open offer; anything else answers `not_found`                                                                                                                                                                                                                                                                    |
| Live-trip links (`/v1/public/trips/{token}`)                                                     | Anyone with the 128-bit token until 30 minutes after the trip; driver first name, vehicle and a rounded position only                                                                                                                                                                                                                                                   |
| Ride offers and driver ride actions                                                              | Drivers (`driving`) with the offer or the assignment; other drivers get 404                                                                                                                                                                                                                                                                                             |
| Driver profile, documents, vehicles, payout account                                              | The applicant; payout changes need a recent sign-in. Staff with `drivers:review` (every document read audited)                                                                                                                                                                                                                                                          |
| Fare rules and ride places                                                                       | Staff with `ground:manage`                                                                                                                                                                                                                                                                                                                                              |
| Live ride board, staff ride stops, safety incidents                                              | Staff with `safety:manage` (operations, support)                                                                                                                                                                                                                                                                                                                        |
| Rental reservations and licences                                                                 | The renter's account only (rentals need an account); 404 for anyone else                                                                                                                                                                                                                                                                                                |
| Rental fleet, licence review, handover photos, check-out and check-in, deposit release           | Staff with `ground:manage`; licence and photo reads audited                                                                                                                                                                                                                                                                                                             |
| Ledger reconciliation discrepancies, driver payout list                                          | Staff with `finance:reconcile` (finance, super admins); resolutions audited; payouts listed without bank details                                                                                                                                                                                                                                                        |
| Accounts                                                                                         | The owner; staff with `users:read` (view) or `users:manage` (disable, sign out, reset MFA)                                                                                                                                                                                                                                                                              |
| Audit log, dashboards, partner commission summary                                                | Staff with `audit:read` or `reports:read`                                                                                                                                                                                                                                                                                                                               |
| Metasearch partners (`/v1/admin/metasearch/partners`)                                            | Staff with `reports:read` see partners and the 30-day report (key hint only); `pricing:manage` adds partners and replaces keys with step-up, and changes limits or access; all audited                                                                                                                                                                                  |

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

| Field or change                       | Rule                                                                                                      |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Booking status                        | Only through `BookingTransitions.apply()` under the state machine; never set from a request               |
| Prices and totals                     | Only computed by the API from the offer, pricing rules and the ledger                                     |
| Roles                                 | Only `roles:manage` with step-up, never on one's own account                                              |
| Trust signal `verified`               | Only `trust-signals:verify` with an https evidence URL; any edit clears it                                |
| Markups, fees, tax rules, Prime plans | Only `pricing:manage` with step-up; a `full` tax rule on Cars is refused while `CARS_VAT_BPS` is set      |
| Refund approval                       | Only `refunds:approve` with step-up, and never by the staff member who requested the refund               |
| Catalog and content records           | The merged record is re-validated with the public schema (`checkMerged`); changed field names are audited |

**State.** Some rights depend on the record's state:

- Self-cancellation follows the product's tiers. Visa assistance and memberships cannot be
  self-cancelled.
- Payment plans take no paid extras.
- Refunds never exceed what the source still holds.
- A booking held for a risk review is not fulfilled until finance approves it.
- The full refund for an airline change (ADR-073) is open only on a confirmed flight with an
  open, significant change, before departure. The airline cancels first, and the refund is
  taken online only when the airline's refund covers what we paid it; otherwise support takes it.

## Changing the rules

1. Add the permission to `PERMISSIONS` and the roles that hold it to `ROLE_PERMISSIONS`.
2. Declare it on the route. Admin routes also list their audit actions.
3. Add an admin console navigation entry whose permissions match the route.
4. Run the admin e2e matrix and audit suites; a new admin mutation needs a case in
   `admin-audit.e2e-spec.ts`.
5. Update this page if a data or field rule changed.
