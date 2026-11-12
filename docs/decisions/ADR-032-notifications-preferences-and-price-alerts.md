# ADR-032: Notifications, channel preferences and price alerts

- Status: Accepted
- Date: 2026-10-05
- Deciders: Claude Code (implementer), pending owner review

## Context

Notifications go out today from each feature directly: booking emails, payment reminders, refund
updates, push messages (phase 7) and SMS codes. The spec wants "notification preferences across
email/SMS/WhatsApp/push" and lists booking confirmed, e-ticket ready, payment due, schedule
change, check-in reminder, refund status and price alerts. No SMS or WhatsApp provider is
contracted. Price alerts are "user subscribes to a route; worker notifies on drop".

## Decisions

1. **Categories and channels.** Categories: `booking` (confirmations, documents, changes),
   `payment` (due dates, receipts, refunds), `trip_reminder` (check-in), `price_alert`, `prime`,
   `marketing`. Channels: `email`, `sms`, `whatsapp`, `push`. Each user has a preference per
   category and channel. Defaults: email on for every category except marketing; push on for
   booking, payment, trip reminders and price alerts; SMS and WhatsApp off; marketing off
   everywhere (opt-in, consent recorded with time and source).
2. **Transactional email is mandatory.** Email for `booking` and `payment` cannot be turned off
   (the API rejects it): travellers must receive their documents and payment notices. Guests get
   transactional email only.
3. **One dispatcher.** `NotificationService.notify(userId | contact, category, message)` resolves
   preferences, renders per channel (email template, short text for SMS and WhatsApp, push title
   and body with the booking reference only) and sends through `EmailProvider`, `SmsProvider`,
   `WhatsAppProvider` (new; mock adapter, production refuses mocks unless
   `ALLOW_MOCK_PROVIDERS=true`) and `PushProvider`. A delivery log (`notifications`) keeps
   category, channel, template, status and reference ids, never message bodies or contact values.
   SMS and WhatsApp need a verified phone.
4. **Adoption.** New senders (check-in reminders, price alerts, Prime and referral messages) use
   the dispatcher now; existing booking and payment senders move to it where they notify an
   account holder, keeping their email templates.
5. **Price alerts.** Signed-in users only, at most 10 active: origin and destination airports,
   a departure date or month, cabin, one adult, currency, optional target price. The worker calls
   `POST /internal/price-alerts/run` every few hours (`PRICE_ALERT_INTERVAL_HOURS`); the API
   prices each alert from the search orchestrator (supplier rate limits respected, alerts on the
   same route and date share one search), stores the last seen price, and notifies when the
   lowest price is at or below the target, or has dropped by `PRICE_ALERT_MIN_DROP_BPS` since the
   last notice, at most once per 24 hours per alert. Alerts end after the departure date.
6. **Check-in reminders.** For confirmed flights, 24 hours before the first departure (airport
   time), once per booking, through the dispatcher.

## Consequences

- Turning SMS or WhatsApp on is a configuration change once a provider is contracted.
- Every message sent is auditable by category and reference without storing its content.
- Price alerts cost supplier searches; batching by route and date and the alert cap bound them.

## Implementation notes (phase 9)

- `NotificationService.notify(userId, content)` (global `MessagingModule`) resolves the matrix
  (`notificationMatrix()`: stored choices over defaults, mandatory booking and payment email,
  marketing only with recorded consent). It sends each rendered channel and logs every attempt
  in `notifications` with a reason when skipped: `preference_off`, `no_email`,
  `no_verified_phone`, `no_device`, `account_inactive`. Failures are logged as
  `provider_error`, and the call never throws. Push goes to the account's signed-in devices
  (`PushTokensService.sendToUser`). WhatsApp has a mock provider (`WHATSAPP_PROVIDER=mock`, refused
  in production like SMS).
- Marketing consent and marketing channels move together. Turning a marketing channel on records
  consent with its source (`account:web`, `account:mobile`), and withdrawing consent turns every
  marketing channel off.
- Price alerts: `GET/POST/DELETE /v1/me/price-alerts`, up to 10 active, no duplicates, departures
  from tomorrow to `MAX_ADVANCE_DAYS`. The worker calls `POST /internal/price-alerts/run` every
  `PRICE_ALERT_SWEEP_MINUTES` on the rate-limited refresh queue. The API checks up to
  `PRICE_ALERT_BATCH_SIZE` alerts not checked in `PRICE_ALERT_INTERVAL_HOURS`. Each date is one
  `cheapestOffer()` call (cached and single-flight with customer searches), and month alerts
  sample at most four dates a week apart. The fare is priced for the alert's owner, Prime
  included. The first price seen becomes the baseline that drops are measured from, so an alert
  without a target never notifies on its first check.
- Reminders: `POST /internal/reminders/run` sends check-in reminders for confirmed account
  flights departing within 24 hours (`checkin_reminded_at`). It also sends Prime expiry reminders
  `PRIME_REMINDER_DAYS` before the paid-up end, skipping a term followed by one bought ahead.
  Each reminder is claimed with a conditional update, so it goes once.
- Clients: the web account area and the app show the matrix with booking and payment email
  locked on, and save each change at once (optimistic, restored on failure). "Watch this route"
  on flight results creates an alert for the first flight of the search. Push data carries an
  in-app path; the app follows only a trip path or one of `/prime`, `/account`,
  `/account/alerts` and `/account/referrals` (`resolveNotificationPath`), so price alert pushes
  open the alerts screen.
