# 24/7 support: conversations, WhatsApp and an after-hours assistant

Item 9 of the roadmap agreed with the owner: "24/7 chat and WhatsApp". The spec asks for "Help
center/FAQ from CMS, contact form, WhatsApp link, support tickets tied to bookings, SLA timers in
admin" and lists `SupportTicket` and `SupportMessage` among the data entities; Suskii Prime
promises a priority support queue, and the homepage claims "24/7 human support".

## Why

Travellers in our markets ask before they pay ("can I pay in parts?", "is this fare refundable?")
and after (a changed flight, a missing e-ticket). An answer in minutes, in the channel they
already use, turns a question into a booking and keeps a refund from becoming a chargeback.
Booking.com, Wakanow and Travelstart all offer chat; WhatsApp is how most Nigerians, Ghanaians
and Kenyans talk to businesses.

## Where the platform stands

- The header shows a support phone number and a WhatsApp click-to-chat link from the CMS
  (`site.contact`); nothing records the conversation or ties it to a booking.
- `support:manage` exists in `ROLE_PERMISSIONS` (support staff and super admins) but guards
  nothing; there are no support tables.
- `WhatsAppProvider` exists for outbound notifications (mock only, ADR-032).
- FAQs come from the CMS (`GET /v1/content/home` returns them).
- Notifications (`NotificationService`), guest booking access (`X-Booking-Token`), Turnstile and
  app attestation, field encryption and the retention service exist.

## Parts

1. **Conversations and tickets** (this part): travellers, guests and visitors start a
   conversation on the website or in the app, optionally about one of their bookings; staff answer
   from a console inbox with SLA timers, internal notes, assignment and a Prime priority queue;
   replies reach the traveller by email and push.
2. **WhatsApp**: the WhatsApp Business Cloud API as a channel of the same conversations (a
   signed inbound webhook, free-form replies inside the 24-hour customer service window,
   approved templates outside it).
3. **After-hours assistant**: an assistant that answers from published FAQs and the traveller's
   own booking facts, never acts, and hands over to a person; behind a flag, with an eval.

## Part 1 plan

| Step | Work                                                                                                                                                                                                                              | Files                                |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 1    | Shared: conversation categories, statuses, priorities and channels; SLA rules (`supportPriority()`, `slaDue()`); message limits; the `support` notification category; copy in every catalog                                       | `packages/shared`, `packages/i18n`   |
| 2    | Database: `support_conversations` (reference, owner or guest token HMAC, booking, category, priority, status, assignee, SLA times) and `support_messages` (author, encrypted body, internal flag); privacy registry and retention | `apps/api/prisma`, `src/privacy`     |
| 3    | API (traveller): start a conversation (account, guest booking token, or a visitor with an email after Turnstile or app attestation), list own, read with messages, reply, mark read, resolve; guests get a token once             | `apps/api/src/support`               |
| 4    | API (console): inbox with filters (status, priority, assigned to me or nobody) and SLA state; read with internal notes and the booking summary; reply or note; assign, change status, priority and category; every change audited | `apps/api/src/support`, admin routes |
| 5    | Notifications: a staff reply notifies account holders through `NotificationService` (`support`) and guests by email with a link carrying their token in the fragment; metrics for first response and open conversations           | `src/messaging`, `src/telemetry`     |
| 6    | Website: `/support` (FAQ, start a chat, your conversations), `/support/[id]` (the conversation, polling while visible), "Get help with this booking" on the booking page, a Support link in the header and footer                 | `apps/web`                           |
| 7    | App: Help and support (FAQ, start, list), the conversation screen with polling, "Get help" on the trip screen, push opens the conversation                                                                                        | `apps/mobile`                        |
| 8    | Console: Support inbox (queues, SLA timers, filters) and the conversation page (thread, reply, internal note, assign, status)                                                                                                     | `apps/admin`                         |
| 9    | Tests (unit, API e2e with IDOR, admin matrix and audit cases, web e2e, app Jest, console e2e) and docs                                                                                                                            | everywhere                           |

### SLA rules

Priority is set when the conversation starts and can be changed by staff:

- `urgent`: about a booking whose trip starts within `SUPPORT_URGENT_HOURS` (default 48) or started
  in the last day.
- `prime`: the traveller is a Suskii Prime member whose plan includes priority support
  (`currentPrime()`, `prioritySupport`).
- `normal`: everyone else.

Each priority has a reply target and a resolution target (`SUPPORT_SLA`, defaults: urgent 15
minutes and 4 hours, prime 30 minutes and 8 hours, normal 2 hours and 24 hours). A reply is owed
from the traveller's first unanswered message; resolution is due from the start of the current open
spell (creation, or the message that reopened a resolved conversation). Due times are recomputed on
every change, so a new priority moves them. The console sorts by the nearest due time and marks
`due_soon` (the last fifth of the time allowed) and `breached`.

## Risks

- **Someone else's conversation.** Account holders see only their own; guests only the one their
  token opens (stored as an HMAC); the booking link loads through `BookingsService.load()`. Every
  other id answers 404.
- **Spam and abuse.** Starting a conversation as a visitor needs Turnstile (website) or attestation
  (app), a valid email and per-address limits; message bodies are capped (2,000 characters) and
  each conversation has a message rate limit and holds at most 500 messages; an account has at most
  five open conversations.
- **Personal data in free text.** Message bodies are encrypted per message
  (`support-message:{id}:body`) and a guest's email per conversation; logs, metrics and audit
  entries carry ids only; reply notices never contain the reply; resolved conversations are purged
  two years after their last change (retention rule `support-conversations`); account deletion
  deletes the traveller's conversations; the data export includes them without internal notes.
- **Internal notes leaking.** Notes are a flag on the message; the traveller routes filter them in
  the query, and an e2e test checks they never appear.
- **Real-time cost.** Clients poll for new messages after the last id they have, every 4 seconds
  while the conversation is visible and not at all when hidden; a socket can replace this later
  through the rides gateway pattern (ADR-052).
