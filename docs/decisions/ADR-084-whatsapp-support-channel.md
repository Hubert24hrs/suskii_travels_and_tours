# ADR-084: WhatsApp as a support channel

- Status: Accepted
- Date: 2026-10-28
- Deciders: Claude Code (implementer), pending owner review

## Context

Part 2 of roadmap item 9: travellers write to Suskii on WhatsApp and staff answer from the same
console inbox as website and app conversations (ADR-083). WhatsApp is how most travellers in
Nigeria, Ghana and Kenya talk to businesses. Today the website links to a click-to-chat number
from the CMS, and whatever is said there is invisible to the platform.

The WhatsApp Business Platform's Cloud API (Meta hosts it) is the way in. Its rules shape the
design:

- Inbound messages and delivery statuses arrive on one webhook. A GET handshake echoes
  `hub.challenge` when `hub.verify_token` matches. Every POST carries `X-Hub-Signature-256`,
  an HMAC-SHA256 of the raw body under the app secret.
- A business may send free-form messages only within 24 hours of the person's last message (the
  customer service window). Outside it, only a pre-approved template can be sent.
- Since July 2025 Meta charges per delivered template message, by category and country. Several
  sources say replies inside the window also become billable from October 2026. The owner should
  confirm on Meta's rate card.
- Since 2026, a person who adopts a WhatsApp username is identified by a business-scoped user id
  (BSUID) instead of a phone number. Webhooks carry it in `contacts[].user_id` and
  `messages[].from_user_id`, and the phone (`wa_id`, `from`) can be absent. Public sources
  disagree on the field for sending to a BSUID, and Meta's reference was not reachable from the
  build environment.
- Graph API versions last about two years. v26.0 is current.

## Decision

1. **Same conversations, new channel.** A WhatsApp message lands in `support_conversations` with
   channel `whatsapp`, on the same SLA rules (`supportSchedule()`), queues and audit as part 1.
   Nothing else in the inbox changes.
2. **Contacts, not accounts.** A `whatsapp_contacts` row holds the person's phone and BSUID,
   each sealed with field encryption (`whatsapp-contact:{id}:phone`, `:bsuid`) and looked up by
   HMAC (`whatsapp-phone`, `whatsapp-bsuid`). Conversations are **not** linked to accounts
   automatically, even when a verified account phone matches: numbers are recycled, and linking
   would show one person's messages to another. Staff can attach a booking once the traveller
   quotes its reference and matching contact details (audited).
3. **Which conversation.** A message goes to the contact's open or waiting conversation. A
   conversation solved less than `SUPPORT_WHATSAPP_REOPEN_DAYS` (7) ago reopens. Otherwise a new
   one starts, as does a message to a conversation that is full.
4. **Webhook.** `GET` and `POST /v1/webhooks/whatsapp` are public and skip the per-address
   limits. The signature is the control: it is checked over the raw bytes in constant time before
   anything is parsed, and a bad one gets 401. Payloads are parsed with Zod, ignoring fields we
   do not use. Each inbound message id (`wamid`) is unique on `support_messages.external_id`, so a
   repeated delivery is acknowledged without effect. Text is stored. Other types (image, audio,
   document, location, sticker) are stored as an "unsupported" marker naming the type, and
   nothing is downloaded. Per-contact limits (`SUPPORT_WHATSAPP_MESSAGES_PER_MINUTE`) drop floods
   with a metric.
5. **Replies.** A staff reply on a WhatsApp conversation is stored first and sent after the
   transaction commits:
   - Inside the window it goes as text.
   - Outside the window it goes as the approved template `WHATSAPP_SUPPORT_TEMPLATE` (a notice
     naming the conversation reference that asks the person to reply). The reply text itself
     waits in the conversation until they write back.
   - Without a phone number (BSUID only), the reply is recorded as not delivered. The console
     says why until the BSUID send field is confirmed in the owner's first sandbox run.
   - A person who writes STOP gets no templates until they write again.
   - Internal notes are never sent.
6. **Delivery state.** Outbound messages keep `delivery_status`: `pending` before the call, then
   `sent` (with the returned `wamid`) or `failed`, and later `delivered`, `read` or `failed` from
   status webhooks. Statuses only move forward. A timeout is recorded as `failed` with the reason
   `timeout`. There is no idempotency key, so the console offers no blind resend.
7. **Adapter.** `WhatsAppChannel` (`sendText`, `sendTemplate`) hides the Graph API: `mock` keeps
   an outbox for tests, and `cloud` calls `{WHATSAPP_API_BASE}/{WHATSAPP_GRAPH_VERSION}/{phone
   number id}/messages` with the access token in the header, `redirect: 'error'` and a timeout.
   `WHATSAPP_SUPPORT_PROVIDER` is `none` (default), `mock` or `cloud`. Production refuses `mock`,
   and `none` answers 404 on the webhook. Vendor payloads never leave the adapter or the webhook
   parser.
8. **Privacy.**
   - Message bodies are encrypted as in part 1. Phone numbers and BSUIDs are sealed.
   - Logs, metrics and audit entries carry ids only.
   - Contacts with no conversation left are purged 30 days after their last message (retention
     rule `whatsapp-contacts`), and conversations follow part 1's two-year rule.
   - Meta processes the messages as the Cloud API host. The privacy policy must say so (owner).

## Consequences

- Travellers can write on WhatsApp and get answers from the same people and queues, with SLA
  timers and audit.
- Answers outside 24 hours cost a template message and need one approved template. Quick
  replies stay inside the window.
- WhatsApp-only travellers cannot see their conversation on the website or in the app, and data
  requests from them go through support by hand.
- Attachments still wait for the antivirus pipeline (ADR-083).

## Alternatives considered

- **A WhatsApp business solution provider (Twilio, 360dialog, Infobip).** These add a markup
  per message and another processor, for features this inbox already has. The adapter boundary
  keeps them possible.
- **Linking WhatsApp conversations to accounts by phone.** Rejected because of recycled numbers
  and because a match would reveal that a number has an account.
- **Sending every reply as a template.** This would cost more and would not let replies read as
  a conversation inside the window.
