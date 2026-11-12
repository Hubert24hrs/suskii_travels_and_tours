# ADR-012: Newsletter consent, double opt-in and bot protection

- Status: Accepted
- Date: 2026-09-29
- Deciders: Claude Code (implementer), pending owner review

## Context

The homepage newsletter block collects an email address and an optional WhatsApp opt-in for deal
alerts, with double opt-in, a consent checkbox and Cloudflare Turnstile. The Nigeria Data
Protection Act 2023 and GDPR require freely given, specific, informed and provable consent. No
messaging (WhatsApp/SMS) provider is contracted yet.

## Decisions

- **Consent record**: the request must include `consent: true` (an unticked box is rejected). The
  subscription stores the consent version, timestamp, source (`homepage`), locale and a keyed hash
  of the IP address (proof of consent without keeping the raw IP).
- **Double opt-in**: new subscriptions are `pending`. The confirmation email links to
  `/newsletter/confirm#token=…`; the token sits in the URL fragment so it never reaches server logs
  or Referer headers, and the page asks the reader to press "Confirm" (a POST), so email security
  scanners that pre-fetch links cannot confirm on the user's behalf. Tokens are 32 random bytes,
  stored as SHA-256 hashes, and expire after 48 hours.
- **No enumeration**: every valid request answers `202` with the same body whether the address is
  new, pending or already confirmed. A pending subscription gets at most one new confirmation email
  per 10 minutes; a confirmed one gets nothing.
- **Unsubscribe**: every email carries an unsubscribe link with a keyed token (HMAC of the
  subscription id with a dedicated key), so unsubscribing never needs a lookup table and works
  indefinitely.
- **WhatsApp**: the number (E.164) and opt-in are stored as `pending_verification`. Nothing is sent
  over WhatsApp until a messaging provider exists and the number is verified (phase 9 notifications).
- **Turnstile**: `TurnstileVerifier` interface with `CloudflareTurnstileVerifier` (siteverify API,
  expected action and hostname checks) and `MockTurnstileVerifier` (development and tests, used only
  while `TURNSTILE_SECRET_KEY` is empty). Production refuses to start without the secret. The widget
  loads only when the visitor starts filling in the form, keeping third-party JavaScript off the
  critical path.
- **Rate limits**: per IP (5 per 10 minutes) and per email hash (3 per hour) on subscribe; per IP on
  confirm and unsubscribe.

## Consequences

- The marketing list is provable and clean from day one; the admin console (phase 10) can export
  and delete subscriptions for data subject requests.
- WhatsApp deal alerts need a messaging provider decision (open with the SMS provider question).
