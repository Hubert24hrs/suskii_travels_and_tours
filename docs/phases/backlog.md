# Backlog

Work deliberately left out of a phase, with the reason and what picking it up involves. Items
are removed when they ship. The Cars task (`docs/phases/cars.md`) adds its deferred items here.

| Item                            | Why deferred                                                                                                                                   | What it needs                                                                                               |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Payout notifications to drivers | The earnings screen already shows each payout's status; push and email templates for drivers add a message category and per-channel renderings | A `driver_payouts` category in `src/messaging/messages.ts`, a call from `DriverPayoutsService.apply`, tests |
| Payout webhooks                 | Only a mock payout provider exists; payouts are followed up by status, which every real provider also supports                                 | A real `PayoutProvider` (owner decision), a signed webhook route that feeds `DriverPayoutsService.apply`    |
