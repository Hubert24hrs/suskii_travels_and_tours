# ADR-056: Demo drivers for local ride testing

- Status: Accepted
- Date: 2026-10-25
- Deciders: Claude Code (implementer), pending owner review

## Context

A ride needs an approved driver who is online, sends a fresh position near the pick-up, accepts
the offer, drives there, takes the rider's PIN and completes the trip. The twenty sample drivers
from `db:seed:demo` are offline, and the phone test stack (`e2e:stack`) runs no worker, so nothing
dispatches. A tester with one phone could request a ride but never see it taken. They would need a
second account in driver mode, a staff approval and a second device.

The options were:

- an in-API "demo mode" that auto-accepts rides;
- an HTTP client that signs the sample drivers in (they have no passwords);
- a dev-only process that drives the sample drivers through the same services as the driver
  routes.

The PIN was the sensitive part. The API keeps an encrypted copy so the rider's app can show it, so
a simulator holding the keys could read it and start every ride on its own.

## Decision

`pnpm --filter @suskii/api rides:demo` (`scripts/demo-drivers.ts`, logic in
`scripts/demo-driver-simulator.ts`) runs in its own process. It boots the API's compiled modules as
a Nest application context. tsx cannot emit the decorator metadata Nest's injection needs, so it
uses `dist`. Every tick it does the following:

1. For each ride still searching without an open offer, an idle sample driver of the ride's
   category comes online 0.7 to 1.3 km from the pick-up. A driver who is already online goes
   offline first, because the API only places a driver freely when they come online. No driver is
   summoned if an idle one is already within the match radius.
2. It runs `RideDispatchService.run()`. The API's lock makes this harmless next to a worker.
3. Each open offer to a sample driver is accepted.
4. Assigned drivers move towards the pick-up and in-progress drivers follow the planned route,
   through `RideDriverService.location()`. Each step is timed from the driver's last fix, the same
   clock as the API's speed check, at up to 45 m/s (the API refuses fixes above 50 m/s).
   Arrival and completion go through `arrive()` and `complete()`.
5. For the PIN, it asks the person testing (`PinSource`). In a terminal they type the code shown in
   the rider's app, as a real driver hears it from the rider. A malformed entry never reaches the
   attempt counter. Without a terminal, drivers wait at the pick-up.

Guards:

- It refuses `NODE_ENV=production`, both in the script and in the simulator's constructor.
- It touches only drivers flagged `sample`.
- It never decrypts the PIN.
- It needs the API's `HMAC_SECRET` and `FIELD_ENCRYPTION_KEY`, so both processes read what the
  other wrote.

`E2E_DEMO_DRIVERS=true pnpm --filter @suskii/web e2e:stack` starts it beside the stack, sharing the
terminal. The stack now generates one set of throwaway keys per run and gives them to the seed, the
API and the simulator.

## Consequences

- One person with one phone can take a ride from request to completion on a local stack. The state
  machine, plausibility checks, PIN check, ledger settlement and realtime events all apply. The
  stack runs with no worker, so the simulator is also what dispatches there.
- The simulator lives in `scripts/` and is not in the API's build output, so it never ships in the
  production image.
- Coverage: `test/demo-drivers.e2e-spec.ts` takes a ride from request to completion (malformed PIN,
  wrong PIN, the rider's PIN), checks that real drivers are untouched, and checks the production
  refusal and the "no free driver" path.
- A summoned driver appears near the pick-up instead of driving from elsewhere. That is acceptable
  for samples and never happens to real drivers.
- Scheduled rides are taken when the dispatcher starts their search, as with real drivers.
