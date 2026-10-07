# ADR-045: API load testing with k6

- Status: Accepted
- Date: 2026-10-07
- Deciders: Claude Code (implementer), pending owner review

## Context

`PROJECT_SPEC.json#/performance/api_targets` sets three targets for the API:

- p95 under 300 ms for every non-search call;
- searches inside the 12 s supplier timeout;
- partial results when a supplier fails.

Phase 11 asks for load tests with these thresholds, run in CI. Before this, nothing measured the
API under concurrent load.

## Decisions

1. **k6, pinned and verified.**
   - `load/k6/api.js` is plain k6 JavaScript, with no extensions and no remote imports.
   - CI downloads one release (`K6_VERSION`) and checks it against its published SHA-256 before
     it runs, as it does for gitleaks and Trivy.
2. **Two open-model scenarios.** Both use a constant arrival rate, so a slow API cannot slow the
   offered load down.
   - **browse**, 20 requests a second: autocomplete, home and site content, deals, hotel
     destinations and packages.
   - **book**, 2 journeys a second. A guest journey goes: flight search, quote, the checkout
     read, booking creation (Turnstile mock token, `Idempotency-Key`), then the start of payment.
     Payment stops at the hosted checkout, so no webhook, risk check or ticketing runs.
   - Searches spread over four domestic routes and 60 dates, so most of them miss the result
     cache.
   - `LOAD_SCALE` and `LOAD_DURATION` change the rates and the length of the run.
3. **Thresholds** (the run fails when any is crossed):
   - `http_req_duration{kind:read}` and `{kind:write}`: p95 under 300 ms;
   - `http_req_duration{kind:search}`: p95 under 12 s;
   - `http_req_failed`: under 1%;
   - `checks`: over 99%.
4. **Where it runs.**
   - A separate CI job (`load`), so the other suites do not share the runner.
   - It uses the e2e stack (mock suppliers and payment provider, seeded data), started with
     `E2E_RATE_LIMIT_ENABLED=false`. A load test measures capacity; the per-IP limits have their
     own tests.
   - The summary is uploaded as an artifact.
5. **Never against production.** Every journey creates a guest booking. Load tests against
   staging with real supplier sandboxes are a phase 12 task, with the same script pointed there
   through `API_URL`.

## Results (local, 4 vCPU; API, Postgres, Redis, web and k6 on one machine)

| Load                  | Requests/s | Read p95 | Write p95 | Search p95 | Failed |
| --------------------- | ---------- | -------- | --------- | ---------- | ------ |
| CI profile (1x, 60 s) | 30         | 82 ms    | 28 ms     | 18 ms      | 0%     |
| 5x (30 s)             | 149        | 171 ms   | 178 ms    | 60 ms      | 0%     |

## Consequences

- Mock suppliers answer at once, so search latency here is our own overhead only. Real search
  time depends on suppliers. Their timeouts and circuit breakers (ADR-009) bound it, and phase
  11E's supplier dashboards watch it.
- The CI profile is deliberately modest: shared runners vary, and the gate exists to catch
  regressions, not to size production. Capacity planning for launch uses the 5x figures and a
  staging run (phase 12).
- Rate limits are off in the load stack, so the test says nothing about how the limits behave
  under load. The rate-limit e2e tests cover that.
