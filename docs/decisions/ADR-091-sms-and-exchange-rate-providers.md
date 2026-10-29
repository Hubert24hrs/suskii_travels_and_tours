# ADR-091: Text and exchange-rate providers

- Status: Accepted
- Date: 2026-10-28
- Deciders: Claude Code (implementer), pending owner review

## Context

Production refuses to start with a mock provider (ADR-038 hardening, phase 12). Three settings
had no real adapter, so production could not start at all: `SMS_PROVIDER` (sign-in codes,
booking and safety texts), `FX_PROVIDER` (every price converted between currencies) and
`WHATSAPP_PROVIDER` (booking and alert messages on WhatsApp). Driver KYC and payouts are also
mock-only, but they only matter while rides are on, and rides stay off in production (ADR-069).

The owner has not picked providers yet. The decision here is which adapters to build so that
the owner only has to open accounts and set keys.

## Decision

1. **Texts: Termii and Africa's Talking, routed by calling code.**
   - **Termii** is the most common choice for Nigerian numbers. Its DND route reaches numbers on
     the Do-Not-Disturb list, which a sign-in code must reach. Its adapter sends `POST /api/sms/send`
     with JSON `to` (digits without the plus), `from` (the approved sender ID), `sms`, `type: plain`,
     `channel` (`dnd` by default) and the `api_key` in the body. A `message_id` in the answer
     means accepted.
   - **Africa's Talking** covers Kenya, Uganda, Tanzania, Rwanda, Malawi, Nigeria and more. Its
     adapter sends `POST /version1/messaging` as a form (`username`, `to`, `message`, an optional
     `from`, `bulkSMSMode=1`), with the key in the `apiKey` header. It answers 201 with one
     result per recipient, and only codes 100 to 102 (processed, sent, queued) count as
     accepted. The sandbox host is refused in production because it delivers nothing.
   - `SMS_PROVIDER` is the default provider. `SMS_ROUTES` (`234=termii,254=africastalking`) sends
     numbers by their longest matching calling-code prefix to another provider. Each provider
     named needs its credentials in every environment, and the check fails at boot otherwise.
   - Failures become `SmsSendError(provider, code)`. The code never holds the number or the text,
     and logs carry the provider, the template and the code only.
   - When a sign-in code cannot be sent, the code and the resend cooldown are deleted and the
     route answers 503 `sms-unavailable`, so the traveller can retry at once. The notification
     service already logs a failed channel and goes on with the others.
2. **Exchange rates: Open Exchange Rates, with owner-fixed rates on top.**
   - The adapter calls `GET /latest.json` against the US dollar, which every plan allows. The app
     id goes in the documented `app_id` query parameter, so the URL is never logged or put in an
     error. Errors keep the provider's short `message` code (`invalid_app_id`).
   - Rates are kept as their exact source text through JSON.parse source access (Node 24), never
     as floats (ADR-008). A missing, negative or malformed rate is left out, never guessed, and a
     price in that currency then fails as before.
   - `FX_RATE_OVERRIDES` (`NGN=1600.5`, per US dollar) pins chosen rates over the provider's. This
     is the answer to ADR-008's open question about which naira rate to use: the market rate from
     the provider, or the bank's settlement rate fixed by the owner. The snapshot names both
     sources (`openexchangerates+fixed`).
   - `FxService` keeps its memory, Redis and last-known-good layers unchanged.
3. **WhatsApp notifications: off by setting until templates exist.** WhatsApp only delivers
   free text inside a 24-hour window after the traveller writes. Booking and alert messages would
   need one approved template each. `WHATSAPP_PROVIDER=none` turns the channel off: the dispatcher
   logs `skipped`/`channel_off` and still sends email, push and text. Production accepts `none`.
   WhatsApp support (ADR-084) is separate and unchanged.
4. **Checking with real keys.** `pnpm --filter @suskii/api sandbox:messaging` and the manual
   `messaging-sandbox.yml` workflow read today's rates and, with `--to`, send one test text per
   provider through these adapters. They print no key and only the last three digits of the
   phone, and the workflow masks the phone. No test or CI job calls a provider.
5. **Where the request formats come from.** The providers' documentation sites could not be
   reached from the build environment. The adapters were checked against what could be read:
   - Africa's Talking: its official Node SDK, for the endpoints, form fields, headers and the 201
     answer.
   - Termii: two independent client libraries that agree on the endpoint, fields and answer.
   - Open Exchange Rates: four client libraries that agree on `latest.json`, `app_id`, the
     timestamp and the error shape.

   The first run of the check with real keys confirms them. Africa's Talking's per-recipient
   success codes (100 to 102) and Termii's DND activation are the details to watch in that run.

## Consequences

- Production can start once the owner sets the keys: `TERMII_API_KEY` and `TERMII_SENDER_ID`
  and/or the Africa's Talking username and key, and `OPENEXCHANGERATES_APP_ID`. WhatsApp
  notifications stay off with `WHATSAPP_PROVIDER=none` until templates are approved.
- Both text providers and Open Exchange Rates are new outbound hosts
  (`docs/security/external-communications.md`). The text providers are processors in the
  records of processing; the rate provider receives nothing personal.
- Terraform and Helm now refuse plain settings ending in `_APP_ID`: the Open Exchange Rates app
  id is a secret and belongs in `extra_secrets`.
- New error: 503 `sms-unavailable` on the three routes that text a code. Clients already show a
  generic retry message for a 503.
