# Store listing checklist (App Store and Google Play)

What each store needs before the first submission, what already exists in the repository, and
what only the owner can provide. The privacy forms are in [data-safety.md](data-safety.md); the
build and submission pipeline is in ADR-060 (`mobile-release.yml`).

Status: **Ready** (in the repository), **Owner** (needs an account, a decision or an asset only
the owner has), **Before submission** (a task once the owner items exist).

## Accounts and identifiers

| Item                                            | Status | Notes                                                                                                                      |
| ----------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------- |
| Apple Developer Program (organisation)          | Owner  | Enrolled as the legal entity, so the seller name is the company (needs a D-U-N-S number)                                   |
| Google Play Console (organisation)              | Owner  | Organisation account with verified details; new personal accounts must run a closed test with 12 testers for 14 days first |
| Expo account and EAS project                    | Owner  | `EXPO_TOKEN` secret and `EAS_PROJECT_ID` variable in GitHub                                                                |
| Bundle id / application id                      | Owner  | Placeholder `com.suskii.travels`; it cannot change after the first upload                                                  |
| App Store Connect app record and `ascAppId`     | Owner  | Create the app, then put its id in `apps/mobile/eas.json` (`submit.production.ios.ascAppId`)                               |
| App Store Connect API key, Play service account | Owner  | Uploaded to EAS credentials (`eas credentials`), never to the repository                                                   |
| Signing keys                                    | Ready  | EAS-managed (ADR-024); Play App Signing on                                                                                 |

## Listing content

| Item                        | Limit               | Status            | Notes                                                                                                                   |
| --------------------------- | ------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| App name                    | 30 (iOS), 30 (Play) | Ready             | "Suskii Travels" (`app.config.ts`)                                                                                      |
| Subtitle (iOS)              | 30                  | Before submission | Draft: "Flights, hotels, buses, rides"                                                                                  |
| Short description (Play)    | 80                  | Before submission | Draft: "Book flights, hotels, tours, buses and rides in naira, and pay your way."                                       |
| Full description (Play)     | 4000                | Before submission | From the website's homepage copy; no claims about accreditation or traveller counts until verified (trust signals rule) |
| Promotional text (iOS)      | 170                 | Before submission |                                                                                                                         |
| Keywords (iOS)              | 100                 | Before submission | Comma-separated; no competitor names (never Wakanow)                                                                    |
| Category                    | —                   | Ready             | Travel (both stores); secondary: Navigation (iOS, for rides) optional                                                   |
| Support URL, marketing URL  | —                   | Owner             | Support contact is an open question                                                                                     |
| Privacy policy URL          | —                   | Owner             | The legal text is an open question; the page must exist on the website before submission                                |
| Account deletion URL (Play) | —                   | Ready             | `https://<web host>/account/privacy` (sign in, then delete); the app has in-app deletion (phase 9)                      |
| Copyright, seller name      | —                   | Owner             | The legal entity                                                                                                        |

## Visual assets

| Asset                              | Spec                                                          | Status            | Notes                                                            |
| ---------------------------------- | ------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------- |
| App icon (iOS)                     | 1024 x 1024 PNG, no transparency, no rounded corners          | Owner             | Brand assets are an open question                                |
| App icon (Play)                    | 512 x 512 PNG, 32-bit, up to 1 MB                             | Owner             |                                                                  |
| Adaptive icon (Android)            | Foreground and background layers, 108 dp with 72 dp safe zone | Owner             | `app.config.ts` `android.adaptiveIcon`                           |
| Splash screen                      | Icon on the brand background                                  | Owner             | `expo-splash-screen` config                                      |
| Feature graphic (Play)             | 1024 x 500 JPG or PNG                                         | Owner             |                                                                  |
| iPhone screenshots                 | 6.9" (1320 x 2868) required; 3 to 10                          | Before submission | From the production build on real data or clearly marked samples |
| iPad screenshots                   | 13" (2064 x 2752) required because `supportsTablet: true`     | Before submission | Or set `supportsTablet: false` before the first upload           |
| Play phone screenshots             | 2 to 8, 16:9 or 9:16, 1080 px wide recommended                | Before submission |                                                                  |
| Play 7" and 10" tablet screenshots | Optional (needed for tablet featuring)                        | Before submission |                                                                  |
| Preview video                      | Optional                                                      | Owner             |                                                                  |

Screenshots should show the main journeys:

- search and results;
- checkout with the price breakdown and flexible payment;
- the trip screen with an offline ticket;
- a bus seat map;
- requesting a ride;
- Suskii Prime.

Sample inventory (`db:seed:demo`) shows a "Sample" badge, which is fine in screenshots only if
clearly a demo; prefer real inventory.

## Review and compliance

| Item                                 | Status            | Notes                                                                                                                                                                                                                                                                         |
| ------------------------------------ | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Privacy forms                        | Ready             | [data-safety.md](data-safety.md); the owner and counsel confirm before submitting                                                                                                                                                                                             |
| Content rating (IARC, App Store age) | Before submission | Expected 4+ / Everyone: no violence, no gambling. Answer "yes" to location sharing with other users (riders and drivers) and to user-generated content (ratings comments, moderated by staff)                                                                                 |
| Export compliance (encryption)       | Ready             | `usesNonExemptEncryption: false`: HTTPS, Keychain/Keystore, encrypted local storage and signature checks only, which are exempt. The owner confirms                                                                                                                           |
| App review demo account              | Before submission | A staging-like account on production with a sample booking; credentials go in App Store Connect and Play's app access form, never in the repository                                                                                                                           |
| Sign in with Apple                   | Ready             | Not required: the app offers email, password and texted codes only, no third-party sign-in                                                                                                                                                                                    |
| Payments                             | Ready             | Travel bookings and Prime are paid through the payment providers' hosted checkout, which both stores allow for physical goods and services. **Owner/counsel:** confirm Suskii Prime counts as a travel service benefit, not digital content; if not, it needs in-app purchase |
| Push notifications permission timing | Ready             | Asked only after a booking or from Account (ADR-022)                                                                                                                                                                                                                          |
| Camera permission text               | Ready             | "Allow Suskii Travels to use the camera to scan boarding pass QR codes." (operator agents only)                                                                                                                                                                               |
| Location permission                  | Ready             | The app does not request device location. Pick-up points are chosen on screen; device location for drivers is a backlog item, and adding it changes the privacy forms                                                                                                         |
| Minimum OS versions                  | Ready             | Android 7 (API 24) and iOS 15.1, accepted in ADR-048                                                                                                                                                                                                                          |
| Android target SDK                   | Before submission | Set by Expo SDK 57; check it against Play's target API requirement on the submission date                                                                                                                                                                                     |
| Accessibility                        | Before submission | Run `docs/runbooks/screen-reader-checklist.md` on real devices                                                                                                                                                                                                                |
| Store test tracks                    | Ready             | `mobile-v*` tags submit to TestFlight and the Play internal track (draft) through EAS Submit                                                                                                                                                                                  |

## Release sequence

1. **Owner items.** Complete everything marked Owner above, and the open questions in
   CLAUDE.md that production needs (providers, legal texts).
2. **Production settings.** Set the production profile's EAS environment variables: https API
   and web URLs, Play Integrity project, Sentry DSN.
3. **Store builds.** Tag `mobile-v0.1.0`. EAS builds and submits to TestFlight and the Play
   internal track.
4. **Internal testing.** Test on devices, including the screen reader checklist and a real
   payment in each currency the launch supports.
5. **Store records.** Fill in the listings, the privacy forms, the content rating and the review
   account, then submit for review.
6. **Rollout.** Play: production with a staged rollout starting at 10%. iOS: phased release over
   7 days.
