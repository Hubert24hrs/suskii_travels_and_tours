# Runbooks

Step-by-step responses to the incidents most likely to cost money, tickets or trust. Each alert
in `infra/observability/alerts/suskii.rules.yml` names its runbook, and a unit test fails if
the file does not exist.

| Runbook                                               | Use when                                                                |
| ----------------------------------------------------- | ----------------------------------------------------------------------- |
| [Payment provider outage](payment-provider-outage.md) | Payments fail, webhooks fail or are rejected, success rate drops        |
| [Supplier outage](supplier-outage.md)                 | Searches return partial results, a supplier's error rate climbs         |
| [Ticketing backlog](ticketing-backlog.md)             | Paid bookings wait for tickets, ticketing gives up, the worker is down  |
| [Database restore](database-restore.md)               | Data loss or corruption, a bad migration, connection exhaustion         |
| [Key rotation](key-rotation.md)                       | A key or secret may have leaked, or its scheduled rotation is due       |
| [Session revocation](session-revocation.md)           | Account takeover, a compromised staff account, account recovery         |
| [Ride safety incident](ride-safety-incident.md)       | An SOS, a PIN lockout or a route deviation on a ride                    |
| [Stuck ride](stuck-ride.md)                           | Rides wait for drivers, never end, or most searches find no driver      |
| [Driver document backlog](driver-document-backlog.md) | Driver applications wait days for review, or scans stay pending         |
| [Bus scanner offline](bus-scanner-offline.md)         | Departures leave with nobody scanned, or many passes fail to verify     |
| [Failed webhook replay](failed-webhook-replay.md)     | Ledger discrepancies, or webhooks that failed and must be applied       |
| [Deploy and roll back](deploy-and-rollback.md)        | Shipping a release, watching it, rolling back, operator commands        |
| [Screen reader checklist](screen-reader-checklist.md) | Before each release: manual VoiceOver and TalkBack checks               |
| [Personal data breach](personal-data-breach.md)       | Personal data may have leaked, been changed or lost; regulator clocks   |
| [Data rights requests](data-rights-requests.md)       | Someone asks to see, correct or delete their data; a request is overdue |

## Every incident

1. **Acknowledge** the alert in the on-call tool, so nobody else starts in parallel.
2. **Assess impact:** money at risk, tickets at risk, or neither. `severity: page` alerts are
   the first two.
3. **Open an incident record.** Keep a timeline of what you saw, what you changed and when, with
   request ids and booking references. Never copy personal data, tokens or card details into
   the record, a chat or a ticket.
4. **Stabilise first, then find the cause.** Each runbook lists the safe levers in order.
5. **Tell support** what travellers will see and what to say. Contact details and the status
   channel are open owner questions.
6. **Close:** confirm the alert has cleared and the checks in the runbook pass. Write a short
   review within five working days: cause, impact, what worked, and follow-up issues.

## Tools

- **Admin console:** bookings and their timelines, refunds (maker-checker), payment reviews,
  users (disable, sign out, reset MFA), and the audit log.
- **Dashboards:** `infra/observability/dashboards` (API and payments, operations, web vitals).
- **Sentry:** errors grouped by release, with the request id of each.
- **Logs:** JSON lines; search by `reqId` or `requestId`, booking id or job name.
- **Scripts** (run with production configuration from a secured operations shell):
  - `pnpm --filter @suskii/api sessions:revoke`: bulk sign-out with the token denylist.
  - `pnpm --filter @suskii/api keys:reencrypt`: rewrite field encryption under the current key.
  - `pnpm --filter @suskii/api keys:generate`: fresh secrets.
- **Worker sweeps:** every minute the worker expires unpaid bookings, tickets paid ones,
  reconciles pending payments, advances payment plans and executes due refunds, through
  `/v1/internal/bookings/*`.
