# ADR-024: EAS builds, app variants and mobile CI

- Status: Accepted
- Date: 2026-09-30
- Deciders: Claude Code (implementer), pending owner review

## Context

iOS builds must go through EAS cloud runners (no local Xcode). The spec wants EAS Build with
development, preview and production profiles, EAS Submit, EAS Update channels per environment,
Maestro flows for the critical path and a scan proving the bundle holds no secrets. EAS needs an
Expo account and project id, and store builds need Apple and Google developer accounts, none of
which exist yet.

## Decisions

1. **Variants.** `app.config.ts` reads `APP_VARIANT` (`development`, `preview`, `production`,
   `e2e`). Bundle ids come from `APP_BUNDLE_ID` (placeholder default `com.suskii.travels`, an owner
   decision) with `.dev`, `.preview` and `.e2e` suffixes so variants install side by side. Only
   `development` and `e2e` may use a plain `http` API URL (Android cleartext allowed for those
   variants only); the config throws for any other variant without `https`.
2. **Profiles.** `eas.json`: `development` (development client, internal distribution),
   `preview` (internal distribution, Android APK, channel `preview`), `production` (store builds,
   remote version with auto increment, channel `production`). Each profile names its EAS
   environment, whose variables hold the public build values (`EXPO_PUBLIC_*`: https API and web
   URLs, Play Integrity project number); nothing secret is placed in the bundle. EAS Update uses
   the `fingerprint` runtime version policy so a JavaScript update never reaches a binary with
   different native code.
3. **Release workflow.** `.github/workflows/mobile-release.yml` runs EAS preview builds on demand
   and production builds on `mobile-v*` tags, and stops with a clear message when `EXPO_TOKEN` or
   `EAS_PROJECT_ID` is missing. It pulls the profile's EAS environment, exports the bundle and
   scans it before starting the EAS build. EAS workers build the app's workspace packages
   (design tokens, shared) through the `eas-build-post-install` hook, since their build output
   is not committed.
4. **CI without EAS.** `.github/workflows/mobile.yml` builds the native projects on GitHub's
   runners: an Android release APK (`expo prebuild` and Gradle, `e2e` variant) that the Maestro
   critical path drives on a KVM-accelerated emulator against the built API, worker and web; and
   an iOS simulator build on macOS (unsigned). This proves the native code compiles on both
   platforms until EAS credentials exist; it does not replace the EAS acceptance criterion.
   The emulator reaches the stack through `adb reverse` on `localhost`, so the hosted payment
   page runs in a secure context like production; the route is removed before the offline flow,
   because airplane mode does not cut `adb reverse`. The stack enforces (mock) device
   attestation for app requests (`E2E_ATTESTATION_MODE=enforce`).
5. **Secret scan.** `scripts/scan-bundle.mjs` scans the `expo export` output (JavaScript and
   Hermes bytecode) for known secret formats, private keys, JWTs, server environment variable
   names (taken from `.env.example`) and the values of those variables when set in the scanning
   environment; `--self-test` plants one example of each and fails unless all are reported. It
   runs in the main CI after the mobile export, on the release APK (alongside Gitleaks) and the
   iOS app in the mobile workflow, and before every EAS build.

## Consequences

- The acceptance criterion "EAS preview builds succeed for iOS and Android" cannot be met until
  the owner creates the Expo project and provides `EXPO_TOKEN`, plus Apple credentials for iOS.
- Emulator runs take about half an hour, so `mobile.yml` runs on changes to the app, its
  packages or the API, and on demand, not on every commit.
