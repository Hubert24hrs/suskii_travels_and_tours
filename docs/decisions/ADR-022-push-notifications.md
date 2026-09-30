# ADR-022: Push notifications

- Status: Accepted
- Date: 2026-09-30
- Deciders: Claude Code (implementer), pending owner review

## Context

The spec lists `expo-notifications` (FCM and APNs) and transactional pushes: booking confirmed,
e-ticket ready, payment due, schedule change, check-in reminder, refund status and price alerts.
Most travellers check out as guests, whose bookings are not tied to an account.

## Decisions

1. **Expo push service** behind a `PushProvider` interface (`ExpoPushProvider`, `MockPushProvider`
   for development and tests; production refuses the mock unless `ALLOW_MOCK_PROVIDERS=true`).
   Expo relays to FCM and APNs with the credentials stored in EAS, so the API holds no FCM or APNs
   keys. `EXPO_ACCESS_TOKEN` (optional) enables Expo's enhanced push security, which the owner
   should turn on so a leaked device token cannot be used to send notifications.
2. **Token storage.** Device push tokens are treated as sensitive: stored encrypted with a
   record-bound context (`push-token:{id}`) and looked up by HMAC. A token belongs to a scope:
   an account session (`PUT /v1/me/push-token`, removed with `DELETE /v1/me/push-token` or when the
   session ends) or a booking (`PUT /v1/bookings/{id}/push-token`, owner or guest token). Pushes go
   only to tokens whose session is still active or whose booking is theirs.
3. **Content.** Titles and bodies carry the booking reference and the event, never names, routes,
   amounts or document numbers (lock screens are public). The data payload holds only the
   in-app path (`/trips/{id}`), which the app validates like any deep link.
4. **Events in this phase**: booking confirmed (documents ready), payment due (the reminders from
   ADR-018), refund started and completed, and a booking that could not be completed. Schedule
   changes, check-in reminders and price alerts need supplier events and alert subscriptions that
   arrive in later phases.
5. **Dead tokens.** A `DeviceNotRegistered` answer deletes the token. Guest booking tokens are
   deleted 30 days after the trip ends.
6. **Permission prompt.** The app asks for notification permission after a booking is created or
   from Account settings, never on first launch; Android gets a `bookings` channel.

## Consequences

- Delivery receipts (Expo's second step) are not polled in this phase; ticket-level errors are
  handled at send time.
- Production pushes need the owner's FCM service account and APNs key uploaded to EAS.
