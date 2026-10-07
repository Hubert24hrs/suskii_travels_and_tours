# ZAP baseline: triage

The Security workflow runs `.zap/automation.yaml` (OWASP ZAP 2.17, passive rules only) against
the e2e stack:

- the web app, spidered;
- the admin console, spidered (signed out);
- every API operation, imported from `apps/api/openapi.json`.

A high-risk alert fails the job. Medium and lower alerts are listed here with a decision.
Re-triage when a new alert appears in the job's report artifact.

Last run: 2026-10-06, locally against the e2e stack. No high-risk alerts.

## Fixed

| Alert                                                           | Where                    | Fix                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OpenAPI parse errors (413 and 415 responses had no description) | `openapi.json`           | Every problem response now has a description; unknown statuses fall back to `Problem`.                                                                                                                                                                                                                                                     |
| 10024 Sensitive information in URL (email)                      | Web: the newsletter form | Forms that JavaScript sends had no `method`, so a submit before hydration went out as GET with the fields in the URL. This affected passwords, TOTP codes and passport numbers in other forms too. Every form now has a method: `post` for personal data, `get` only for searches. A lint rule (`no-restricted-syntax`) keeps it that way. |

## Accepted

| Alert                                  | Risk   | Why                                                                                                                                                                                                                                                     |
| -------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10055 CSP: `style-src 'unsafe-inline'` | Medium | React and `next/image` set inline `style` attributes, which nonces cannot cover (ADR-010). Scripts stay strict (`'nonce-…' 'strict-dynamic'`). Injected styles can deface a page but cannot run code. Revisit if Next.js gains style-attribute hashing. |

## False positives (filtered in the plan)

| Alert                             | Why                                                                                                                                                                                                                                                        |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10202 Absence of anti-CSRF tokens | No HTML form on the website or the console is submitted natively. Client code sends API requests, which carry `X-CSRF-Token` with cookie sessions (ADR-007). The language form is a Next.js Server Action, which Next.js checks against the Origin header. |

## Informational (no action)

| Alert                                                                 | Note                                                                                                                               |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 10024 Sensitive information in URL (`actorUserId`)                    | An audit-log filter parameter holding an opaque staff id, on an admin route behind staff authentication, MFA and the IP allowlist. |
| 10031 User-controllable HTML attribute                                | Search parameters are echoed into input values. React escapes attribute values.                                                    |
| 10027 Suspicious comments                                             | Words such as "user" or "admin" inside minified framework bundles.                                                                 |
| 10019 Content-Type header missing                                     | Empty-bodied responses (redirects and 304s).                                                                                       |
| 10109 Modern web application, 10111 Authentication request identified | Descriptive only.                                                                                                                  |
