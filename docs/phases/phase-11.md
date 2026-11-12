# Phase 11: Hardening

Status: in progress

## Goal

Make the platform ready for production traffic: verify it against OWASP ASVS 5.0 Level 2 and
MASVS 2, close the gaps the walk finds, add the security scans the spec asks for, meet the
performance budgets, and give operations error reporting, metrics, dashboards, alerts and
runbooks.

## Acceptance criteria (from PROJECT_SPEC.json)

1. No high or critical findings open.
2. Performance budgets met.
3. Runbooks written for payment outage, supplier outage, ticketing backlog and DB restore.

Tasks: walk the ASVS L2 and MASVS checklists, fix gaps, record results in
`docs/security/checklist.md`; ZAP baseline, k6 load tests, bundle budgets, Sentry and OTel
dashboards and alerts; a STRIDE threat model for auth, payments, bookings and documents in
`docs/security/threat-model.md`.

## What the survey found

The ASVS 5.0 requirements (253 at L1 and L2) and the 24 MASVS controls were read against the code
before planning. Already in place: deny-by-default guards with the admin route matrix, ownership
checks returning 404, Zod on every input, Prisma only, a JSON-only API with `default-src 'none'`,
nonce CSPs, HSTS on the API and website, CSRF tokens, `__Secure-` httpOnly cookies, argon2id,
HIBP k-anonymity checks, TOTP with replay protection, lockout and rate limits, rotating refresh
tokens with reuse detection, Ed25519 access tokens checked for issuer, audience, type and expiry,
append-only audit and booking history tables, field encryption bound to its row, hosted payments
with verified webhooks, a double-entry ledger, uploads sniffed, size-limited and virus-scanned,
signed short-lived document links, device attestation, `FLAG_SECURE`, no Android backups and no
cleartext traffic in release builds.

Gaps to close (requirement in brackets):

- **Headers.** The admin console sends no HSTS, `nosniff`, `Referrer-Policy` or
  `Permissions-Policy`; both CSPs use `base-uri 'self'` instead of `'none'` [V3.4.1, V3.4.3 to
  V3.4.5].
- **Open redirect.** The console's post-sign-in redirect accepts `/\host` [V3.7.2].
- **Passwords.** Without HIBP (disabled or unreachable, it fails open) nothing rejects common
  passwords; no context-specific words (brand names) are blocked [V6.2.4, V6.1.2, V6.2.11].
- **Recovery codes** carry about 50 bits and are stored as a keyed HMAC; below 112 bits ASVS asks
  for a salted password hash [V6.5.2].
- **Re-authentication.** Changing the phone number, starting authenticator enrolment and signing
  out devices need no fresh proof [V7.5.1, V7.5.2].
- **Sessions.** No documented concurrent-session limit; staff sessions live as long as
  customers' (30 days idle) with no step-up for the riskiest admin actions (left from ADR-033);
  staff cannot sign a user out without disabling the account [V7.1.2, V7.3.1, V7.3.2, V7.4.5].
- **Social sign-in** accepts a client-chosen, optional nonce, so a stolen ID token could be
  replayed [V10.5.1, V10.1.2]. No client uses social sign-in yet.
- **Outbound HTTP** follows redirects (payments, Duffel, push, Turnstile, HIBP) [V15.3.2].
- **Key rotation.** Field encryption has one key and no key id in the envelope [V11.1.1,
  V11.2.2].
- **Production transport.** Nothing requires TLS to Postgres and Redis [V12.3.1].
- **Bot protection.** Web sign-up has no Turnstile check (the spec lists sign-up next to guest
  checkout and the newsletter).
- **Data retention.** Only snapshots, visa documents and push tokens are pruned; sessions, tokens,
  idempotency records, webhook events, search logs and notification logs grow forever, and
  financial records of deleted accounts are never purged (left from ADR-029).
- **Payment fraud signals** from the spec (velocity, card country against IP country, many cards
  per account, high-risk routes, manual review in admin) do not exist.
- **Mobile.** No way to retire old app versions [MASVS-CODE-2]; users are not told text-message
  codes are weaker than an authenticator [V6.6.1].
- **Web client storage.** Sign-out leaves guest booking tokens in session storage [V14.3.1].
- **Cookie consent manager** from the spec is missing (the site only sets necessary and
  preference cookies today).
- **Supply chain.** No SAST, secret scanning, dependency audit gate, SBOM or container/file-system
  scan; npm dependencies are not updated automatically; CI actions are pinned by tag, not commit.
- **Testing.** No IDOR matrix over every owned resource, no coverage thresholds for pricing,
  money, the booking state machine, installments and auth, no visual regression tests, no load
  tests, no ZAP scan.
- **Performance.** The homepage ships about 202 kB of JavaScript against a 170 kB budget; the
  Lighthouse gate checks scores but not LCP, CLS or TBT; no field (RUM) data.
- **Observability.** No error reporting; business metrics cover search and suppliers only;
  request ids stop at the API (web and worker do not forward them); no dashboards or alert rules.
- **Documentation** ASVS asks for: cryptographic inventory and key policy, data classification,
  logging inventory, external communications, business limits, resource-heavy functions and
  vulnerability remediation time frames.

## Plan

### 11B: Security fixes (API, web, admin, mobile)

- Admin security headers; `base-uri 'none'` in both CSPs; reject backslashes in the console's
  `next` parameter.
- Password policy: a bundled list of common passwords that meet the length policy (always on,
  HIBP on top) and a context-word check (brand and product names), with tests.
- Recovery codes hashed with argon2id (existing HMAC codes keep working until used or replaced).
- Re-authentication: phone change, authenticator enrolment and device sign-out accept a proof or
  a sign-in within the last 10 minutes (the existing `ReauthService` rules).
- Sessions: a concurrent-session cap (oldest revoked, audited), staff idle and absolute lifetimes
  (`STAFF_SESSION_IDLE_MINUTES`, `STAFF_SESSION_MAX_HOURS`), step-up MFA within 10 minutes for
  role changes, refund approval, MFA reset, user disable, trust-signal verification and pricing
  changes (`@AdminRoute(..., { stepUp: true })`, `POST /v1/me/mfa/step-up`, console prompt), an
  admin "sign out everywhere" action and a CLI to revoke every session in an incident.
- Social sign-in: `POST /v1/auth/social/nonce` issues a single-use nonce (Redis, 10 minutes);
  sign-in requires and consumes it.
- Outbound HTTP refuses redirects.
- Field encryption key ring: `v2` envelopes carry a key id; previous keys stay readable; a
  re-encryption command and runbook rotate keys.
- Production config refuses plaintext Postgres and Redis unless explicitly allowed for a private
  socket or VPC.
- Turnstile on web registration (the app keeps device attestation).
- Retention: each `DATA_REGISTRY` entry gains a retention rule; `RetentionService` and a daily
  worker job apply them, including the financial-record purge of deleted accounts.
- Payment risk: signals at capture (velocity by account, contact, IP and device; card country
  against IP country where the provider reports both; distinct cards per account; high-risk
  routes and countries from config); a score above the review threshold holds fulfilment and opens
  a review in the admin console (approve releases it, reject refunds and cancels), audited.
- Mobile: minimum supported app version (`MOBILE_MIN_VERSION`, 426 `app-update-required`, update
  screen); text-message code risk notes on web and mobile.
- Web: sign-out clears guest booking tokens; a cookie settings dialog listing the cookies in use,
  with consent recorded before any optional category is ever enabled.

### 11C: Supply chain and security CI

- Gitleaks (history and diff), Semgrep with the OWASP and TypeScript rule packs, `pnpm audit`
  failing on high and critical, Trivy file-system scan and a CycloneDX SBOM artifact.
- Dependabot for npm (grouped, weekly) next to the existing Actions updates; actions pinned by
  commit SHA.
- ZAP baseline against the e2e stack (web, admin, API) with a reviewed rules file; high findings
  fail the job.
- API e2e IDOR matrix driven by the OpenAPI document: every operation with a path parameter on an
  owned resource is called by another account and must answer 404.
- Coverage thresholds (80%) for pricing, money, the booking state machine, installments and auth.
- Playwright screenshot tests for key ui-web components.

### 11D: Performance

- Homepage JavaScript to 170 kB or less (the e2e budget drops from 210 kB to 170 kB).
- Lighthouse gate also checks LCP, CLS and TBT (lab); web-vitals field reporting to the API
  (`POST /v1/telemetry/web-vitals`), recorded as OTel histograms.
- k6 scenarios for search, quote and checkout with thresholds (p95 under 300 ms for non-search
  routes, search under the 12 s timeout, error rate under 1%), run in CI against the e2e stack.

### 11E: Observability

- Error reporting behind an `ErrorReporter` abstraction with a Sentry adapter (API, worker, web
  and admin servers); browsers and the app load the Sentry SDK only when an error occurs (keeps the
  JS budget); PII scrubbing; enabled only with a DSN.
- Business metrics: payments by provider and outcome, webhook failures, bookings and quotes
  (search-to-book conversion), ticketing outcomes and backlog, refunds, queue depth.
- Request ids forwarded from web and worker to the API and logged.
- `infra/observability/`: Grafana dashboards and Prometheus-style alert rules for payment webhook
  failures, ticketing backlog, error-rate spikes, queue depth and database connections.

### 11F: Documentation, verification and report

- `docs/security/checklist.md`: every ASVS L1/L2 requirement and MASVS control with status and
  evidence, generated from a reviewed mapping file.
- `docs/security/threat-model.md` (STRIDE for auth, payments, bookings, documents).
- `docs/security/`: cryptography inventory and key policy, data classification, logging
  inventory, external communications, business limits and heavy functions; `SECURITY.md` with
  disclosure and remediation time frames.
- `docs/runbooks/`: payment provider outage, supplier outage, ticketing backlog, database restore
  (rehearsed locally with `pg_dump`/`pg_restore`), key rotation, session revocation; manual
  VoiceOver/TalkBack checklist.
- Lint, typecheck, test and build everything; CHANGELOG, CLAUDE.md; CI green; report.

## Risks and mitigations

- **ZAP and k6 need Docker or binaries that this container cannot run.** Mitigation: they run in
  CI against the e2e stack; scripts are kept small and their first CI runs are watched.
- **Payment risk holds can delay tickets on held fares.** Mitigation: only scores above the review
  threshold hold; holds are visible in the admin queue with the supplier deadline; thresholds and
  signals come from config and default conservatively.
- **The 170 kB budget may need deeper changes to the search card.** Mitigation: measure first,
  then remove the largest client dependencies (downshift, tailwind-merge) as ADR-013 proposed.
- **New security checks can lock users out (re-auth, session caps).** Mitigation: a sign-in in the
  last 10 minutes counts as proof; the cap revokes the oldest session, never the current one.
