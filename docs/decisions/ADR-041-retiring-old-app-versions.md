# ADR-041: Retiring old app versions

- Status: Accepted
- Date: 2026-10-06
- Deciders: Claude Code (implementer), pending owner review

## Context

OWASP MASVS-CODE-2 asks that an app enforce updating, so that a version with a known flaw can
be taken out of service. Store releases reach people slowly and some never update. The API
already knows the app version: every app request sends `X-Suskii-Client: mobile-<os>/<version>`
(ADR-020).

## Decisions

1. **One floor for both platforms.**
   - `MOBILE_MIN_VERSION` (for example `1.4.0`) is the oldest app version the API serves. It is
     unset by default, which serves every version.
   - Both platforms ship from one version number (`app.config.ts`), so one value is enough.
2. **The API refuses older apps on every route.**
   - `AppVersionGuard` is the first global guard. It runs before authentication, rate limits and
     validation, and answers `426 app-update-required` with `minVersion` in the problem details.
   - It only looks at mobile client ids. The website, the console, server clients and probes are
     never affected.
   - The value is read on each request, so changing it needs a restart but no rebuild.
   - Every operation in the OpenAPI document lists 426.
   - Choosing 426 Upgrade Required over 410 or 403 keeps the answer distinct from other refusals.
     The app can then react to the status alone, without parsing the body.
3. **The app shows only an update screen.**
   - Both API clients (the signed-in one and the bare one used to refresh) mark the app "update
     required" on any 426. The root layout then swaps the whole navigator for
     `UpdateRequiredScreen`, which makes no further API calls.
   - The screen opens the store listing: Google Play by package name on Android, and
     `EXPO_PUBLIC_IOS_APP_STORE_URL` on iOS (it must be an `apps.apple.com` link).
   - Without a known listing, the screen tells people to update from their app store.
   - Trips saved offline stay on the device. Opening them needs an updated app, which keeps
     the retired code from running.
4. **Not a substitute for fixing the API.** A floor stops honest old apps. A modified client can
   send any version string, so server-side checks still have to hold for every request.

## Consequences

- Operations can retire a broken release in minutes after the fixed version is live in both
  stores.
- Raise the floor only after the new version is approved and rolled out on both stores. Raising
  it too early locks out people whose store has not offered the update yet.
- Open for the owner: the App Store id (`EXPO_PUBLIC_IOS_APP_STORE_URL`) once the listing exists,
  and the release policy for raising the floor (for example two releases behind).
