# ADR-048: Security verification checklist and accepted risks

- Status: Accepted
- Date: 2026-10-12
- Deciders: Claude Code (implementer), pending owner review

## Context

Phase 11 asks for these, and for no high or critical finding to stay open:

- an OWASP ASVS level 2 checklist for the web platform;
- an OWASP MASVS checklist for the app;
- a threat model and runbooks.

A checklist written once by hand goes stale as soon as code moves. Some requirements depend on
infrastructure that arrives in phase 12. A few would cost more in usability or reach than they
return for this product.

## Decisions

### 1. A reviewed mapping, a generated checklist, and a CI check

- `docs/security/standards/` holds the requirement texts (ASVS 5.0.0 levels 1 and 2, 253
  requirements; MASVS 2.x, 24 controls), taken from the OWASP sources under CC BY-SA 4.0.
- `mapping.json` gives each requirement a status, evidence paths and a note.
- `scripts/security-checklist.mjs` renders `docs/security/checklist.md`. With `--check` (in CI),
  it fails when:
  - a requirement is unmapped;
  - a status is unknown;
  - a non-met item has no note;
  - an evidence path is missing;
  - an accepted item does not cite this ADR;
  - the page is out of date.

### 2. Statuses

| Status           | Meaning                                                                              |
| ---------------- | ------------------------------------------------------------------------------------ |
| `met`            | Implemented and verified here                                                        |
| `partial`        | Partly implemented, with what is missing and when it lands                           |
| `deployment`     | Needs production infrastructure (phase 12); the note says what the code already does |
| `accepted`       | A deliberate deviation, recorded below with its compensating controls                |
| `not-applicable` | The platform does not use the technology                                             |

### 3. Accepted deviations

| Requirement            | Deviation                                                                               | Why, and what compensates                                                                                                                                                                                                                                                                                                          | Revisit when                                        |
| ---------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| ASVS V6.3.3            | Travellers may sign in with one factor; MFA is optional for them                        | Mandatory MFA at checkout would lose many first-time travellers in the primary market. Staff must use MFA. Every traveller is offered an authenticator. Sensitive actions need fresh proof. Money moves only through hosted checkout. Sign-in has limits, locks and breached-password checks. Refresh-token reuse ends the session | Account takeover reports, or a stored-value feature |
| ASVS V6.5.5            | A TOTP code is accepted for one step either side of now (up to 90 seconds)              | RFC 6238 recommends this tolerance for phone clock drift, which is common. Each step is usable once (replay rejected), and attempts are limited                                                                                                                                                                                    | Never, unless drift data says otherwise             |
| ASVS V7.2.4            | Step-up and re-authentication do not issue new session tokens                           | Sign-in (including MFA completion) always issues new tokens. Tokens are only issued by the server in HttpOnly cookies or response bodies and never accepted from URLs, so session fixation is not possible. Step-up time is stored server-side per session                                                                         | A move to client-visible session identifiers        |
| ASVS V11.5.1           | Voucher codes carry about 99 bits, under 128                                            | Only staff with `bookings:manage` can redeem them, each code works once, lookups are rate limited and audited, and the code is not a credential for anything else. Every token and secret is 256-bit                                                                                                                               | Vouchers become redeemable by the public            |
| ASVS V14.2.1           | Signed visa document links carry their signature in the query string                    | The link is for one document and one viewer type, lasts 5 minutes, and every access is audited. Responses are attachments with `no-store`. Browsers do not send the query to other sites (`Referrer-Policy`). Header-based download would break plain links in the console                                                         | A browser-native way to download with headers       |
| MASVS-NETWORK-2        | No certificate pinning                                                                  | Pinning risks a full outage of the app on any certificate or CDN change, with releases gated by store review. TLS with platform validation, HSTS, device attestation and server-side checks cover the risk                                                                                                                         | A targeted attack on our traffic                    |
| MASVS-CODE-1           | Supports Android 7.0 and iOS 15.1 and later                                             | A large share of devices in the primary market run older Android versions. The target SDK is current (36), the API refuses outdated app builds (`MOBILE_MIN_VERSION`), and attestation can require a supported OS once verifiers are live                                                                                          | Analytics show under 3% on unsupported versions     |
| MASVS-RESILIENCE-2/3/4 | No anti-tampering, obfuscation or anti-debugging beyond Hermes bytecode and attestation | The app holds no secrets (a bundle scan fails the build otherwise) and enforces nothing locally. Prices, payments, bookings and permissions are decided by the API. Device attestation identifies genuine app instances for guest checkout and payments                                                                            | Fraud through modified apps                         |

### 4. Partial items and owners

| Item               | Missing                                                       | Lands in                                                |
| ------------------ | ------------------------------------------------------------- | ------------------------------------------------------- |
| ASVS V13.2.1       | Worker-to-API token and database passwords are static secrets | Phase 12: workload identity and short-lived credentials |
| MASVS-RESILIENCE-1 | Real App Attest and Play Integrity verifiers                  | Owner's Apple and Google accounts (open question)       |
| MASVS-PRIVACY-3    | Privacy policy text and store privacy labels                  | Owner (legal texts open question)                       |

The 17 `deployment` items, such as TLS policy at the edge, secret manager, egress policy, log
shipping and database roles, are phase 12 acceptance criteria.

### 5. Gaps closed while mapping

- **Log redaction:** pino wildcards match one level only, so the redaction paths now cover the
  top level and three levels below. The worker uses the same field list as the API
  (`SENSITIVE_LOG_FIELDS`).
- **TLS in production:** required for the Duffel API, the OTLP collector (except on localhost),
  and SMTP (STARTTLS when not implicit TLS). The Sentry sender refuses redirects and times out.
- **Cookies:** the website's own cookies (currency, locale, consent) use the `__Host-` prefix in
  production.
- **Logging:** 403 and 429 responses log at `warn`; non-admin authorization denials are logged
  with the missing permission.
- **Payment outages:** `PAYMENT_PROVIDERS_PAUSED` stops new payments through a failing provider
  without orphaning its webhooks, reconciliation and refunds.

## Consequences

- No high or critical finding is open. The accepted items are medium or low risk, with
  compensating controls, and the owner should confirm them.
- Adding a requirement status or evidence takes a mapping edit and a regenerated page; CI keeps
  them in step.
- When a standard is revised, replace its JSON in `docs/security/standards`. The check then
  lists every new or removed id until the mapping catches up.
