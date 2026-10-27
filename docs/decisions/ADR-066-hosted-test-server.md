# ADR-066: Hosted test server for phone testing

- Status: Accepted
- Date: 2026-10-27
- Deciders: Claude Code (implementer), pending owner review

## Context

The test APK told testers "We could not reach the Suskii server". It points at a stack on the
tester's own computer (ADR-054), which a phone cannot reach without a computer running the stack
on the same network. The owner tests on a phone and has no such stack. Phase 12's staging
environment needs the owner's cloud accounts, which do not exist yet. Without a server, place
search, prices, sign-up and every booking fail.

## Decision

### A test server on a GitHub runner

`test-server.yml` (manual) runs the e2e stack on an Actions runner for up to 5.5 hours. The stack
is the API, the website, the worker and the demo drivers, with throwaway Postgres and Redis,
mock suppliers and mock payments. It never calls a real provider.

- **One public address.** A Cloudflare quick tunnel (`cloudflared`, pinned by image digest) gives
  the runner a random `https://*.trycloudflare.com` address without an account.
- **One origin.** `scripts/test-server-proxy.mjs` sends API paths (`/v1`, `/health`, `/ready`,
  `/.well-known/jwks.json`) to the API and everything else to the website. WebSockets (live rides)
  are forwarded too. A single origin keeps the API's cookies first-party for the website, as
  `api.*` and `www.*` are in production.
- **Built for its address.** The website is built with the tunnel's address inlined.
- **Visitors' addresses.** The API reads the visitor from Cloudflare's `cf-connecting-ip`
  (`CLIENT_IP_HEADER`). The runner accepts no inbound traffic, so only the tunnel reaches the proxy.
- **The address file.** The address goes into `test-server.json` on the `test-server`
  pre-release. The file holds the version, status, API and website origins, start and end times,
  commit and run. It is marked `stopped` when the run ends, but only if it still names that run,
  because a newer run may have replaced it.
- **Pull requests.** A pull request that changes these files starts the server, checks it through
  the tunnel and stops.

### The app finds it

- **At launch.** Test builds (`e2e` variant) read the address file before the first screen
  (`src/lib/hosted-server.ts`): four seconds at most. A server counts only when the file says
  `running`, has not passed its end, and both origins use https.
- **Remembered.** The answer is kept in `preferences`, so a start without a connection uses the
  last address until it expires. A file that says `stopped`, or is missing, forgets it.
- **Precedence.** A server the tester entered under Test server (ADR-054) still wins. The
  built-in address is the last fallback.
- **When nothing answers.** The "cannot reach" banner explains how to start the server. Its
  button opens the workflow page, and Try again looks for the file again. A new address restarts
  the session against it: `AppProvider` is keyed by the server.
- **Build settings.** `mobile-test-apk.yml` bakes in the file's URL and the workflow page
  (`EXPO_PUBLIC_TEST_SERVER_URL`, `EXPO_PUBLIC_TEST_SERVER_START_URL`). Both are public. Store
  builds never read them.

### Rides without a terminal

The demo drivers (ADR-056) need the rider's PIN, which a tester normally types in the terminal.
On the hosted server, `/demo-drivers` serves a small form instead (`DEMO_DRIVERS_PIN_PORT`):

- The waiting driver takes the PIN at once.
- The page never reads the PIN itself.
- The API's attempt counter and lockout apply to every PIN typed there.
- The page has a strict CSP, `no-store` and `noindex`.

## Consequences

- **A phone alone.** A tester needs a phone and one click on GitHub. The server is up about ten
  minutes later and the app finds it.
- **Public but disposable.** Anyone who reads the address file can use the server while it runs.
  It holds only seeded sample data and what testers enter, and every run starts empty. It sends
  no real email, SMS or payment.
- **Shared by testers.** Testers share one server. With the mock Google and Apple sign-in on
  (ADR-067), someone who knows a tester's email could sign in as them there. This is accepted for
  a disposable test stack; production refuses the mock.
- **Limits.** One run lasts at most 5.5 hours. If the tunnel drops, the address changes, so the
  job fails and a new run is needed. GitHub runner minutes are free for this public repository.
- **Third parties.** `trycloudflare.com` quick tunnels are a testing service without an uptime
  promise. A staging environment (phase 12) replaces this once the owner's accounts exist.
