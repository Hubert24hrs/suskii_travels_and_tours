# Phase 7: Mobile app

Status: done, awaiting review (EAS builds blocked on owner accounts)

## Goal

Ship the Expo app for iOS and Android on the same API, schemas, tokens and copy as the web: tabs
for Home, Trips, Deals, Prime and Account; native flight and hotel search, results and checkout
with payment on the provider's hosted page; trips with their documents available offline; push
notifications, validated deep links, secure storage and device attestation hooks; and EAS build
profiles for development, preview and production.

## Acceptance criteria (from PROJECT_SPEC.json)

1. Maestro critical path passes on an Android emulator.
2. EAS preview builds succeed for iOS and Android.
3. No secrets in the bundle (scan).

## Scope decisions

- **Verticals**: flights (one-way, return, multi-city) and hotels, like the web. Packages, tours,
  visa and add-ons are phase 8 on both clients.
- **Accounts**: email and password sign-in, registration, MFA (TOTP or recovery code), password
  reset request and sign-out, with tokens in `expo-secure-store` (token transport, which the API
  already supports). Phone OTP, Google and Apple sign-in, saved payment methods and account
  deletion are phase 9; account deletion must ship before any store release because the app lets
  people create accounts (ADR-020).
- **Prime tab**: memberships are phase 9 and pricing is an open owner question, so the tab says
  Prime is coming and lists only the benefits the spec names, with no price or dates.
- **Payments** open the provider's hosted checkout in the system browser sheet (ASWebAuthenticationSession
  or Chrome Custom Tabs, never an in-app WebView). The provider returns to a small web page that
  hands control back to the app, and the booking screen polls; webhooks stay the source of truth
  (ADR-021).
- **Guest checkout** on mobile replaces Turnstile, which native apps cannot show, with a device
  attestation (Play Integrity or App Attest) verified by the API. The `X-Suskii-Client` header
  alone never skips the bot check. Real verifiers need the owner's Google Cloud and Apple
  accounts; until then only the mock verifier exists and production refuses it (ADR-023).
- **Offline**: trips and booking details are cached encrypted (MMKV, key in the secure store),
  documents are saved to app-private storage and open through the system share sheet.
- **Push**: Expo push service behind a `PushProvider` interface; account devices are tied to their
  session, guest devices to the booking (ADR-022).
- **EAS**: `eas.json` profiles and a release workflow are committed, but EAS builds need the
  owner's Expo account (project id, `EXPO_TOKEN`) and Apple and Google developer accounts. CI
  proves the native projects compile instead: an Android release build (used by Maestro) and an
  iOS simulator build on macOS (ADR-024).

## Plan

### API (`apps/api`)

- `GET /v1/me/bookings`: the signed-in user's trips as summaries (route or hotel, dates, status,
  total), newest first, cursor pagination.
- Push: migration 6 adds `push_tokens` (token encrypted with a record-bound context, HMAC for
  lookup, scope `user` with the session id, or `booking`); `PUT` and `DELETE /v1/me/push-token`,
  `PUT /v1/bookings/{id}/push-token`; `PushProvider` with `ExpoPushProvider` and
  `MockPushProvider`; pushes for booking confirmed, payment due, refund updates and failed
  bookings, with no personal data in the text; dead tokens removed.
- Attestation: `POST /v1/attestation/challenges`, single-use challenges in Redis,
  `DeviceAttestationVerifier` with `MockDeviceAttestationVerifier`, the `X-Suskii-Attestation`
  header, `ATTESTATION_MODE` (off, report, enforce) for login, registration and payment start on
  mobile, and attestation as the guest bot check on mobile.
- Mobile payments return to `WEB_APP_URL/mobile/payment-return?booking={id}`.

### Web (`apps/web`)

- `/.well-known/assetlinks.json` and `/.well-known/apple-app-site-association` from environment
  values (404 when unset), `/mobile/payment-return` (noindex) that opens the app.

### Mobile (`apps/mobile`)

- `app.config.ts` with variants (development, preview, production, e2e), bundle ids from the
  environment, `https` enforced outside development and e2e, Android backups off, app links and
  associated domains when a web host is set; `eas.json`; EAS Update with fingerprint runtime
  versions.
- Providers: TanStack Query, typed API client with bearer tokens and refresh rotation, i18n,
  toasts; secure store and encrypted cache; `+native-intent` allowlist for deep links.
- Screens: tabs (Home, Trips, Deals, Prime, Account); flight and hotel search; results with
  FlashList, filters and sort; hotel rooms; checkout (travellers, passport, contact, payment plan
  and method, terms); trip detail with plan, refunds and offline documents; sign-in, registration
  and MFA.
- Security: screenshots blocked on payment and document screens, app switcher protection on iOS,
  passport fields cleared after five minutes in the background.
- Scripts: bundle secret scan over `expo export` output.

### CI (`.github/workflows`)

- `mobile.yml`: Android release build and Maestro critical path on an emulator against the built
  API, worker and web; APK secret scan; iOS simulator build on macOS.
- `mobile-release.yml`: EAS preview and production builds when `EXPO_TOKEN` is configured.
- `ci.yml`: bundle secret scan after the mobile export.

## Tests

- Jest (mobile): deep link allowlist, auth token storage and refresh, encrypted cache, attestation
  client, search form to request mapping, key screens with React Native Testing Library.
- API unit and e2e: trips list and ownership, push token registration and delivery, dead tokens,
  attestation challenges (single use, expiry, binding), mobile guest checkout with and without
  attestation, mobile return URL.
- Maestro (Android emulator): search, results, checkout, hosted mock payment, confirmed trip, and
  the e-ticket opened offline.
- Bundle secret scan with a planted-secret test.

## Risks and mitigations

- **No emulator in the development container.** Mitigation: Maestro runs in GitHub Actions on a
  KVM-enabled runner; the flows use stable test ids and wait on states, not timings.
- **EAS needs owner accounts.** Mitigation: CI builds both native projects without EAS; the EAS
  workflow is ready and fails with a clear message until `EXPO_TOKEN` exists.
- **Custom Tabs and custom schemes.** Chrome may block an automatic jump to the app; the return
  page also shows a button, and the app polls when the browser closes.
- **Native modules outside Expo's set (MMKV).** Mitigation: CI builds on both platforms catch
  incompatibilities early; `expo-sqlite` storage is the fallback.

## Outcome

### Acceptance criteria

1. **Maestro critical path on an Android emulator**: `mobile.yml` builds the `e2e` release APK,
   starts the e2e stack (mock attestation enforced for app requests) and runs
   `critical-path.yaml` (search Lagos to Abuja, guest checkout, hosted mock payment in a Chrome
   Custom Tab, confirmed trip, e-ticket saved) and `offline-trip.yaml` (trip and e-ticket
   reopened with the network cut) on an API 34 emulator. See the CI result in the phase report.
2. **EAS preview builds for iOS and Android**: blocked. `eas.json`, the variants and
   `mobile-release.yml` are ready, but EAS needs the owner's Expo account (`EXPO_TOKEN`,
   `EAS_PROJECT_ID`) and, for iOS, Apple credentials. Until then CI proves both native projects
   compile: the Android release build above and an unsigned iOS simulator build on macOS.
3. **No secrets in the bundle**: `scripts/scan-bundle.mjs` (credential formats, server secret
   setting names, secret values in the environment; self-test with planted secrets) passes on the
   exported bundle in `ci.yml`, on the APK (with Gitleaks) and the iOS app in `mobile.yml`, and
   runs before every EAS build.

### Deviations from the plan

- The mobile checkout offers no paid extra bags yet (the web does); travellers add bags on the
  web booking page. Paid extras also rule out payment plans, so the app keeps the simpler path.
- Maestro drives the stack through `adb reverse` on `localhost` instead of `10.0.2.2`: pages on
  `localhost` are a secure context (Web Crypto for idempotency keys), like production https.
  Airplane mode does not cut `adb reverse`, so the harness removes the route before the offline
  flow.
- Push delivery receipts from Expo are not polled yet; `DeviceNotRegistered` answers at send time
  remove dead tokens, and the daily prune covers the rest (phase 11 hardening).
- Phone OTP, Google and Apple sign-in, saved payment methods and account deletion stay in
  phase 9; account deletion must ship before any store release.
- Real Play Integrity and App Attest verifiers need the owner's Google Cloud and Apple accounts;
  only the mock verifier exists and production refuses it.
