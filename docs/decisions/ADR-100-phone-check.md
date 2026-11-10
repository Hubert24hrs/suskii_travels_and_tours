# ADR-100: Phone check, the test APK and the website against the online test server

- Status: Accepted
- Date: 2026-11-10
- Deciders: the owner (asked that the platform be tested end to end before they try it on their
  phone), Claude Code (implementer)
- Amends: ADR-024 (the test APK's packaging and when it is published), ADR-066 (what checks the
  online test server)

## Context

The owner tries the platform on a phone with two things: the test APK from a QR code
(`mobile-test-apk.yml`) and the online test server (`test-server.yml`, ADR-066 and ADR-092). Neither
was tested as the phone meets them:

- CI builds its own APK for the emulator's CPU and runs it against a stack on the same runner,
  reached through `adb reverse`. The published APK is a different file, built for phone CPUs, and
  nothing installed it before a person did.
- The test server checked four addresses with `curl` after starting. No journey ran through the
  tunnel: not the app finding the server from the published address, not a booking, not a payment
  that returns from the browser to the app.
- The combined trip (ADR-099) had unit tests in the app and a browser journey on the website,
  but no journey on a device.

So a broken download, a wrong address file, a server that only answers locally or a payment
return that fails on https would first be seen by the owner.

## Decision

### One check, run from the internet

`phone-check.yml` has three jobs, all against the address in `test-server.json`, the file the
app reads at launch:

1. **Find the server.** The address must be a running server with at least 30 minutes left that
   answers `/ready` from the runner. Otherwise the check stops and says how to start one.
2. **The app.** The APK is checked against its published SHA-256, installed on an Android
   emulator and run with Maestro (`apps/mobile/e2e/run-hosted.sh`). Nothing is routed to the
   runner, so the app has to find the server by itself (`hosted-server.yaml` reads the address it
   is using from Account). Then a guest books and pays for a flight (`critical-path.yaml`) and an
   account builds a combined trip of a flight, a hotel and travel insurance and pays for it once
   (`trip-builder.yaml`), returning from the hosted payment page to a paid trip whose parts are
   each confirmed.
3. **The website.** Playwright runs the journeys from `apps/web/e2e` that need only the public
   site (`E2E_BASE_URL`): a trip of all five parts paid once, a flight and a hotel.

Mock suppliers and payments only. The check leaves sample bookings on the test server, whose
data is thrown away with each run.

### The test APK is published only after the check

`mobile-test-apk.yml` now builds the APK, calls the check on that file (as a reusable workflow,
from the run's artifact) and replaces the `mobile-test-apk` pre-release only when it passes. The
QR code therefore never points at a file that has not started, found the server and paid for a
booking on an emulator. The check also runs by hand on the published file (Actions, Phone check,
Run workflow), for example when a tester reports that the app cannot reach the server.

A consequence: publishing needs a running test server. One starts every four hours (ADR-092);
the check names the workflow to start one sooner. `publish: false` builds and checks without
publishing, which is how a change to the build is tried on a branch.

### Compressed native libraries in the test APK

The first run failed at launch: the APK stored its native libraries uncompressed and loaded them
straight from the file, and on an x86_64 emulator React Native's loader then looks for x86_64
libraries inside the APK, where there are only phone (arm64, armv7) ones. The emulator's image
can run arm64 code through translation, but only from libraries unpacked at install.

The test APK is now built with `-Pexpo.useLegacyPackaging=true`: libraries are compressed in the
APK and unpacked when it is installed. For a tester the download is a little over half the size
(48 MB instead of 85 MB); the installed app takes more space. Store builds (EAS,
`mobile-release.yml`) are not changed.

Rejected:

- **Adding x86_64 libraries to the APK.** The emulator would then run code no phone runs, and
  every tester would download libraries only the check uses.
- **Checking a second APK built for the emulator.** That is what CI already does; the point is
  the file people download.
- **A device farm with real phones.** The lasting answer for device coverage, but it needs an
  account and a budget from the owner (see the open questions).

### The same journey in CI

`trip-builder.yaml` also runs in the Android job of `mobile.yml` on every pull request, against
the runner's own stack, so a change that breaks the trip builder on a device is caught before it
is merged. `device.sh` holds what the two runners share.

## Consequences

- What it proves: the published file installs and starts, reads the address file, reaches the
  server over the internet, and completes a flight booking and a combined trip including the
  browser hand-off for payment and the return to the app; and the website does the same journeys
  from outside.
- What it does not prove: an emulator is not a phone. There is no vendor skin, no mobile network,
  no fingerprint reader and no real GPU, and translated code is slower than a phone's. The
  screen reader pass and one check on a real mid-range phone (ADR-075, ADR-088) stay with the
  owner's testers.
- Publishing a test APK takes about fifteen minutes longer.
- The check depends on GitHub's hosted runners, the emulator image and a Cloudflare quick tunnel.
  A failure of one of those fails the check; it says which step failed.

## Open questions for the owner

- A device farm (Firebase Test Lab, BrowserStack or AWS Device Farm) to run the same flows on
  real phones before a store release.
- Whether the check should also run on a schedule (it does not: it would add sample bookings to
  the test server every time).
