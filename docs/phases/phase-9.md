# Phase 9: Accounts, Suskii Prime, referrals, notifications

Status: done, awaiting review

## Goal

Give travellers a real account on the web and in the app: profile, preferences, saved travellers,
trips, device sessions, and their data rights (export and deletion); Suskii Prime memberships
whose benefits change prices; referrals that reward real new customers and resist abuse; price
alerts; and one notification layer that honours each traveller's channel preferences across
email, SMS, WhatsApp and push.

## Acceptance criteria (from PROJECT_SPEC.json)

1. Prime pricing benefits are covered by tests.
2. A data subject access request (DSAR) export returns all of a user's data; deletion anonymises
   the account while retaining the financial records the law requires.

## What exists already

Phases 2 to 7 built sign-up, password and OTP sign-in, Google and Apple sign-in (API), MFA,
sessions with revocation, saved travellers, the wallet and its ledger, push tokens, account trips
(`/v1/me/bookings`) and the app's Account tab. Pricing rules already match a `userTier`
(`guest`, `member`, `prime`), but nothing assigns `prime` yet (ADR-008). The web has no sign-in.

## Scope decisions

- **Data rights (ADR-029).** Every database model declares how DSAR treats it (exported, erased,
  retained as a financial record, or holds no personal data) in one registry; a test fails when a
  model is added without a declaration, so the export cannot silently miss new data. The export is
  a JSON document, assembled from the registry, downloaded as an attachment after a fresh
  re-authentication. Deletion also needs re-authentication, is refused while the account has
  trips in progress, money owed or a wallet balance, and then anonymises: profile, identities,
  sessions, factors, travellers, tokens, preferences, alerts and referral codes are erased;
  bookings, payments, refunds and ledger entries stay as financial records with contact details
  and passport numbers removed. Retention periods are an owner decision
  (`FINANCIAL_RECORDS_RETENTION_YEARS`, recorded, purged in phase 11).
- **Suskii Prime (ADR-030).** Plans (name, period, price per currency, benefits) are managed
  through admin routes and start empty in production; the demo seed adds a sample plan. Buying a
  membership is a booking of a new `prime` vertical on the one pipeline (hosted checkout,
  webhooks, ledger, refunds), fulfilled by creating or extending the membership. An active member
  prices as tier `prime`: pricing rules can target the tier (member-only fares), and plan benefits
  apply in the pricing engine (a share of the markup back, never below supplier cost, and waived
  fees by code). The tier travels in the access token for searches and is re-read from the
  database for quotes and bookings. Memberships do not renew automatically until stored-card
  mandates exist (ADR-018): members are reminded before expiry and buy again.
- **Referrals (ADR-031).** Each account gets a referral code; a new account can be attributed to a
  code at sign-up. The referral qualifies on the referee's first completed trip (spec) and then
  credits both wallets through the ledger; reward amounts come from configuration and default to
  zero (no invented business facts), so referrals are tracked but unpaid until the owner sets
  them. Fraud checks: self-referral by email, phone, device or payment fingerprint (HMACs),
  shared network within a window, disposable email domains, monthly caps per referrer and reward
  velocity; anything suspicious waits for staff review instead of paying out.
- **Notifications (ADR-032).** One `NotificationService` sends by category (booking updates,
  payments, trip reminders, price alerts, Prime, marketing) over the channels the user allows:
  email, SMS, WhatsApp (new provider interface with a mock adapter) and push. Transactional
  email cannot be turned off; marketing is opt-in. New: check-in reminders and price alerts.
- **Price alerts (ADR-032).** Signed-in travellers watch a flight route for a departure date or
  month, optionally with a target price; the worker re-checks alerts on a schedule through an
  internal route, notifies when the price is at or below the target or has dropped since the last
  check, at most once a day per alert, and retires alerts after the travel date.
- **Web accounts.** Sign-in (password, OTP by email or SMS, MFA), registration with an optional
  referral code, email verification and password reset, and an account area: profile and
  preferences, notification settings, trips, travellers, security (password, MFA, sessions),
  Prime, referrals, price alerts, and privacy (export and delete).
- **Mobile.** Phone OTP sign-in, profile and preferences, notification settings, device sessions,
  data export and account deletion (required before store release), Prime purchase, the referral
  code with the share sheet, and price alerts from flight results.
- **Deferred with reasons:** saved payment methods (needs provider test keys and the stored-card
  mandate decision, ADR-018); Google and Apple sign-in buttons (need the owner's OAuth client
  ids; the API already supports them); the admin screens for plans, referrals and users (phase
  10, API routes now); flight schedule-change notices (need supplier order webhooks).

## Plan

### Shared and i18n

- Prime benefit maths (markup share, fee waivers) with property tests; notification categories,
  channels and defaults; referral code format; price alert schemas; copy for every new page,
  email, SMS, WhatsApp and push message.

### API

- Migration 9: `user_preferences`, `notification_preferences`, `prime_plans`,
  `prime_memberships`, `referral_codes`, `referrals`, `price_alerts`, `notifications` (delivery
  log, reference ids only); `Vertical` gains `prime`; booking item kind `membership`; account
  deletion fields on `users`.
- Accounts: preferences and notification settings routes; `GET /v1/me/data-export` and
  `POST /v1/me/deletion` with re-authentication; the DSAR registry and its coverage test.
- Prime: public plans; admin plan routes (`prime:manage`); membership quotes into the booking
  pipeline; fulfilment and expiry; tier claim in access tokens; benefits in the pricing engine.
- Referrals: code per account, attribution at registration, qualification on the first completed
  trip, fraud checks, rewards through the ledger, admin review routes.
- Price alerts: CRUD for the owner, internal check route.
- `NotificationService` with `WhatsAppProvider` (mock), preference checks and a delivery log;
  check-in reminders and Prime expiry reminders through internal routes.

### Worker

- Price alert checks, check-in reminders, Prime expiry and referral qualification sweeps.

### Web

- `/sign-in`, `/register`, `/verify-email`, `/reset-password`, `/account/*`, `/prime`; a price
  alert button on flight results; Sign in / Account in the header; the homepage Prime block shows
  the live plan price.

### Mobile

- Sign-in with a phone code, Account screens (profile, notifications, sessions, privacy), Prime
  purchase, referrals, price alerts.

## Tests

- Unit: Prime benefit maths (never below supplier cost, never above the markup, fee waivers),
  tier resolution, notification routing by preference, referral fraud rules, alert triggers.
- API e2e: member versus non-member prices on every vertical; membership purchase to an active
  tier; DSAR export contents for a user with bookings, travellers, alerts, referrals and a
  membership; deletion anonymises and keeps financial records; deletion refused with a trip in
  progress or a wallet balance; referral rewards and fraud review; price alert notification.
- Web Playwright: sign-in, account pages, Prime purchase, export and deletion.
- Mobile Jest: account screens, Prime, referrals, alerts.

## Risks and mitigations

- **Silent gaps in the export.** Mitigation: the registry coverage test over every model.
- **Pricing mistakes for members.** Mitigation: benefits capped by the markup (never below cost),
  property tests, and booking prices re-read the tier from the database.
- **Referral abuse.** Mitigation: rewards default to zero, HMAC fingerprints, caps, review queue.
- **Notification fatigue and consent.** Mitigation: per-category preferences, marketing opt-in,
  daily caps on alerts.

## Outcome

### Acceptance criteria

1. **Prime pricing benefits are covered by tests.**
   - Unit (`pricing-engine.spec.ts`): the markup share comes back and listed fees are waived, the
     saving equals the difference from the non-member price, benefits do nothing without the
     `prime` tier, member-only rules count as savings, promos apply after member pricing, and a
     property test shows a member is never priced below the supplier cost whatever the plan.
     Flights, hotels and in-house items all pass the account's benefits to the same engine.
   - API e2e (`prime.e2e-spec.ts`): only published plans sell, in their currencies; a membership
     is bought through the booking pipeline and a second purchase extends from the current end;
     after sign-in refresh the member's fare is lower, the service fee is gone and the quote and
     checkout carry the same `memberSaving`.
   - Web Playwright and mobile Jest: joining the sample plan through checkout and the mock
     payment, the term on the booking and account pages.
2. **DSAR export returns all user data; deletion anonymises and keeps financial records.**
   - The registry (`data-registry.ts`) declares a section and a deletion treatment for every
     model; compilation and `data-registry.spec.ts` fail on a missing one.
   - API e2e (`accounts.e2e-spec.ts`): the export needs fresh proof (password, MFA, a texted code
     for phone accounts), has exactly the registry's sections for an account with a booking,
     payment, traveller, alert, referral, membership and preferences, and holds no credential,
     hash or supplier cost. Deletion is refused with an upcoming trip, a wallet balance or a
     staff role; otherwise it signs out everywhere, erases the profile, identities, factors,
     travellers, tokens, preferences, alerts and referral codes, and keeps the booking, payment,
     refund and ledger rows with redacted contacts and passports.
   - Web Playwright (`e2e/account.spec.ts`): the export downloads as JSON with every section, and
     a deleted account can no longer sign in. Mobile Jest: export through the share sheet with
     the cache copy deleted, blockers, deletion and local sign-out.

### Deviations from the plan

- **The export is `POST /v1/me/data-export`**, not GET: the re-authentication proof travels in
  the body (ADR-029 notes).
- **Card fingerprints** for referral checks are not built: payment rows keep none and the mock
  provider has none to give. The other signals (email alias, the referrer's own network, shared
  network or device, disposable domains, monthly cap) are in place (ADR-031).
- **No Maestro flow** for the account screens: they are covered by Jest; the emulator flows stay
  the booking critical path and offline trip.
- **Push paths**: the price alert push now opens `/account/alerts`, and the app follows a few
  fixed account screens besides trips (ADR-032 notes).
- **Export test widened at the end of the phase** to an account with a price alert, a referral
  code and a membership. It caught membership benefits exported with the internal markup share;
  the export now shows the public view (`benefitsView()`), like the plan and booking pages.
- **Small shared fixes found on the way**: unnamed form fields on the profile and Prime forms
  (caught by the console guard), Tailwind classes outside the token scale, and the native toast
  timer that outlived its provider.
