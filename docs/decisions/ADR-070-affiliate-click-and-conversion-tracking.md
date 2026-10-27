# ADR-070: Affiliate click and conversion tracking

- Status: Accepted (network sandbox checks pending)
- Date: 2026-10-27
- Deciders: Claude Code (implementer), pending owner review
- Context: [ADR-069](ADR-069-partner-supply-model.md)

## Context

Affiliate partners pay commission for bookings that start from a Suskii link. To be paid, and
to know which partner earns what, every outbound click must carry an id the partner reports
back, and every reported booking must be recorded. The links appear in the website and the app;
the app opens them in the system browser, which has no Suskii session.

Two networks matter now:

- **Travelpayouts**: one account for many brands. Its Partner Links API turns a brand URL into a
  tracked link and takes a `sub_id`; postbacks report bookings as processing, paid or cancelled.
  A booking earns only once paid.
- **Viator** (Basic Access): product search returns `productUrl`, already tagged with Suskii's
  affiliate id; a `campaign-value` query parameter on the search request tags the returned URLs.

## Decision

### Offers carry sealed links

Offer endpoints (`GET /v1/partners/offers`, `GET /v1/bookings/{id}/partner-offers`) return each
offer's `href` as `/v1/go/{token}`. The token is an AES-256-GCM envelope (`FieldEncryption`,
context `partner-link`) of:

- the programme id and the destination URL;
- the caller's user id when signed in, the sales channel, and the booking id for cross-sell;
- an expiry (`PARTNER_LINK_TTL_HOURS`, default 24).

Sealing keeps the user id out of readable URLs and makes the token tamper-proof. The redirect
also refuses a destination whose host is not one of the programme's hosts (no open redirect,
even with a valid token).

### The redirect records the click

`GET /v1/go/{token}` (public, rate-limited) opens the token, records a `partner_clicks` row
(uuidv7 id, programme, category, user, channel, booking) and answers `302` to the partner:

- **Travelpayouts**: the destination becomes a partner link through the Partner Links API with
  `sub_id` set to the click id. Links are cached per destination and click budget; when the API
  fails or the per-minute budget (90 of the 100 allowed calls) is spent, the redirect falls back
  to the brand URL with the account marker, so a click is never lost to an outage.
- **Viator**: the `productUrl` from search, used verbatim (already tagged); the search's campaign
  value is stored on the click to match Viator's campaign reports.
- **Mock** (tests, local stacks): an example partner URL carrying the click id.

### Postbacks record conversions

`GET` or `POST /v1/partners/postbacks/{network}` (public, rate-limited) needs `token`, the
network's postback secret (`TRAVELPAYOUTS_POSTBACK_SECRET`), compared in constant time. The owner
sets the postback URL in the network dashboard with the network's macros mapped to these
parameters:

| Parameter    | Meaning                                                                                                                                        |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`         | The network's booking or action id (required; with the network, the conversion's key)                                                          |
| `click`      | Our click id (the `sub_id` we sent)                                                                                                            |
| `status`     | `processing`/`pending`/`booked` → pending; `paid`/`confirmed`/`approved` → confirmed; `cancelled`/`canceled`/`rejected`/`declined` → cancelled |
| `price`      | Booking value, decimal string                                                                                                                  |
| `commission` | Our commission, decimal string                                                                                                                 |
| `currency`   | ISO 4217 code                                                                                                                                  |

Rows in `partner_conversions` are unique per network and id; a repeated postback updates the
status and amounts (pending can become confirmed or cancelled; confirmed can become cancelled).
Amounts are integer minor units parsed from decimal strings, never floats. A conversion whose
click is unknown is still recorded (the partner pays it); one with a malformed amount or currency
is refused with 400 so the network retries after the dashboard is fixed.

### Reporting

`GET /v1/admin/partners/summary` (`reports:read`) returns, per programme for a date range:
clicks, conversions by status, and confirmed and pending commission per currency.

### Privacy and retention

- Clicks hold ids only (programme, user, booking, channel); no IP address, user agent or URL.
  They appear in the account's data export (`activity`), are anonymised on account deletion
  (user id cleared) and are purged after 400 days (`partner-clicks`).
- Conversions hold the network's id, amounts and status, no personal data. They are revenue
  records kept for the financial retention period (`partner-conversions`).

## Consequences

- New settings: `PARTNER_OFFERS_ENABLED` (on outside production when unset, off in production
  unless set), `AFFILIATE_NETWORK` (`mock` or `travelpayouts`), `TRAVELPAYOUTS_TOKEN`,
  `TRAVELPAYOUTS_MARKER`, `TRAVELPAYOUTS_TRS`, `TRAVELPAYOUTS_POSTBACK_SECRET`,
  `ACTIVITY_PARTNER` (`mock` or `viator`), `VIATOR_API_KEY`, `VIATOR_API_URL`,
  `PARTNER_LINK_TTL_HOURS`. Production with partner offers on refuses the mock network and the
  mock activities.
- New outbound hosts: `api.travelpayouts.com`, `api.viator.com`.
- To verify on the first sandbox run (documentation hosts do not resolve here): the Partner
  Links response shape (the adapter reads `partner_url` per link and falls back safely), the
  Travelpayouts postback macros, and Viator's search response for a Nigerian city.
- Viator conversions arrive in Viator's reports by campaign, not by postback; importing them is
  a follow-up.
