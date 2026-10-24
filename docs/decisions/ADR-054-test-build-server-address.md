# ADR-054: Server address in the Android test build

- Status: Accepted
- Date: 2026-10-24
- Deciders: Claude Code (implementer), pending owner review

## Context

The sideloadable test APK (`mobile-test-apk.yml`, ADR-024) bakes the API and website addresses
into the bundle (`EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_WEB_BASE_URL`). There is no hosted
environment yet (phase 12), so a tester's phone can only reach a stack on their own computer, at
an address on their Wi-Fi network that is different for every tester and network. A build per
address is slow (about 30 minutes) and makes the published APK useless to everyone else.

## Decision

1. **Test builds only.** The `e2e` variant (the test APK and the Maestro build, which already
   allow plain http and mock attestation) reads an optional server address from `preferences` at
   start (`src/lib/test-server.ts`). `appConfig` ignores it in every other variant, so builds for
   the stores cannot be pointed elsewhere.
2. **Origins only.** The tester enters the API and website origins under Account, Test server.
   Only `http` or `https` with a host and an optional port is accepted: no path, query or
   credentials. The value is a setting, not a secret, so it lives in `preferences` (not
   encrypted), and nothing personal is attached to it.
3. **Applies at the next start.** `appConfig` is read once; the API client, deep links and the
   payment return are built from it. The screen says to close and reopen the app instead of
   rebuilding clients at runtime.
4. **The stack serves the phone.** `pnpm --filter @suskii/web e2e:stack` with
   `E2E_PUBLIC_WEB_URL` and a website built with `NEXT_PUBLIC_API_BASE_URL` set to the computer's
   network address gives the phone everything (seeded catalog, mock payments). Steps are in the
   README.

## Consequences

- One published APK works with any tester's stack; the CI build is unchanged (`localhost` through
  `adb reverse` until a tester saves an address).
- Someone holding an unlocked test phone could point the test app at another server. The test
  build carries no production data or credentials and is labelled not for production, so this is
  accepted for the test variant only.
- When a hosted test environment exists (phase 12), its address becomes the build default and
  this setting stays for local stacks.
