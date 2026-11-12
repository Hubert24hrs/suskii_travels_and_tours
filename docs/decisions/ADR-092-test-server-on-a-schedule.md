# ADR-092: The hosted test server on a schedule

- Status: Accepted
- Date: 2026-11-09
- Deciders: the owner (asked for the server to stay up), Claude Code (implementer)
- Amends: ADR-066 (the server was started by hand only)

## Context

The hosted test server (ADR-066) ran only when someone started it, for 5.5 hours at most. Between
runs the test app showed "We could not reach the Suskii server" with the links to start or set a
test server. The owner tests on a phone at any hour and asked for the server to stay up. A staging
environment (phase 12) is the lasting answer, but it needs the owner's cloud accounts.

## Decision

`test-server.yml` also starts on a schedule, every four hours (`23 */4 * * *`, 00:23 to 20:23
UTC). A scheduled run lasts 5.5 hours, so consecutive runs overlap by about 1.5 hours. The
overlap also absorbs GitHub starting a scheduled run late.

- **Handover.** A new run publishes its address in `test-server.json` only once its checks pass
  through the tunnel. The older run keeps serving until its own time ends. When that run ends, it
  marks the address stopped only if the file still names it (unchanged from ADR-066). An app
  opened, or a Try again pressed, after the handover finds the new address.
- **Concurrency.** Each scheduled run has its own concurrency group, so a new one never cancels
  the server that is still serving. Manual runs keep the shared `live` group and still replace
  each other. A manual run started while a scheduled one serves publishes its address and wins.
- **Unchanged.** Everything else in ADR-066 stays: the stack, the mock providers, the tunnel and
  how the app finds the server. The card that explains how to start a server stays for the cases
  below.

## Consequences

- **Usually no gap.** The app finds a running server at any hour. The card shows only if a run
  fails (for example the tunnel drops and the job stops after five missed checks) until the next
  scheduled run, or while GitHub has paused the schedule.
- **Fresh data every four hours.** Each run seeds an empty database. Bookings and accounts made
  on one server are gone on the next one, at most 5.5 hours later. Testers who need longer
  journeys start a manual run.
- **Cost.** About 33 runner-hours a day, on standard runners, which are free for this public
  repository. Scheduled runs use the default branch's copy of the workflow.
- **GitHub's rules.** GitHub pauses scheduled workflows in a public repository after 60 days
  without activity; one push or a manual run restarts them. GitHub's Actions terms are meant for
  building and testing the project, not hosting. This server only serves testing of this app,
  with sample data, but it is a stopgap: staging replaces it once the owner's accounts exist
  (`docs/owner/launch-checklist.md`, section 1.1), and then the schedule is removed.
