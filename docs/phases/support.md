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

## Part 1 outcome

Built as planned (ADR-083).

- **API** (`apps/api/src/support`): starting a conversation (account; guest with Turnstile or
  device attestation and an email; about a booking the caller can open), list, read with paging
  after a message id, mark read, reply and resolve. Guest access is by the token returned at the
  start or an emailed 30-day link token. The console routes cover queues with keyset paging by due
  time, replies, internal notes, assignment, and priority, category and status changes, each
  audited. Reply notices go through `NotificationService` (`support` category) or a guest email.
- **Database**: `support_conversations` and `support_messages` (expand-only migration
  `20261105120000_support_conversations`), registry entries, export without notes, deletion with
  the account, and a two-year purge of solved conversations.
- **Website**: `/support` (FAQs, start, your conversations), `/support/[id]` (polling every
  4 s while visible), "Get help with this booking" on booking pages, and Help in the header and
  footer.
- **App**: Help and support from Account and every trip, the conversation screen (polling every
  4 s), guest tokens in the secure store, reply notifications that open the conversation, and a
  Maestro flow that writes to support as a visitor.
- **Console**: the Support inbox (queues, filters, SLA marks) and the conversation page (thread,
  reply, note, assignment, priority, status).

Verification on this branch (local):

| Check                               | Result                                                                                                                                        |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint and typecheck, every workspace | 25 of 25 tasks                                                                                                                                |
| Unit tests                          | API 611, app 259, ui-native 45, ui-web 148 + 4, and the shared, i18n, worker, design-token and api-client suites all pass                     |
| API e2e (without the S3 suite)      | 558 of 558 (53 suites), including support 5 of 5, the IDOR matrix and the admin audit cases                                                   |
| Website e2e                         | 130 of 130 run on their own. A first run alongside other builds missed the slow-3G budget by 50 ms (3,050 ms median); it passed on the re-run |
| Console e2e                         | 20 of 20, including the support journey and its audit entry                                                                                   |
| `check:classes`, security list      | Every class generates CSS; `security:checklist --check` up to date                                                                            |
| Migrations                          | `check:migrations` backwards-compatible                                                                                                       |

Open for the owner: who staffs support and on which hours, the reply and resolution targets per
priority (`SUPPORT_SLA`), and which Prime plans include priority support.

## Part 2 plan: WhatsApp (ADR-084)

| Step | Work                                                                                                                                                                                           | Files                                         |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 1    | Settings: `WHATSAPP_SUPPORT_PROVIDER` (`none`, `mock`, `cloud`), phone number id, access token, app secret, verify token, Graph version, template name and language, reopen days, flood limit  | `src/config`, `.env.example`, Terraform, Helm |
| 2    | Database: `whatsapp_contacts` (sealed phone and BSUID, HMACs, last inbound time, STOP), conversation contact link, message `external_id`, `kind` and `delivery_status`; registry and retention | `prisma`, `src/privacy`                       |
| 3    | Adapter: `WhatsAppChannel` with `MockWhatsAppChannel` and `CloudWhatsAppChannel` (text, template), unit tests against recorded request shapes                                                  | `src/support/whatsapp`                        |
| 4    | Webhook: GET handshake, signed POST, Zod parsing, dedupe by `wamid`, routing to a conversation (open, reopen, new), statuses moving forward, per-contact flood limit, metrics                  | `src/support/whatsapp`                        |
| 5    | Replies: send after commit inside the window as text, outside as the template, undeliverable without a phone, STOP respected; delivery state on each message                                   | `support-admin.service.ts`                    |
| 6    | Console: channel badge and filter, the contact's masked number, window state, delivery state per message, unsupported media marker                                                             | `apps/admin`                                  |
| 7    | Tests: unit (signature, parsing, routing, window), API e2e (handshake, signed delivery, duplicates, reply in and out of the window, statuses, bad signature, BSUID only), console e2e          | everywhere                                    |
| 8    | Docs: security docs, setup steps for the owner (Meta app, number, permanent token, webhook, template), CHANGELOG, CLAUDE.md                                                                    | `docs`                                        |

### Part 2 risks

- **Forged deliveries.** Only a valid `X-Hub-Signature-256` over the raw bytes is processed, so
  nobody can inject messages or statuses. The verify token only answers the handshake.
- **Replays and duplicates.** Meta retries deliveries; the unique `external_id` makes a repeat a
  no-op, and statuses never move backwards.
- **Cost.** Templates are billed per message. One template per staff reply outside the window,
  never for notes, and none after STOP.
- **Identity.** No automatic link between a phone number and an account (recycled numbers).
- **Unconfirmed BSUID sending.** Replies to BSUID-only contacts are recorded as undelivered with
  the reason shown in the console until a sandbox run confirms the send field.

## Part 2 outcome

Built as planned (ADR-084). WhatsApp is off (`WHATSAPP_SUPPORT_PROVIDER=none`) until the owner
connects a number.

- **API** (`apps/api/src/support/whatsapp`): the signed webhook (handshake and deliveries),
  routing into conversations (open, reopened within 7 days, new; full conversations start a new
  one), contacts sealed and found by HMAC, STOP, a per-contact flood limit, forward-only
  delivery states, replies after the commit (text, template notice, forwarding once the window
  reopens) and the `mock` and `cloud` adapters. Migration `20261106120000_support_whatsapp`
  (expand-only), registry and retention entries, metrics `suskii.support.whatsapp.*`.
- **Console**: channel filter, masked number, window state, delivery state per reply and the
  attachment marker.
- **Fix on the way**: the Meta Graph API default for the Conversions API moved from v24.0
  (expired 6 October 2026) to v26.0.

### Setting it up (owner)

1. In Meta Business Manager, create a business portfolio (verified business details), a WhatsApp
   Business Account and a phone number. Note the phone number id in WhatsApp Manager.
2. Create a Meta app with the WhatsApp product. Add a system user with
   `whatsapp_business_messaging` and generate a permanent token. Copy the app secret.
3. Put `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET` and a new random `WHATSAPP_VERIFY_TOKEN`
   (at least 16 characters) in Secret Manager. Set `WHATSAPP_PHONE_NUMBER_ID` and
   `WHATSAPP_SUPPORT_PROVIDER=cloud` (see `production.tfvars.example`).
4. In the app's WhatsApp configuration, set the callback URL to
   `https://<api host>/v1/webhooks/whatsapp` with the verify token, and subscribe to the
   `messages` field.
5. Submit a utility template named `support_reply_waiting` in English with one body variable,
   for example: "We have replied to your Suskii request {{1}}. Reply to this message to read it."
   Add translations under the same name if travellers write in other languages, and set
   `WHATSAPP_SUPPORT_TEMPLATE_LANGUAGE` to match.
6. Send a test message from a phone to the number. It should appear in the console under
   Support with the WhatsApp channel filter. Then send one from an account that uses a WhatsApp
   username, to confirm how replies reach a business-scoped user id.

## Part 3 plan: the after-hours assistant (ADR-085)

When nobody is on shift, a traveller who writes to support gets an answer in seconds, drawn only
from the published FAQs and, when the conversation is about one of their bookings, that
booking's facts. The assistant never acts (no cancellations, refunds, changes or promises),
says when it cannot help, and leaves the conversation in the queue for a person, with its SLA
timers running.

| Step | Work                                                                                                                                                                                                                        | Files                                         |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 1    | Shared: staffed hours (`parseSupportHours()`, `supportStaffed()`), the `assistant` author and the `handover` message kind, assistant limits; copy in every catalog                                                          | `packages/shared`, `packages/i18n`            |
| 2    | Settings: `SUPPORT_ASSISTANT_ENABLED` (off unless set), `SUPPORT_HOURS` and `SUPPORT_TIME_ZONE`, replies per conversation, daily and per-conversation spend caps; the model settings stay those of AI trip search (`LLM_*`) | `src/config`, `.env.example`, Terraform, Helm |
| 3    | Database: the `assistant` author, the `handover` kind and the sources an answer cited (`assistant_sources`); expand-only migration                                                                                          | `prisma`                                      |
| 4    | Answering: the facts a booking may show (`assistantBookingFacts()`: no names, contacts, documents, codes or references), the prompt, structured output, the grounding checks (sources, figures, links, length) and handover | `src/support/assistant`                       |
| 5    | Service: after a traveller's message commits (website, app, WhatsApp), outside staffed hours, before any staff reply and under the caps: one answer or one handover; never touches SLA fields; a lock per conversation      | `src/support/assistant`                       |
| 6    | Budget: AI trip search's reservation (reserve the worst case, settle to the bill) with its own keys and caps; metrics for outcomes, tokens and cost                                                                         | `src/ai-search`, `src/telemetry`              |
| 7    | Clients: assistant messages labelled "Automated answer" with a note that a person will also read the message; the handover in the traveller's language; the console shows the cited sources                                 | `apps/web`, `apps/mobile`, `apps/admin`       |
| 8    | Eval: 40 conversations over 12 FAQs and 5 bookings (answers, handovers, prompt injection, action requests, private data), graded by rule; recorded answers in CI, the real model through `ai-eval.yml`                      | `test/fixtures`, `scripts`, `.github`         |
| 9    | Tests (unit, API e2e, web e2e, app Jest, console e2e) and docs                                                                                                                                                              | everywhere                                    |

### Part 3 risks

- **A wrong answer about money or a trip.** The model sees only FAQs and the booking's facts,
  must cite what it used, and every figure in its answer must appear in what it cited; links,
  email addresses and phone numbers must too. Anything else becomes a handover. The eval fails
  on any answer where a handover was expected.
- **Prompt injection.** The traveller's words are data in the user turn; the model has no
  tools, its output is a JSON object checked by code, and nothing it says changes a booking.
- **Personal data at a third party.** The traveller's text is scrubbed (`scrubQuery()`), the
  booking facts carry no names, contact details, documents, ticket numbers, voucher codes or
  references, and requests carry no user or conversation id. Nothing the model returns is
  logged; only outcomes, latency, tokens and cost are measured.
- **Cost.** A daily cap for all conversations, a per-conversation cap and at most three answers
  per conversation; the assistant stops once a person has replied.
- **Over-reliance.** Answers are labelled as automated, a person still reads every
  conversation, and assistant answers never count as the first response in SLA reports.

## Part 3 outcome

Built as planned (ADR-085). The assistant is off (`SUPPORT_ASSISTANT_ENABLED=false`) until the
owner turns it on; the test stacks (website e2e, the hosted test server) run it with the mock
model and no staffed hours.

- **API** (`apps/api/src/support/assistant`): `SupportAssistant` answers after a traveller's
  message commits on the website, in the app or on WhatsApp, outside `SUPPORT_HOURS`, before any
  staff reply, under a lock per conversation and the spend caps; `SupportAnswerer` asks the
  model for structured output and `checkAnswer()` checks it (known sources, every figure and
  contact from the cited sources); `assistantBookingFacts()` builds the booking's facts from the
  traveller's own view without names, contacts, documents, codes or references. Migration
  `20261107120000_support_assistant` (expand-only: two enum values and a nullable column),
  metrics `suskii.support.assistant.*`.
- **Clients**: the website and the app label assistant answers "Automated answer" with a note
  that a person will also read the message, and show the handover in the traveller's language;
  the console shows the FAQs and booking facts an answer cited, and marks a handover.
- **Eval**: 40 conversations (`test/fixtures/support-assistant-eval.json`), graded by rule. With
  recorded answers it passes 40/40 and the checks stop all 7 deliberately wrong answers (an
  invented figure, a phone number, a link, an unknown source, no sources). Against the real
  model it needs `LLM_API_KEY` and one run of `ai-eval.yml` with the `support-assistant` suite.

- **Local verification**: unit tests (API, shared, worker, i18n), API e2e 578 of 578 (the S3
  suite needs a container runtime and runs in CI), admin e2e 21 of 21, website e2e 130 of 130,
  mobile Jest 260 of 260, builds, `check:migrations` and the security checklist. The homepage
  Lighthouse gate, which part 3 does not touch (its website changes are the support page and the
  e2e stack), scored performance 93, LCP 2.0 s and CLS 0 here, but total blocking time varied from
  159 to 956 ms between runs on this shared 4-core machine (median 251 ms, limit 200 ms); CI runs
  that gate on its own runner.

### Turning it on (owner)

1. Set the staffed hours, for example `SUPPORT_HOURS=mon-fri 08:00-20:00, sat 09:00-14:00` and
   `SUPPORT_TIME_ZONE=Africa/Lagos` (empty hours: the assistant answers at any time).
2. Add `LLM_API_KEY` as a repository secret and run Actions, AI search eval, with the suite
   `support-assistant` (a few cents). It must pass 90% with no unsafe answer.
3. Publish the help-centre FAQs in the console (Content, FAQs): the assistant answers only from
   them and the traveller's booking. Three are seeded today.
4. In production set `SUPPORT_ASSISTANT_ENABLED=true` and `LLM_PROVIDER=anthropic` with the key
   in Secret Manager (see `production.tfvars.example`); adjust the spend caps if needed.
