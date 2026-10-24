# External communications

Every connection the platform makes or accepts beyond its own components, and the rules for
each (ASVS V13.1.1, V12.3). Keep it current: a new provider or host needs an entry here, a
setting in `.env.example`, and a production check in the API's environment schema.

## Rules for every outbound call

- **TLS.** HTTPS with certificate verification on every call. No call sets
  `rejectUnauthorized: false`.
  - Production refuses plain http for providers, the worker-to-API hop, Postgres, Redis and the
    OTLP collector. The only exceptions are the declared `*_ALLOW_PLAINTEXT` private paths
    (ADR-038) and a collector on localhost.
  - SMTP requires TLS in production (implicit TLS, or STARTTLS made mandatory).
- **Fixed destinations.** Hosts come from configuration or constants, never from a request. The
  one user-influenced fetch is `next/image`, which only loads `https` images from the hosts in
  `IMAGE_REMOTE_HOSTS`. Trust-signal evidence URLs are stored and shown to staff, never fetched.
- **No redirects.** HTTP calls use `redirect: 'error'`, so a compromised or misconfigured
  endpoint cannot bounce a credential to another host.
- **Timeouts.** Every call has a deadline.
- **Vendor isolation.** Payloads are parsed and mapped inside the adapter. Vendor types never
  leave it (supplier and payment adapter conventions).
- **Least data.** Each provider receives only what its job needs (below).

## Outbound

| Service                                            | Component                  | Purpose                                                        | Data sent                                                                                                 | Auth                                   | Timeout                                            | Setting                                                                    |
| -------------------------------------------------- | -------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------- |
| Duffel (`api.duffel.com`)                          | API                        | Flight search, offers, orders, airlines sync                   | Search criteria; at booking, passenger names, dates of birth, contact, passport details the fare requires | Bearer token                           | 10 s per call, 12 s per search, 45 s booking       | `DUFFEL_API_URL`, `DUFFEL_API_TOKEN`, `FLIGHT_SUPPLIERS`                   |
| Paystack, Flutterwave, Stripe                      | API                        | Hosted checkout, verification, refunds                         | Amount, currency, reference, payer email, return URL. Never card data                                     | Secret key                             | 15 s                                               | `PAYMENT_PROVIDERS`, `*_SECRET_KEY`, `*_API_URL`                           |
| Cloudflare Turnstile (`challenges.cloudflare.com`) | API, web                   | Bot checks on sign-up, guest checkout, newsletter              | Widget token; the client IP                                                                               | Secret key                             | 5 s                                                | `TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`                   |
| Have I Been Pwned (`api.pwnedpasswords.com`)       | API                        | Breached-password check                                        | First five hex characters of the password's SHA-1 (k-anonymity)                                           | None                                   | 2.5 s; skipped on failure                          | Always on                                                                  |
| Google and Apple sign-in keys                      | API                        | Verify ID tokens (JWKS)                                        | Nothing (key download)                                                                                    | None                                   | `jose` defaults; keys cached                       | Fixed URLs in `social.service.ts`                                          |
| Expo push (`exp.host`)                             | API                        | Push to FCM and APNs                                           | Push token, title, body, in-app path                                                                      | Expo access token                      | 10 s                                               | `PUSH_PROVIDER`, `EXPO_PUSH_URL`, `EXPO_ACCESS_TOKEN`                      |
| Email relay (SMTP)                                 | API                        | Transactional and consented marketing email                    | Recipient, rendered message                                                                               | SMTP credentials                       | Transport defaults                                 | `EMAIL_PROVIDER`, `SMTP_*`                                                 |
| SMS and WhatsApp providers                         | API                        | OTP codes, alerts (mock adapters until contracted)             | Phone number, message                                                                                     | Provider key                           | Adapter-defined                                    | `SMS_PROVIDER`, `WHATSAPP_PROVIDER`                                        |
| FX rates (mock until the owner picks a source)     | API                        | Exchange rates                                                 | Nothing personal                                                                                          | Provider key                           | 5 s                                                | `FX_PROVIDER`, `FX_PROVIDER_API_KEY`                                       |
| ClamAV (`clamd`)                                   | API                        | Scan visa documents                                            | File bytes                                                                                                | Private network                        | 30 s                                               | `ANTIVIRUS_PROVIDER`, `CLAMAV_*`                                           |
| ClamAV (`clamd`) for Cars documents                | API                        | Scan driver documents, renter licences and handover photos     | File bytes                                                                                                | Private network                        | Adapter-defined                                    | `ANTIVIRUS_PROVIDER`                                                       |
| OSRM routing (self-hosted)                         | API                        | Ride distance, duration and route for fares and ETAs (ADR-053) | Pick-up, drop-off and driver coordinates; no names or ids                                                 | Private network                        | `MAPS_TIMEOUT_MS`, then the straight-line fallback | `MAPS_PROVIDER`, `OSRM_URL`, `MAPS_TIMEOUT_MS`                             |
| KYC provider (mock until the owner picks one)      | API                        | Verify a driver's NIN and licence (ADR-050)                    | Names, date of birth, NIN, licence number and expiry                                                      | Provider key                           | Adapter-defined                                    | `KYC_PROVIDER`                                                             |
| Payout provider (mock until the owner picks one)   | API                        | Batched transfers of driver earnings (ADR-051)                 | Amount, currency, reference, the driver's bank code, account number and name                              | Provider key                           | Adapter-defined                                    | `PAYOUT_PROVIDER`                                                          |
| Object storage (S3 or GCS, phase 12)               | API                        | Tickets, vouchers, visa documents (encrypted)                  | Ciphertext and generated PDFs                                                                             | Workload identity                      | SDK defaults                                       | `OBJECT_STORAGE`, `S3_*`                                                   |
| Sentry                                             | All apps                   | Error events (ADR-046)                                         | Scrubbed message, stack, release, allowed tags                                                            | DSN public key                         | 5 s, 20 events a minute                            | `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `EXPO_PUBLIC_SENTRY_DSN`           |
| OTLP collector                                     | API, worker                | Traces and metrics (ADR-047)                                   | Route templates, counts, durations, bounded labels                                                        | Collector auth (phase 12)              | Exporter defaults                                  | `OTEL_EXPORTER_OTLP_ENDPOINT`                                              |
| Device attestation (App Attest, Play Integrity)    | Mobile, API                | Prove requests come from the real app (ADR-023)                | Attestation token; verified by the API once real verifiers are configured                                 | Platform keys                          | Adapter-defined                                    | `DEVICE_ATTESTATION`                                                       |
| PostgreSQL, Redis                                  | API, worker                | Data and queues                                                | Everything in `data-classification.md`                                                                    | Password, TLS                          | Driver settings                                    | `DATABASE_URL`, `REDIS_URL`                                                |
| Suskii API                                         | Worker, web, admin, mobile | Internal and public API calls                                  | As documented in `apps/api/openapi.json`                                                                  | Internal token, cookies, bearer tokens | Per client                                         | `API_INTERNAL_URL`, `NEXT_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_API_BASE_URL` |

Browsers also connect to Turnstile, the payment providers' hosted pages (by redirect), Sentry
and the image hosts. The web and admin content security policies list exactly those origins
(`apps/web/lib/csp.ts`, `apps/admin/lib/csp.ts`).

## Inbound

| From                                   | Route                                          | Trust                                                                                      |
| -------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Travellers (web, app), staff (console) | Public API under `/v1`                         | Authenticated by default; rate limited; CORS and admin origins enforced                    |
| Payment providers                      | `/v1/payments/webhooks/{provider}`             | Signature over the raw body, then a `verify()` call to the provider before anything counts |
| Worker                                 | `/v1/internal/*`                               | `INTERNAL_API_TOKEN` bearer; TLS in production                                             |
| Browsers                               | `/v1/telemetry/web-vitals` (beacon)            | Public, 8 KB limit, schema-checked values only (ADR-044)                                   |
| Load balancer                          | `/health`, `/ready`                            | No data beyond up or down                                                                  |
| Apple and Google                       | App and web association files from the web app | Static files                                                                               |

## Connection limits

Each call has a deadline, and supplier calls also have circuit breakers. Prisma's pool is
sized by `connection_limit` on `DATABASE_URL` (phase 12 sizes it against the database's limit;
the `DatabaseConnectionsHigh` alert watches it). Expensive features are covered in
`business-limits.md`.
