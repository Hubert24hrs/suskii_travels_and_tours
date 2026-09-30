# ADR-020: Mobile app architecture, storage and offline access

- Status: Accepted
- Date: 2026-09-30
- Deciders: Claude Code (implementer), pending owner review

## Context

The spec asks for an Expo Router app with five tabs (Home, Trips, Deals, Prime, Account) on the
shared API client and schemas, native search, results and checkout, trips with documents available
offline, tokens in `expo-secure-store` and MMKV for non-sensitive cache, and OWASP MASVS as the
mobile baseline (no secrets in the app, screenshots blocked on payment and document screens,
sensitive state cleared on background).

## Decisions

1. **Navigation.** Expo Router with a root stack: `(tabs)` (Home, Trips, Deals, Prime, Account),
   then search results, hotel detail, checkout, trip detail, sign-in and registration as stack
   screens so the tab bar stays out of focused tasks. Typed routes are on.
2. **Data.** TanStack Query over the generated `openapi-fetch` client from `@suskii/api-client`
   (no hand-written request types). Every request sends `X-Suskii-Client: mobile-<platform>/<version>`
   so channel pricing and the payment return work. Writes that create bookings or payments send an
   `Idempotency-Key` from `expo-crypto`.
3. **Authentication.** Token transport: the API returns access and refresh tokens in the body;
   both live in `expo-secure-store` (Keychain with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, Android
   Keystore). The access token is kept in memory too; a 401 triggers one refresh (single flight,
   rotation with reuse detection on the API), then sign-out if that fails. Sign-out revokes the
   refresh token on the API before deleting local state.
4. **Guest bookings.** The booking access token from checkout is stored in the secure store under
   the booking id; the Trips tab lists the device's guest bookings alongside the account's.
5. **Cache.** Non-secret but personal data (trip summaries, booking details for offline viewing,
   recent searches) lives in an MMKV instance encrypted with a random 16-byte key kept in the
   secure store. Preferences (currency, locale) use a separate unencrypted instance. Android
   backups are disabled (`allowBackup: false`) so neither storage nor documents leave the device.
6. **Offline documents.** E-tickets and vouchers are downloaded with the booking's credentials to
   the app's private documents directory (`expo-file-system`), indexed in the encrypted cache and
   opened with the system share sheet (`expo-sharing`), so any PDF viewer works without network.
   Removing a trip deletes its files.
7. **MASVS controls.** Screenshots and screen recording are blocked on checkout, payment and
   document screens (`expo-screen-capture`, Android `FLAG_SECURE`); iOS app switcher snapshots are
   covered on those screens; passport fields are cleared when the app returns after more than five
   minutes in the background. No API secret is in the app: every supplier and payment call goes
   through the API, and CI scans the bundle (ADR-024).
8. **Copy and design.** All text comes from `@suskii/i18n` (a `mobile` namespace plus the shared
   booking, checkout and results namespaces); styling uses NativeWind with the design-token preset
   and `@suskii/ui-native` components.
9. **Scope.** Phone OTP, Google and Apple sign-in (Apple is mandatory on iOS once Google exists),
   saved payment methods and **in-app account deletion** belong to phase 9. Because the app lets
   people create an account, deletion is a hard prerequisite for any App Store submission
   (guideline 5.1.1(v)).

## Consequences

- MMKV is a native module outside Expo's bundled set; CI builds both platforms to catch
  incompatibilities. If it breaks, `expo-sqlite`'s key-value store with SQLCipher is the fallback.
- Development needs a development build (`expo-dev-client`), not Expo Go, because of the native
  modules (MMKV, app integrity).
