# The whole trip, end to end, and its receipt (ADR-120)

Outside the numbered phases. The owner asked, on 2026-11-14, to see the whole platform work
together on one journey: a customer books a flight from Lagos to London, a hotel and a car, pays
for everything, and then finds the receipt in their profile or wherever it belongs, on the
website and in the app. The frontends, the backend and the assistant (LangGraph) all take part,
and whatever breaks on the way is fixed.

## Plan

1. Map the journey through the code and the tests that cover it, and find what is missing.
2. Build what is missing: the receipt of a paid combined trip (API, website, app), and the
   combined trips in the account's lists on both clients.
3. Run the journey through every layer:
   - the website's trip builder e2e (plan, five parts, one payment, receipt, account);
   - the app's screen tests and the Maestro flow on the Android emulator (CI);
   - the API's trips, trip form, access-control and document suites;
   - a new suite, `agent-whole-trip.e2e-spec.ts`, in which Ask Suskii plans Lagos to London
     through the real agent service, which runs as its own process with a scripted stand-in
     model;
   - then every workspace's lint, typecheck and unit tests, and the e2e suites.
4. Fix what fails, record the decisions, commit and push.

## Files

- API: `src/trips/` (the receipt route, `TripsService.receipt()`, `receipt` on the trip
  answer), `src/documents/plan-pdf.ts` (`renderTripReceiptPdf`), `booking-pdf.ts` (headings
  clear the QR code; `writeServiceTaxes` exported), `src/bookings/booking-documents.service.ts`
  (`documentTaxes` exported), `src/agent/platform-guide.ts`.
- Website: `components/trips/trip-view.tsx` (the receipt card), `components/trips/trip-receipt.ts`,
  `components/account/combined-trips-section.tsx`, `app/account/trips/page.tsx`, the account
  message subset.
- App: `src/screens/built-trip-screen.tsx` (the receipt card), `src/screens/trips-screen.tsx`
  (combined trips first), `src/components/trips/built-trip-card.tsx` (shared with the planner),
  `src/lib/plan-pdf.ts`.
- i18n: `trips.receipt.*` and `account.trips.combined*` in every catalog; `format.dateTime` with
  `{ year: true }`.
- Agent: `src/service.ts` (`runAgentService`, shared by `main.ts`), `src/test/scripted-service.ts`
  and `src/test/whole-trip-script.ts` (never built).
- Tests: `apps/api/test/agent-whole-trip.e2e-spec.ts` (new), `trips.e2e-spec.ts`,
  `idor-matrix.e2e-spec.ts`, `plan-pdf.spec.ts`, `apps/web/e2e/trip-builder.spec.ts`, the app's
  `trip-builder.test.tsx` and `trips-screen.test.tsx`, `e2e/maestro/trip-builder.yaml`.

## Risks

- **A receipt that says more than the records.** It is drawn from the succeeded payments and the
  shares that kept their money, at the moment it is asked for. A payment refunded for a wrong
  amount gives no receipt, and money a part could not take is printed as a refund started.
- **Personal data on a document that gets passed around.** No name, contact or card detail;
  only the trip's owner can read it.
- **A test-only model reaching a deployed service.** The scripted entrypoint lives in
  `apps/agent/src/test`, which the build leaves out, and it refuses production.

## Outcome

Built and run on 2026-11-14. The journey works on every layer: a traveller plans Lagos to London
(on the website, in the app or with Ask Suskii), gets a flight, a hotel and a car, enters the
details once, pays once, sees every part confirmed, and finds the receipt on the trip and in the
account's trips.

What ran, on this repository's own machine (the session container):

| Suite                                                 | Result                                                                    |
| ----------------------------------------------------- | ------------------------------------------------------------------------- |
| Lint, typecheck and unit tests, every workspace       | 37 of 37 tasks pass                                                       |
| API unit tests                                        | 854 pass                                                                  |
| App (Jest)                                            | 377 pass, the new receipt and Trips tab tests among them                  |
| Shared, design tokens, ui-web, ui-native, worker      | 404, 179, 154, 59 and 53 pass (the worker's one skipped test was already) |
| Agent service (Vitest, with the three recorded evals) | 101 pass                                                                  |
| API e2e                                               | 81 of 83 suites, 875 of 881 tests; the two others below                   |
| Ask Suskii's whole trip (`agent-whole-trip`)          | passes: 8 tool calls, the guard, the form, one payment, the receipt       |
| Website e2e (chromium)                                | 257 pass; the status page test failed once under load, then passed 3 of 3 |
| Website e2e on slow 3G                                | passes                                                                    |
| Console e2e                                           | 32 of 32 pass                                                             |

The three that did not pass here, and why none is a fault in the code:

- `app-role.e2e-spec.ts` checks that the old database password is refused after a rotation. The
  container's Postgres trusts every local connection, so no password is ever refused. Against a
  second cluster that checks passwords (SCRAM), the suite passes 8 of 8.
- `object-storage.e2e-spec.ts` starts an S3 gateway in a container (Testcontainers); this machine
  has no container runtime. CI has one.
- Lighthouse's lab total blocking time on this container swings with its load: for the same base
  commit it measured 179, 334 and 100 ms (two passing, one failing), and 287, 299 and 423 ms for
  this work. The homepage's code differs from the base by 59 bytes in one shared chunk (the
  formatter's `year` option, never called on the homepage), so the gate is judged by CI's run.

Found and fixed on the way:

- A paid combined trip had no receipt, and neither client listed combined trips in the account.
- PDFs with a short header (the trip plan, the receipt) drew their first heading's rule across
  the QR code in the corner.
- `trips.e2e-spec.ts` and the app's new Trips tab test passed at run time but failed the
  typecheck (fields missing from their local types); fixed before the commits.
- Prisma's pg adapter overlaps a transaction's queries, which pg 9 will refuse; pg is held at
  major 8 (ADR-002).
- The phone check (the test APK on its emulator against the online test server, ADR-100) failed
  once the work was merged. The flow counts the three parts' "Confirmed" on one screen, and the
  app's receipt card, then between the paid notice and the parts, pushed the third part off that
  emulator's shorter screen. CI's emulator is taller and never saw it. The card now follows the
  parts, and CLAUDE.md says why nothing goes between the notice and the parts.

CI ran the same suites on the pull requests and passed (`ci.yml` and `mobile.yml`, the Android
build with the Maestro flows and the iOS simulator build). The phone check runs the test APK on
its emulator and the website's trip builder against the online test server before the APK is
published (`mobile-test-apk.yml`). With the card moved, it passed on the fix's own build and
then on the build from the merged code, which was published as the test APK.
