# Error budget burn

**Alerts:** `ApiErrorBudgetBurnFast` and `ApiErrorBudgetBurnSlow` (page), `ApiErrorBudgetBurnSteady`
(ticket), and the same three for the booking path (`BookingErrorBudget*`).
**Rules:** `infra/observability/alerts/suskii.slo.rules.yml`.
**Background:** ADR-087 (availability objectives and the status page), ADR-047 (metrics and
alerts), [the plan](../phases/uptime.md).

## What the alert means

The API promises 99.9% of requests without a server error over 30 days (43 minutes of budget);
the booking path (quotes, bookings, payments) promises 99.5%. A burn-rate alert fires when
errors would spend the month's budget much faster than evenly:

| Alert                  | Burn rate | Windows            | Budget spent before it fires | Budget gone in |
| ---------------------- | --------- | ------------------ | ---------------------------- | -------------- |
| `*BurnFast` (page)     | 14.4x     | 1 hour and 5 min   | 2%                           | about 2 days   |
| `*BurnSlow` (page)     | 6x        | 6 hours and 30 min | 5%                           | 5 days         |
| `*BurnSteady` (ticket) | 1x        | 3 days and 6 hours | 10%                          | 30 days        |

Both windows must exceed the rate, so the alert clears within minutes of recovery. Paging alerts
also need some traffic (about 6 requests a minute for the API, 1 for the booking path).

## 1. Confirm (5 minutes)

1. Which routes fail? On the overview dashboard, split `http_server_request_duration_seconds_count`
   with a 5xx status by `http_route`. Sentry groups the exceptions behind them (ADR-046).
2. Did a release just go out? The canary rolls back by itself on errors (ADR-060); if a full
   rollout is failing, follow [Deploy and roll back](deploy-and-rollback.md).
3. Is a dependency down? `/ready` reports Postgres and Redis; the status page
   (`GET /v1/status`) shows suppliers with open circuit breakers and paused payment providers.
4. Is it the edge? Cloudflare's analytics show 5xx answered by Cloudflare itself (520 to 527)
   that never reach our metrics; the uptime checks catch those.

## 2. Tell travellers

When travellers notice (failed payments, search errors, sign-in problems), open an incident in
the console under **Status**: a plain title ("Card payments failing"), the impact (`minor`:
slower or some fail; `major`: does not work), the affected components and what still works
("bank transfers work"). The website and the app show a banner at once; post an update at least
every 30 minutes and resolve it when the alert has cleared. Never name a supplier or payment
provider, and never put personal data in an update.

## 3. Mitigate

| Cause                                | Action                                                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| A bad release                        | Roll back ([Deploy and roll back](deploy-and-rollback.md))                                      |
| A payment provider                   | [Payment provider outage](payment-provider-outage.md); pause it with `PAYMENT_PROVIDERS_PAUSED` |
| A supplier                           | [Supplier outage](supplier-outage.md)                                                           |
| Postgres (connections, a slow query) | [Database restore](database-restore.md), connection exhaustion section                          |
| Redis down                           | Searches, sessions and rate limits fail: restore Memorystore first; nothing else replaces it    |
| Traffic spike or abuse               | Check rate-limit 429s and Cloudflare's security events; tighten the edge rule, never the API's  |

## 4. Close

1. The alert has cleared and the 5-minute error ratio is back near zero.
2. The status page incident is resolved with a last update saying what happened.
3. For a page: a short review within five working days, with how much of the month's budget was
   spent (`slo:api_errors:ratio_rate3d` and the 30-day ratio on the dashboard). When the budget
   is gone, reliability work comes before new features until it recovers.
